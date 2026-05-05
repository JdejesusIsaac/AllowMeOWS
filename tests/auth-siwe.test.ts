// Sprint 3.0 v4 — W4.1 SIWE verification tests (SI1-SI5).
//
// SI1-SI4: real EOA signatures via privateKeyToAccount + createSiweMessage.
// SI5: ERC-6492 counterfactual Smart Wallet — skipped with TODO pointing at
//      the location where a live-network fixture should be plugged in once
//      the W2.1 mobile arm completes and we have a real Base Sepolia
//      counterfactual Coinbase Wallet signature to capture.
import { describe, it, expect } from "vitest";
import { createPublicClient, custom, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { baseSepolia, base } from "viem/chains";
import { verifySiwe } from "../src/auth/siwe.js";
import { NonceStore, DEFAULT_NONCE_TTL_MS } from "../src/auth/nonce-store.js";

// Build a per-chain client map with a stub transport that reverts every
// eth_call. Keeps ERC-6492 counterfactual contract simulation from making
// real RPC requests during tampered-signature tests — viem treats the revert
// as "not a valid contract signature" and falls through to the EOA result.
function stubClients(): Record<number, PublicClient> {
  const transport = custom({
    async request() {
      throw new Error("stub-transport: no RPC in tests");
    },
  });
  return {
    [base.id]: createPublicClient({ chain: base, transport }) as PublicClient,
    [baseSepolia.id]: createPublicClient({ chain: baseSepolia, transport }) as PublicClient,
  };
}

const DOMAIN = "allowme.dev";
const URI = "https://allowme.dev/verify";
const STATEMENT = "Sign in to AllowMe to manage your family's allowance.";

async function signFixture(opts: {
  account: ReturnType<typeof privateKeyToAccount>;
  nonce: string;
  domain?: string;
  chainId?: number;
}) {
  const message = createSiweMessage({
    address: opts.account.address,
    domain: opts.domain ?? DOMAIN,
    uri: URI,
    version: "1",
    chainId: opts.chainId ?? baseSepolia.id,
    nonce: opts.nonce,
    statement: STATEMENT,
    issuedAt: new Date(),
  });
  const signature = await opts.account.signMessage({ message });
  return { message, signature };
}

describe("verifySiwe (W4.1)", () => {
  const PK = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
  const account = privateKeyToAccount(PK);

  it("SI1: valid signature with matching nonce + domain verifies", async () => {
    const nonceStore = new NonceStore();
    const nonce = nonceStore.issue();
    const { message, signature } = await signFixture({ account, nonce });

    const result = await verifySiwe({
      message,
      signature,
      expectedDomain: DOMAIN,
      nonceStore,
      clientsOverride: stubClients(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.walletAddress).toBe(account.address.toLowerCase());
      expect(result.chainId).toBe(baseSepolia.id);
      expect(result.nonce).toBe(nonce);
    }
    // Nonce is consumed on success — second attempt must fail.
    expect(nonceStore.has(nonce)).toBe(false);
  });

  it("SI2: tampered signature rejected — nonce NOT consumed (HE4 contract)", async () => {
    const nonceStore = new NonceStore();
    const nonce = nonceStore.issue();
    const { message, signature } = await signFixture({ account, nonce });

    // Flip one byte in the middle of the 65-byte sig.
    const sigBytes = Buffer.from(signature.slice(2), "hex");
    sigBytes[10] ^= 0xff;
    const tampered = ("0x" + sigBytes.toString("hex")) as `0x${string}`;

    const result = await verifySiwe({
      message,
      signature: tampered,
      expectedDomain: DOMAIN,
      nonceStore,
      clientsOverride: stubClients(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-signature");
    // Critical: nonce stays valid so the user can retry with a fresh sig.
    expect(nonceStore.has(nonce)).toBe(true);
  });

  it("SI3: wrong domain rejected (cross-origin replay defense)", async () => {
    const nonceStore = new NonceStore();
    const nonce = nonceStore.issue();
    const { message, signature } = await signFixture({
      account,
      nonce,
      domain: "evil.com",
    });

    const result = await verifySiwe({
      message,
      signature,
      expectedDomain: DOMAIN,
      nonceStore,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("domain-mismatch");
    // Nonce stays — the attempt never reached signature verification.
    expect(nonceStore.has(nonce)).toBe(true);
  });

  it("SI4: stale nonce rejected (not issued / already consumed / TTL-expired)", async () => {
    const nonceStore = new NonceStore();
    // Sign a message with a nonce that was never issued.
    const fakeNonce = "a".repeat(32);
    const { message, signature } = await signFixture({ account, nonce: fakeNonce });

    const result = await verifySiwe({
      message,
      signature,
      expectedDomain: DOMAIN,
      nonceStore,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("nonce-invalid");
  });

  it("SI6: tolerates Base Account / Coinbase Wallet message format (no Version, no Issued At)", async () => {
    // Regression fixture captured from production Railway logs after a
    // real `wallet_connect` + `signInWithEthereum` capability call from
    // Coinbase Wallet hit `/api/auth/verify`. The wallet-emitted message
    // omits the EIP-4361 `Version: 1` and `Issued At: ...` lines that
    // viem's strict `parseSiweMessage` requires. Our tolerant extractor
    // must extract domain/address/uri/chainId/nonce regardless.
    //
    // Crypto verification still flows through `client.verifyMessage` so
    // the signature must match the exact message bytes the wallet signs.
    const nonceStore = new NonceStore();
    const nonce = nonceStore.issue();
    const message =
      `${DOMAIN} wants you to sign in with your Ethereum account:\n` +
      `${account.address}\n\n` +
      `Sign in to AllowMe to manage your family's allowance.\n\n` +
      `URI: https://allowme.dev\n` +
      `Chain ID: ${baseSepolia.id}\n` +
      `Nonce: ${nonce}`;
    const signature = await account.signMessage({ message });

    const result = await verifySiwe({
      message,
      signature,
      expectedDomain: DOMAIN,
      nonceStore,
      clientsOverride: stubClients(),
    });

    // Must NOT be parse-error (the production bug). EOA signature against
    // a synthetic test key should fully verify on the stub clients.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.walletAddress).toBe(account.address.toLowerCase());
      expect(result.chainId).toBe(baseSepolia.id);
      expect(result.nonce).toBe(nonce);
    }
  });

  it.skip("SI5: ERC-6492-wrapped counterfactual Smart Wallet signature verifies (requires live-network fixture)", async () => {
    // TODO(sprint-3.0-v4): capture a real Coinbase Wallet SIWE signature from
    // a freshly-created Base Sepolia Base Account that has NOT yet been
    // deployed on-chain. The signature will be ERC-6492-wrapped. Drop the
    // fixture into `tests/fixtures/siwe-counterfactual.json` as
    // { message, signature, expectedAddress, domain, nonce } and replace
    // this skip with a real assertion that verifySiwe returns ok: true with
    // a matching walletAddress. Blocks W2.1 mobile-arm completion.
  });

  it("chain-unsupported: chain ID outside Base mainnet/sepolia rejected", async () => {
    const nonceStore = new NonceStore();
    const nonce = nonceStore.issue();
    const { message, signature } = await signFixture({
      account,
      nonce,
      chainId: 1, // Ethereum mainnet — not supported
    });

    const result = await verifySiwe({
      message,
      signature,
      expectedDomain: DOMAIN,
      nonceStore,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("chain-unsupported");
  });
});

describe("verifySiwe — TTL interaction with NonceStore", () => {
  it("nonce expires via TTL before signature check — returns nonce-invalid", async () => {
    let t = 0;
    const clock = { now: () => t };
    const nonceStore = new NonceStore(DEFAULT_NONCE_TTL_MS, clock);

    const PK = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
    const account = privateKeyToAccount(PK);
    const nonce = nonceStore.issue();
    const { message, signature } = await signFixture({ account, nonce });

    t += DEFAULT_NONCE_TTL_MS + 1;

    const result = await verifySiwe({
      message,
      signature,
      expectedDomain: DOMAIN,
      nonceStore,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("nonce-invalid");
  });
});
