/**
 * Sprint 3.0 v4 — W1.1 Sign-in-with-Base (EIP-4361) verification.
 *
 * Verifies SIWE messages signed by Base Account wallets (including
 * counterfactual / undeployed Coinbase Smart Wallets via ERC-6492).
 *
 * CRITICAL: this module uses the **public-client action**
 * `publicClient.verifyMessage` (wrapped inside viem's
 * `verifySiweMessage`), NOT the synchronous utility export from `viem`.
 * Only the public-client form simulates the counterfactual wallet deploy
 * bytecode needed to validate first-time Base Account signatures. The
 * W2.1 spike (see `sprint-3.0/progress-3.0.md`) confirmed this behavior
 * on viem 2.47.6.
 *
 * Verification flow (distinguishable failure reasons):
 *   1. parseSiweMessage → extract domain, nonce, address, chainId
 *   2. domain-mismatch check (EIP-4361 origin binding)
 *   3. nonce-invalid check (not issued, consumed, or expired)
 *   4. signature check via verifySiweMessage (handles ERC-6492)
 *   5. on success: consume nonce + return lowercased walletAddress
 *   6. on signature failure: LEAVE nonce intact (HE4 — user can retry)
 *
 * The verifier is chain-aware: Base Sepolia (84532) and Base Mainnet
 * (8453) are both accepted. Other chain IDs are rejected.
 */

import { createPublicClient, http, type PublicClient } from "viem";
import { base, baseSepolia } from "viem/chains";
import { parseSiweMessage, verifySiweMessage } from "viem/siwe";
import type { NonceStore } from "./nonce-store.js";

export type SiweFailureReason =
  | "parse-error"
  | "domain-mismatch"
  | "nonce-invalid"
  | "chain-unsupported"
  | "invalid-signature";

export interface SiweVerifyInput {
  message: string; // raw EIP-4361 message text as signed
  signature: `0x${string}`;
  expectedDomain: string; // e.g. "allowme.dev" or "localhost:3000"
  nonceStore: NonceStore;
  /**
   * Optional override of the per-chain public-client map. Tests inject a
   * transport with a stub `eth_call` to avoid real RPC fallbacks for
   * tampered-signature cases (which otherwise trigger the slow ERC-6492
   * contract simulation path).
   */
  clientsOverride?: Record<number, PublicClient>;
}

export interface SiweVerifySuccess {
  ok: true;
  walletAddress: string; // lowercase
  chainId: number;
  nonce: string;
}

export interface SiweVerifyFailure {
  ok: false;
  reason: SiweFailureReason;
  message?: string;
}

export type SiweVerifyResult = SiweVerifySuccess | SiweVerifyFailure;

const SUPPORTED_CHAIN_IDS = new Set<number>([base.id, baseSepolia.id]);

// Public clients for signature verification. Separate instances per chain
// so verifyHash can simulate counterfactual deploys on the right network.
const clients: Record<number, PublicClient> = {
  [base.id]: createPublicClient({ chain: base, transport: http() }) as PublicClient,
  [baseSepolia.id]: createPublicClient({ chain: baseSepolia, transport: http() }) as PublicClient,
};

export async function verifySiwe(input: SiweVerifyInput): Promise<SiweVerifyResult> {
  const { message, signature, expectedDomain, nonceStore } = input;

  // 1. Parse the SIWE message — extracts domain, address, nonce, chainId.
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch (err) {
    return {
      ok: false,
      reason: "parse-error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (!parsed.address || !parsed.nonce || !parsed.domain || typeof parsed.chainId !== "number") {
    return { ok: false, reason: "parse-error", message: "missing required SIWE fields" };
  }

  // 2. Domain binding — EIP-4361 requires the verifier's origin to match.
  if (parsed.domain !== expectedDomain) {
    return { ok: false, reason: "domain-mismatch" };
  }

  // 3. Chain ID — must be Base Mainnet or Base Sepolia.
  if (!SUPPORTED_CHAIN_IDS.has(parsed.chainId)) {
    return { ok: false, reason: "chain-unsupported" };
  }

  // 4. Nonce — must be currently issued + unconsumed. DO NOT consume yet.
  //    Replay defense: consume only after signature verifies (HE4 — invalid
  //    signature leaves the nonce intact so the user can retry without a
  //    fresh /api/auth/nonce roundtrip).
  if (!nonceStore.has(parsed.nonce)) {
    return { ok: false, reason: "nonce-invalid" };
  }

  // 5. Signature — verifySiweMessage re-parses + re-validates + calls
  //    verifyHash (public-client action) which simulates ERC-6492 deploys.
  const client = (input.clientsOverride ?? clients)[parsed.chainId];
  let isValid = false;
  try {
    isValid = await verifySiweMessage(client, {
      message,
      signature,
      domain: expectedDomain,
      nonce: parsed.nonce,
    });
  } catch (err) {
    // verifySiweMessage can throw on malformed 6492 envelopes, bad RPC, etc.
    // Treat as invalid-signature (conservative) — nonce is NOT consumed.
    return {
      ok: false,
      reason: "invalid-signature",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (!isValid) {
    return { ok: false, reason: "invalid-signature" };
  }

  // 6. Success — consume the nonce (single-use replay defense) and return.
  nonceStore.consume(parsed.nonce);

  return {
    ok: true,
    walletAddress: parsed.address.toLowerCase(),
    chainId: parsed.chainId,
    nonce: parsed.nonce,
  };
}
