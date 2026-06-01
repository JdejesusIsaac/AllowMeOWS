// Named imports — resolved at module-load time, so missing exports
// produce a clean `undefined` binding rather than a runtime proxy throw.
// This makes the D3 `signAndSend` → `signTransaction` fallback testable
// without touching live mock proxies. `// @ts-expect-error` is NOT used
// because both names are declared in @open-wallet-standard/core@1.2.0;
// the runtime fallback is purely defensive against a future SDK build.
import {
  getWallet,
  signAndSend,
  signTransaction,
} from "@open-wallet-standard/core";
import {
  encodeFunctionData,
  createPublicClient,
  http,
  serializeTransaction,
} from "viem";
import { baseSepolia, base } from "viem/chains";
import type { Chain } from "viem";
import { CHAIN_IDS, RPC_URLS } from "../constants.js";
import { OWS_TOKEN_PREFIX } from "../keys/family-api-tokens.js";

// Minimal ERC-20 ABI for transfer
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

interface TransferResult {
  txHash: string;
  from: string;
  to: string;
  amount: number;
}

// Map CAIP-2 chain IDs to viem chain definitions.
const VIEM_CHAINS: Record<string, Chain> = {
  [CHAIN_IDS.BASE_MAINNET]: base,
  [CHAIN_IDS.BASE_SEPOLIA]: baseSepolia,
};

// Sprint 4.1 — Map CAIP-2 chain IDs to OWS chain names. The OWS SDK uses
// short names like "evm" / "solana" / "btc" (see README CLI examples). The
// specific EVM network (mainnet vs Sepolia) is determined by the `rpcUrl`
// argument, not by the `chain` name.
const OWS_CHAIN_NAMES: Record<string, string> = {
  [CHAIN_IDS.BASE_MAINNET]: "evm",
  [CHAIN_IDS.BASE_SEPOLIA]: "evm",
};

/**
 * Sprint 4.1 — agent-mode USDC distributor.
 *
 * Engages the OWS policy engine on every transfer by signing through
 * `signAndSend` with an `ows_key_…` API token (per OWS Spec 03 §Access
 * Model: an `ows_key_…` credential triggers agent mode → policy
 * evaluation + HKDF decryption; any other string triggers owner mode
 * → scrypt decryption with no policy. We refuse non-token credentials
 * at construction so the bypass path is structurally unreachable
 * here.)
 *
 * The mnemonic never enters Node's address space on the hot path. The
 * unsigned EIP-1559 envelope is built by viem, handed to OWS as hex,
 * and the signed broadcast happens inside the OWS Rust core. We get
 * back only the transaction hash.
 */
export class WalletDistributor {
  private apiToken: string;
  private vaultPath: string | undefined;

  constructor(apiToken: string, vaultPath?: string) {
    if (
      typeof apiToken !== "string" ||
      apiToken.length === 0 ||
      !apiToken.startsWith(OWS_TOKEN_PREFIX)
    ) {
      throw new Error(
        `WalletDistributor requires an OWS API token (must start with ` +
          `"${OWS_TOKEN_PREFIX}"). Owner-mode signing (passphrase) is no ` +
          `longer supported. Use FamilyApiTokenManager.getToken(familyId) ` +
          `or lazyMintTokenForLegacyFamily(familyId) to obtain a token.`
      );
    }
    this.apiToken = apiToken;
    this.vaultPath = vaultPath;
  }

  /**
   * Transfer USDC via OWS agent-mode signing.
   *
   * Flow (post-4.1):
   *   1. Resolve source wallet's canonical UUID + EVM address via OWS
   *      `getWallet` (read-only vault lookup).
   *   2. Resolve destination address (raw or via OWS lookup).
   *   3. viem `prepareTransactionRequest` + `serializeTransaction` build
   *      the unsigned EIP-1559 envelope (handles nonce, gas estimation,
   *      EIP-1559 fee fields).
   *   4. OWS `signAndSend` evaluates the registered policy, decrypts in
   *      hardened memory, signs, and broadcasts via the supplied
   *      `rpcUrl`. Returns the on-chain tx hash.
   *   5. viem `waitForTransactionReceipt` polls for confirmation.
   *
   * The OWS audit log at `~/.ows/families/<id>/.ows/logs/audit.jsonl`
   * gains a `policy_evaluated` entry per call (success or deny).
   *
   * @param fromWallet  OWS wallet name (e.g., "treasury").
   * @param toWallet    OWS wallet name OR label for the destination.
   * @param amount      USDC amount in 6-decimal units.
   * @param chainId     CAIP-2 chain ID (e.g., "eip155:84532").
   * @param usdcAddress USDC contract address on the target chain.
   * @param toAddress   Optional raw EVM address. If provided, sends
   *                    directly here instead of resolving `toWallet`
   *                    via OWS `getWallet`.
   */
  async transferUSDC(
    fromWallet: string,
    toWallet: string,
    amount: number,
    chainId: string,
    usdcAddress: string,
    toAddress?: string
  ): Promise<TransferResult> {
    // Resolve chain + RPC config.
    const rpcUrl = RPC_URLS[chainId];
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }
    const viemChain = VIEM_CHAINS[chainId];
    if (!viemChain) {
      throw new Error(`No viem chain definition for ${chainId}`);
    }
    const owsChain = OWS_CHAIN_NAMES[chainId];
    if (!owsChain) {
      throw new Error(`No OWS chain mapping for ${chainId}`);
    }

