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
import type { NonceStore } from "./nonce-store.js";

/**
 * Tolerant SIWE field extraction.
 *
 * Why not viem's `parseSiweMessage`? Coinbase Wallet's `wallet_connect`
 * +`signInWithEthereum` capability produces messages that omit two
 * EIP-4361 mandatory fields (`Version: 1` and `Issued At: ...`).
 * viem's strict parser then fails to extract `chainId` (because the
 * grammar rule expects `Version` immediately before it), and the
 * verifier returns parse-error before we ever reach the signature check.
 *
 * We extract the four fields we actually need with simple line-anchored
 * regexes and let `client.verifyMessage` handle the cryptographic
 * verification independently (which works against any signed bytes,
 * EIP-4361-shaped or not, and still supports ERC-6492 counterfactual
 * Smart Wallets via the public client's deploy-bytecode simulation).
 *
 * Replay defense remains intact:
 *   - domain check binds the message to our origin
 *   - chainId check rejects non-Base messages
 *   - single-use NonceStore rejects replays
 *   - signature check still cryptographically binds wallet → message
 *
 * Issued-At / Expiration-Time enforcement is currently delegated to the
 * NonceStore TTL (5 min by default) since the wallet doesn't emit those
 * fields. If a future Base Account SDK release starts emitting them, we
 * can layer in stricter time-bound checks.
 */
function extractSiweFields(message: string): {
  domain?: string;
  address?: `0x${string}`;
  uri?: string;
  chainId?: number;
  nonce?: string;
} {
  // Line 1: "${domain} wants you to sign in with your Ethereum account:"
  const domainMatch = message.match(/^(\S+) wants you to sign in with your Ethereum account:/);
  // Address: first 0x-prefixed 40-hex line in the message body
  const addressMatch = message.match(/^(0x[a-fA-F0-9]{40})\s*$/m);
  const uriMatch = message.match(/^URI:\s*(.+)$/m);
  const chainIdMatch = message.match(/^Chain ID:\s*(\d+)\s*$/m);
  const nonceMatch = message.match(/^Nonce:\s*([A-Za-z0-9_-]+)\s*$/m);

  return {
    domain: domainMatch?.[1],
    address: addressMatch?.[1] as `0x${string}` | undefined,
    uri: uriMatch?.[1].trim(),
    chainId: chainIdMatch ? Number(chainIdMatch[1]) : undefined,
    nonce: nonceMatch?.[1],
  };
}

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

  // 1. Tolerant field extraction (works for both strict EIP-4361 and the
  //    Base Account / Coinbase Wallet variant that omits Version + Issued At).
  const parsed = extractSiweFields(message);

  if (!parsed.address || !parsed.nonce || !parsed.domain || typeof parsed.chainId !== "number") {
    return {
      ok: false,
      reason: "parse-error",
      message: `missing required SIWE fields: ${JSON.stringify({
        hasDomain: !!parsed.domain,
        hasAddress: !!parsed.address,
        hasChainId: typeof parsed.chainId === "number",
        hasNonce: !!parsed.nonce,
      })}`,
    };
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

  // 5. Signature — `client.verifyMessage` (public-client action) handles
  //    EIP-191 personal_sign, ERC-1271 contract signatures, AND ERC-6492
  //    counterfactual Smart Wallet deploys. We bypass viem's SIWE-specific
  //    `verifySiweMessage` because it strictly re-parses the message and
  //    rejects the Base Account format (missing Version line). Cryptographic
  //    binding is identical — the signature is over the exact bytes the
  //    wallet signed.
  const client = (input.clientsOverride ?? clients)[parsed.chainId];
  let isValid = false;
  try {
    isValid = await client.verifyMessage({
      address: parsed.address,
      message,
      signature,
    });
  } catch (err) {
    // verifyMessage can throw on malformed 6492 envelopes, bad RPC, etc.
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
