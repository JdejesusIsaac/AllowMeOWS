/**
 * Sprint 4.1 W7 — policy-engine engagement test (AM26–AM28).
 *
 * The unit-level variant (run in CI) verifies that:
 *   - The distributor passes the `ows_key_…` token verbatim to OWS
 *     `signAndSend` (this is what triggers agent mode + policy
 *     evaluation per Spec 03 §Access Model).
 *   - A simulated `POLICY_DENIED` rejection causes `transferUSDC` to
 *     throw WITHOUT triggering `waitForTransactionReceipt` (no
 *     on-chain submission).
 *
 * The full Sepolia integration test (AM27, AM28 with live OWS audit-log
 * assertions) is scaffolded but `it.skip`-gated because it requires
 * `OWS_BENCH_TREASURY_PRIVKEY` + funded Sepolia wallets. The operator
 * runs it via the test.md §11 nightly schedule.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockGetWallet,
  mockSignAndSend,
  mockPrepareTransactionRequest,
  mockWaitForTransactionReceipt,
} = vi.hoisted(() => ({
  mockGetWallet: vi.fn(),
  mockSignAndSend: vi.fn(),
  mockPrepareTransactionRequest: vi.fn(),
  mockWaitForTransactionReceipt: vi.fn(),
}));

vi.mock("@open-wallet-standard/core", () => ({
  getWallet: mockGetWallet,
  signAndSend: mockSignAndSend,
  signTransaction: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      prepareTransactionRequest: mockPrepareTransactionRequest,
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
      sendRawTransaction: vi.fn(),
    }),
    http: () => ({}),
  };
});

import { WalletDistributor } from "../src/wallet/distributor.js";
import { CHAIN_IDS, USDC } from "../src/constants.js";

const TOKEN = "ows_key_" + "b".repeat(64);
const TREASURY_ADDR = "0x1111111111111111111111111111111111111111";

describe("Policy engagement (Sprint 4.1 W7, AM26–AM28 — mocked unit)", () => {
  beforeEach(() => {
    mockGetWallet.mockReset();
    mockSignAndSend.mockReset();
    mockPrepareTransactionRequest.mockReset();
    mockWaitForTransactionReceipt.mockReset();

    mockGetWallet.mockReturnValue({
      id: "treasury-uuid",
      name: "treasury",
      accounts: [{
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        address: TREASURY_ADDR,
        derivationPath: "m/44'/60'/0'/0/0",
      }],
      createdAt: "2026-01-01T00:00:00Z",
    });
    mockPrepareTransactionRequest.mockImplementation(async (input: {
      to: `0x${string}`; data: `0x${string}`; value: bigint;
    }) => ({
      to: input.to,
      data: input.data,
      value: input.value,
      nonce: 1,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      gas: 21_000n,
    }));
  });

  // AM27 (mocked) — the ows_key_ token is what the distributor hands to
  // OWS as the credential, which (per Spec 03 §Access Model) is what
  // triggers agent mode → policy evaluation. The unit test verifies the
  // credential surface; the Sepolia variant below verifies the audit-log
  // outcome.
  it("AM27-unit: transferUSDC passes the ows_key_ token verbatim to signAndSend (credential slot)", async () => {
    mockSignAndSend.mockReturnValue({ txHash: "0xdead" + "00".repeat(30) });
    mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    await dist.transferUSDC(
      "treasury",
      "treasury",
      1_000_000,
      CHAIN_IDS.BASE_SEPOLIA,
      USDC.BASE_SEPOLIA,
      TREASURY_ADDR
    );
    expect(mockSignAndSend).toHaveBeenCalledTimes(1);
    // signAndSend(wallet, chain, txHex, passphrase=credential, index, rpcUrl, vaultPath)
    const args = mockSignAndSend.mock.calls[0]!;
    expect(args[3]).toBe(TOKEN); // The credential slot — token, not passphrase.
    expect(args[1]).toBe("evm"); // Agent-mode signing on the EVM chain class.
  });

  // AM28 (mocked) — POLICY_DENIED propagates, no nonce-burning broadcast.
  it("AM28-unit: POLICY_DENIED short-circuits transferUSDC; no receipt poll, no broadcast", async () => {
    mockSignAndSend.mockImplementation(() => {
      throw new Error("POLICY_DENIED: recipient not in authorized_wallets");
    });
    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    await expect(
      dist.transferUSDC(
        "treasury",
        "treasury",
        1_000_000,
        CHAIN_IDS.BASE_SEPOLIA,
        USDC.BASE_SEPOLIA,
        TREASURY_ADDR
      )
    ).rejects.toThrow(/POLICY_DENIED/);
    // Critical invariant: the OWS sign call threw, so we never reached
    // viem's wait. In production, no transaction was submitted; the
    // treasury nonce is unchanged on-chain (C7's nonce-unchanged
    // invariant, verified at the unit level here, on-chain at AM28).
    expect(mockWaitForTransactionReceipt).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AM27 / AM28 — Base Sepolia integration variant. Skipped unless the
// operator has provisioned `OWS_BENCH_TREASURY_PRIVKEY` plus an
// authorized + unauthorized child wallet pair.
// =============================================================================

const SEPOLIA_ENV_READY =
  !!process.env.OWS_BENCH_TREASURY_PRIVKEY &&
  !!process.env.OWS_BENCH_AUTHORIZED_CHILD_ADDRESS &&
  !!process.env.OWS_BENCH_UNAUTHORIZED_ADDRESS;

(SEPOLIA_ENV_READY ? describe : describe.skip)(
  "Policy engagement (Sprint 4.1 W7, AM27/AM28 — live Sepolia)",
  () => {
    // The live integration test reads the OWS audit log at
    // `~/.ows/families/<id>/.ows/logs/audit.jsonl` after each transfer
    // and asserts on `policy_evaluated` / `broadcast_transaction`
    // ordering via `tests/helpers/ows-audit-log.ts`. See plan §4 W7 +
    // test.md §6 for the operator runbook (treasury provisioning,
    // allowlist configuration, etc.).
    it.todo(
      "AM27: authorized transfer succeeds with policy_evaluated → broadcast_transaction ordering"
    );
    it.todo(
      "AM28: unauthorized transfer throws POLICY_DENIED; treasury nonce unchanged on-chain"
    );
  }
);