    // Resolve source wallet — get canonical UUID (Spec 01 §Field
    // Definitions) + EVM address for the envelope builder.
    const sourceWallet = getWallet(fromWallet, this.vaultPath);
    const sourceEvm = sourceWallet.accounts.find((a) =>
      a.chainId.startsWith("eip155:")
    );
    if (!sourceEvm) {
      throw new Error(`Wallet "${fromWallet}" has no EVM account`);
    }
    const sourceAddress = sourceEvm.address as `0x${string}`;
    const walletId = sourceWallet.id;

    // Resolve destination address.
    let destAddress: `0x${string}`;
    if (toAddress) {
      destAddress = toAddress as `0x${string}`;
    } else {
      const destWallet = getWallet(toWallet, this.vaultPath);
      const destEvm = destWallet.accounts.find((a) =>
        a.chainId.startsWith("eip155:")
      );
      if (!destEvm) {
        throw new Error(`Wallet "${toWallet}" has no EVM account`);
      }
      destAddress = destEvm.address as `0x${string}`;
    }

    // Encode the ERC-20 `transfer(to, amount)` calldata.
    const transferData = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [destAddress, BigInt(amount)],
    });

    // Build the unsigned EIP-1559 envelope.
    const publicClient = createPublicClient({
      chain: viemChain,
      transport: http(rpcUrl),
    });
    const prepared = await publicClient.prepareTransactionRequest({
      account: sourceAddress,
      chain: viemChain,
      to: usdcAddress as `0x${string}`,
      data: transferData,
      value: 0n,
    });
    const unsignedHex = serializeTransaction({
      chainId: viemChain.id,
      nonce: prepared.nonce!,
      maxFeePerGas: prepared.maxFeePerGas!,
      maxPriorityFeePerGas: prepared.maxPriorityFeePerGas!,
      gas: prepared.gas!,
      to: prepared.to,
      data: prepared.data,
      value: 0n,
      type: "eip1559",
    });
    // OWS Rust core accepts hex with or without the `0x` prefix per the
    // README CLI example (`--tx "deadbeef..."`). We strip the prefix
    // defensively — agreement seen across the OWS test corpus.
    const owsTxHex = unsignedHex.startsWith("0x")
      ? unsignedHex.slice(2)
      : unsignedHex;

    // Sign + broadcast via OWS. Token (`ows_key_…`) in the credential
    // slot engages the policy engine before decryption. If the policy
    // rejects, OWS throws POLICY_DENIED and no key material is
    // touched — we propagate the error as-is so the caller can
    // distinguish it from network failures.
    let txHash: `0x${string}`;
    // Sprint 4.1 D3 — runtime fallback if a future OWS SDK build drops
    // `signAndSend`. v1.2.0 exports it; the branch is defensive only.
    // Named imports above resolve to `undefined` when the symbol is
    // missing from the runtime module, so `typeof` works whether the
    // SDK omits the export or vitest mocks it away.
    const signAndSendFn = signAndSend as
      | undefined
      | typeof signAndSend;
    const signTransactionFn = signTransaction as
      | undefined
      | typeof signTransaction;
    if (typeof signAndSendFn === "function") {
      const result = signAndSendFn(
        walletId,
        owsChain,
        owsTxHex,
        this.apiToken,
        undefined,
        rpcUrl,
        this.vaultPath
      );
      txHash = result.txHash as `0x${string}`;
    } else if (typeof signTransactionFn === "function") {
      const signed = signTransactionFn(
        walletId,
        owsChain,
        owsTxHex,
        this.apiToken,
        undefined,
        this.vaultPath
      );
      const sigHex = signed.signature.startsWith("0x")
        ? signed.signature
        : (`0x${signed.signature}` as `0x${string}`);
      txHash = await publicClient.sendRawTransaction({
        serializedTransaction: sigHex as `0x${string}`,
      });
    } else {
      throw new Error(
        "@open-wallet-standard/core exports neither signAndSend nor " +
          "signTransaction — cannot proceed with agent-mode signing."
      );
    }

    // Wait for confirmation (timeout matches pre-4.1 behaviour).
    await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 60_000,
    });

    return {
      txHash,
      from: fromWallet,
      to: toWallet,
      amount,
    };
  }

  /**
   * Read-only OWS lookup. Returns the EVM address for a vault wallet
   * by name. Does not require the API token.
   */
  getWalletAddress(walletName: string): string {
    const wallet = getWallet(walletName, this.vaultPath);
    const evmAccount = wallet.accounts.find((a) =>
      a.chainId.startsWith("eip155:")
    );
    if (!evmAccount) {
      throw new Error(`Wallet "${walletName}" has no EVM account`);
    }
    return evmAccount.address;
  }
}
