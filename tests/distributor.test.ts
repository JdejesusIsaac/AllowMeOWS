/**
 * Sprint 4.1 W2 — `WalletDistributor` unit suite (AM11–AM20).
 *
 * The distributor is the heart of the agent-mode signing change. These
 * tests verify:
 *   - Constructor guard (AM11, AM12) — SC1.
 *   - Address resolution (AM13, AM14).
 *   - viem envelope construction (AM15, AM16).
 *   - Receipt polling (AM17).
 *   - Backward-compatible `TransferResult` shape (AM18) — SC4.
 *   - `signAndSend` ↔ `sign` fallback (AM19) — D3.
 *   - `POLICY_DENIED` propagation (AM20) — SC2.
 *
 * Strategy: mock the OWS SDK module so we don't touch a real vault or
 * RPC. viem is real but we use a mocked `publicClient.prepareTransactionRequest`
 * via `vi.spyOn` where needed. The fallback (AM19) is exercised by
 * deleting `signAndSend` from the mock module at runtime.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseTransaction } from "viem";

// Hoisted mock state — `vi.mock` factories are pulled above all imports;
// top-level `const`s aren't initialized when the factory runs, so the
// shared spies live inside `vi.hoisted`.
const {
  mockGetWallet,
  mockSignAndSend,
  mockSignTransaction,
  mockPrepareTransactionRequest,
  mockWaitForTransactionReceipt,
  mockSendRawTransaction,
} = vi.hoisted(() => ({
  mockGetWallet: vi.fn(),
  mockSignAndSend: vi.fn(),
  mockSignTransaction: vi.fn(),
  mockPrepareTransactionRequest: vi.fn(),
  mockWaitForTransactionReceipt: vi.fn(),
  mockSendRawTransaction: vi.fn(),
}));

vi.mock("@open-wallet-standard/core", () => ({
  getWallet: mockGetWallet,
  signAndSend: mockSignAndSend,
  signTransaction: mockSignTransaction,
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      prepareTransactionRequest: mockPrepareTransactionRequest,
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
      sendRawTransaction: mockSendRawTransaction,
    }),
    http: () => ({}),
  };
});

import { WalletDistributor } from "../src/wallet/distributor.js";
import { CHAIN_IDS, USDC } from "../src/constants.js";

const TOKEN = "ows_key_" + "a".repeat(64);
const TREASURY_ADDR = "0x1111111111111111111111111111111111111111";
const CHILD_ADDR = "0x2222222222222222222222222222222222222222";
const TX_HASH = "0xdeadbeef" + "00".repeat(28);

function defaultWalletStub(name: string, id: string, address: string) {
  return {
    id,
    name,
    accounts: [{ chainId: CHAIN_IDS.BASE_SEPOLIA, address, derivationPath: "m/44'/60'/0'/0/0" }],
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function defaultPreparedTx(input?: {
  to?: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
}) {
  return {
    to: input?.to ?? (USDC.BASE_SEPOLIA as `0x${string}`),
    data: input?.data ?? ("0x" as `0x${string}`),
    value: input?.value ?? 0n,
    nonce: 7,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 100_000_000n,
    gas: 21_000n,
  };
}

describe("WalletDistributor (Sprint 4.1 W2, AM11–AM20)", () => {
  beforeEach(() => {
    mockGetWallet.mockReset();
    mockSignAndSend.mockReset();
    mockSignTransaction.mockReset();
    mockPrepareTransactionRequest.mockReset();
    mockWaitForTransactionReceipt.mockReset();
    mockSendRawTransaction.mockReset();

    // Default happy-path wiring.
    mockGetWallet.mockImplementation((name: string) => {
      if (name === "treasury") {
        return defaultWalletStub("treasury", "treasury-uuid", TREASURY_ADDR);
      }
      if (name === "child-maya") {
        return defaultWalletStub("child-maya", "child-uuid", CHILD_ADDR);
      }
      throw new Error(`unknown wallet ${name}`);
    });
    // Pass-through: real viem returns the input `to`/`data`/`value`
    // alongside computed nonce/gas/fees, so the mock mirrors that.
    mockPrepareTransactionRequest.mockImplementation(async (input: {
      to: `0x${string}`;
      data: `0x${string}`;
      value: bigint;
    }) => defaultPreparedTx({ to: input.to, data: input.data, value: input.value }));
    mockSignAndSend.mockReturnValue({ txHash: TX_HASH });
    mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  // AM11 — constructor accepts a valid token.
  it("AM11: constructor accepts a valid ows_key_… token", () => {
    expect(() => new WalletDistributor(TOKEN, "/tmp/vault")).not.toThrow();
  });

  // AM12 — constructor rejects non-token credentials (SC1).
  it("AM12: constructor rejects passphrases, empty strings, and undefined", () => {
    expect(() => new WalletDistributor("not-a-token", "/tmp/vault")).toThrow(
      /ows_key_|FamilyApiTokenManager/i
    );
    expect(() => new WalletDistributor("password123!", "/tmp/vault")).toThrow(
      /ows_key_|FamilyApiTokenManager/i
    );
    expect(() => new WalletDistributor("", "/tmp/vault")).toThrow(
      /ows_key_|FamilyApiTokenManager/i
    );
    expect(() =>
      new WalletDistributor(undefined as unknown as string, "/tmp/vault")
    ).toThrow(/ows_key_|FamilyApiTokenManager/i);
  });

  // AM13 — getWalletAddress returns EVM address.
  it("AM13: getWalletAddress returns the EVM address via OWS lookup", () => {
    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    expect(dist.getWalletAddress("treasury")).toBe(TREASURY_ADDR);
  });

  // AM14 — walletId (UUID) passed to signAndSend, not the name.
  it("AM14: transferUSDC passes the wallet UUID to signAndSend (not the name)", async () => {
    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    await dist.transferUSDC(
      "treasury",
      "child-maya",
      1_000_000,
      CHAIN_IDS.BASE_SEPOLIA,
      USDC.BASE_SEPOLIA
    );
    expect(mockSignAndSend).toHaveBeenCalledTimes(1);
    const args = mockSignAndSend.mock.calls[0]!;
    expect(args[0]).toBe("treasury-uuid"); // UUID, not "treasury"
  });

  // AM15 — RPC URL is forwarded to signAndSend.
  it("AM15: transferUSDC forwards the configured RPC URL to signAndSend", async () => {
    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    await dist.transferUSDC(
      "treasury",
      "child-maya",
      1_000_000,
      CHAIN_IDS.BASE_SEPOLIA,
      USDC.BASE_SEPOLIA
    );
    const args = mockSignAndSend.mock.calls[0]!;
    // signAndSend signature: (wallet, chain, txHex, passphrase, index, rpcUrl, vaultPath)
    expect(args[5]).toContain("base-sepolia");
    // chain arg is "evm", NOT the CAIP-2 string
    expect(args[1]).toBe("evm");
  });

  // AM16 — EIP-1559 envelope is built correctly.
  it("AM16: transferUSDC builds an EIP-1559 envelope with the correct fields", async () => {
    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    await dist.transferUSDC(
      "treasury",
      "child-maya",
      1_500_000,
      CHAIN_IDS.BASE_SEPOLIA,
      USDC.BASE_SEPOLIA
    );
    const args = mockSignAndSend.mock.calls[0]!;
    const txHex = args[2] as string;
    // Re-prefix because we strip 0x before handing to OWS.
    const parsed = parseTransaction(`0x${txHex}` as `0x${string}`);
    expect(parsed.type).toBe("eip1559");
    expect(parsed.to?.toLowerCase()).toBe(USDC.BASE_SEPOLIA.toLowerCase());
    // viem's parseTransaction returns `value: undefined` for RLP-encoded
    // 0n (empty bytes). Both representations are semantically zero.
    expect(parsed.value ?? 0n).toBe(0n);
    expect(parsed.chainId).toBe(84532);
    expect(parsed.nonce).toBe(7);
    expect(parsed.maxFeePerGas).toBe(1_000_000_000n);
    expect(parsed.maxPriorityFeePerGas).toBe(100_000_000n);
    expect(parsed.gas).toBe(21_000n);
    // Data is ERC-20 transfer(child, amount). Selector 0xa9059cbb.
    expect(parsed.data?.slice(0, 10)).toBe("0xa9059cbb");
    // Amount is the last 32 bytes of calldata.
    expect(BigInt(`0x${parsed.data!.slice(-64)}`)).toBe(1_500_000n);
  });

  // AM17 — waitForTransactionReceipt is invoked with the hash from OWS.
  it("AM17: transferUSDC waits for the receipt of the OWS-returned tx hash", async () => {
    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    await dist.transferUSDC(
      "treasury",
      "child-maya",
      1_000_000,
      CHAIN_IDS.BASE_SEPOLIA,
      USDC.BASE_SEPOLIA
    );
    expect(mockWaitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(mockWaitForTransactionReceipt.mock.calls[0]![0]).toMatchObject({
      hash: TX_HASH,
      timeout: 60_000,
    });
  });

  // AM18 — TransferResult shape preserved (SC4).
  it("AM18: transferUSDC returns the legacy {txHash, from, to, amount} shape", async () => {
    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    const result = await dist.transferUSDC(
      "treasury",
      "child-maya",
      1_000_000,
      CHAIN_IDS.BASE_SEPOLIA,
      USDC.BASE_SEPOLIA
    );
    expect(result).toEqual({
      txHash: TX_HASH,
      from: "treasury",
      to: "child-maya",
      amount: 1_000_000,
    });
    // Confirms no extra keys (the existing distributor returned exactly
    // these four — `Object.keys` would change between versions otherwise).
    expect(Object.keys(result).sort()).toEqual(["amount", "from", "to", "txHash"]);
  });

  // AM19 — sign + manual broadcast fallback (D3). Lives in
  // `tests/distributor-fallback.test.ts` because vitest 3's strict-mock
  // mode forbids deleting/undefining a declared mock export at runtime;
  // a dedicated mock factory without `signAndSend` is the cleanest way
  // to exercise the fallback branch.
  it.skip("AM19: see tests/distributor-fallback.test.ts (separate mock setup)", () => {});

  // AM20 — POLICY_DENIED propagates with the OWS message preserved.
  it("AM20: POLICY_DENIED from OWS propagates with the message preserved", async () => {
    mockSignAndSend.mockImplementation(() => {
      const err = new Error("POLICY_DENIED: recipient not in authorized_wallets");
      throw err;
    });
    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    await expect(
      dist.transferUSDC(
        "treasury",
        "child-maya",
        1_000_000,
        CHAIN_IDS.BASE_SEPOLIA,
        USDC.BASE_SEPOLIA
      )
    ).rejects.toThrow(/POLICY_DENIED/);
    // Crucially, waitForTransactionReceipt is NOT called when signing
    // throws (no nonce was burned).
    expect(mockWaitForTransactionReceipt).not.toHaveBeenCalled();
  });

  // Extra invariant — chain ID without a CAIP-2 → OWS mapping rejects early.
  it("rejects an unmapped CAIP-2 chain ID before any OWS call", async () => {
    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    await expect(
      dist.transferUSDC(
        "treasury",
        "child-maya",
        1_000_000,
        "eip155:9999",
        USDC.BASE_SEPOLIA
      )
    ).rejects.toThrow(/RPC URL|chain/i);
    expect(mockSignAndSend).not.toHaveBeenCalled();
  });

  // Extra invariant — raw toAddress takes precedence over toWallet lookup.
  it("accepts a raw toAddress and skips the destination OWS lookup", async () => {
    const dist = new WalletDistributor(TOKEN, "/tmp/vault");
    const RAW = "0x3333333333333333333333333333333333333333";
    await dist.transferUSDC(
      "treasury",
      "destination-label",
      1_000_000,
      CHAIN_IDS.BASE_SEPOLIA,
      USDC.BASE_SEPOLIA,
      RAW
    );
    // Only the source wallet should have been resolved — destination
    // bypassed.
    expect(mockGetWallet).toHaveBeenCalledTimes(1);
    expect(mockGetWallet).toHaveBeenCalledWith("treasury", "/tmp/vault");
    // The encoded calldata should target RAW.
    const args = mockSignAndSend.mock.calls[0]!;
    const txHex = args[2] as string;
    const parsed = parseTransaction(`0x${txHex}` as `0x${string}`);
    // Last 20 bytes of the address arg in calldata is at offset 4 (selector)
    // + 12 (zero-pad) = 16 chars → next 40 chars = address.
    const addrFromCalldata =
      "0x" + parsed.data!.slice(2 + 8 + 24, 2 + 8 + 24 + 40);
    expect(addrFromCalldata.toLowerCase()).toBe(RAW.toLowerCase());
  });
});
