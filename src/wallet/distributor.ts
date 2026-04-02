import {
  exportWallet,
  getWallet,
} from "@open-wallet-standard/core";
import {
  encodeFunctionData,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import type { Chain } from "viem";
import { CHAIN_IDS, RPC_URLS } from "../constants.js";

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

// Map CAIP-2 chain IDs to viem chain definitions
const VIEM_CHAINS: Record<string, Chain> = {
  [CHAIN_IDS.BASE_MAINNET]: base,
  [CHAIN_IDS.BASE_SEPOLIA]: baseSepolia,
};

/**
 * Handles USDC ERC-20 transfers between OWS wallets.
 *
 * Uses OWS for key storage (exportWallet) and viem for transaction
 * construction, signing, and broadcast. This gives us full control
 * over nonce, gas estimation, and EIP-1559 formatting.
 */
export class WalletDistributor {
  private passphrase: string | undefined;
  private vaultPath: string | undefined;

  constructor(passphrase?: string, vaultPath?: string) {
    this.passphrase = passphrase;
    this.vaultPath = vaultPath;
  }

  /**
   * Transfer USDC from an OWS wallet to a destination.
   *
   * @param fromWallet - OWS wallet name (e.g., "treasury")
   * @param toWallet - OWS wallet name OR label for the destination
   * @param amount - USDC amount in 6-decimal units
   * @param chainId - CAIP-2 chain ID (e.g., "eip155:8453")
   * @param usdcAddress - USDC contract address on the target chain
   * @param toAddress - Optional raw EVM address. If provided, sends directly here instead of resolving via OWS getWallet.
   */
  async transferUSDC(
    fromWallet: string,
    toWallet: string,
    amount: number,
    chainId: string,
    usdcAddress: string,
    toAddress?: string
  ): Promise<TransferResult> {
    // Resolve destination address: use raw address if provided, otherwise resolve via OWS
    let destAddress: `0x${string}`;
    if (toAddress) {
      destAddress = toAddress as `0x${string}`;
    } else {
      const destWallet = getWallet(toWallet, this.vaultPath);
      const evmAccount = destWallet.accounts.find(
        (a: { chainId: string }) => a.chainId.startsWith("eip155:")
      );
      if (!evmAccount) {
        throw new Error(`Wallet "${toWallet}" has no EVM account`);
      }
      destAddress = evmAccount.address as `0x${string}`;
    }

    // Resolve RPC and chain
    const rpcUrl = RPC_URLS[chainId];
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }
    const viemChain = VIEM_CHAINS[chainId];
    if (!viemChain) {
      throw new Error(`No viem chain definition for ${chainId}`);
    }

    // Export private key from OWS vault and create viem account
    const secret = exportWallet(fromWallet, this.passphrase, this.vaultPath);
    const account = secret.startsWith("0x") && secret.length === 66
      ? privateKeyToAccount(secret as `0x${string}`)
      : mnemonicToAccount(secret);

    // Create clients
    const publicClient = createPublicClient({
      chain: viemChain,
      transport: http(rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain: viemChain,
      transport: http(rpcUrl),
    });

    // Encode ERC-20 transfer calldata
    const transferData = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [destAddress, BigInt(amount)],
    });

    // Send transaction — viem handles nonce, gas estimation, and EIP-1559 fees
    const txHash = await walletClient.sendTransaction({
      to: usdcAddress as `0x${string}`,
      data: transferData,
      value: 0n,
    });

    // Wait for confirmation
    await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

    return {
      txHash,
      from: fromWallet,
      to: toWallet,
      amount,
    };
  }

  /**
   * Get the EVM address for an OWS wallet.
   */
  getWalletAddress(walletName: string): string {
    const wallet = getWallet(walletName, this.vaultPath);
    const evmAccount = wallet.accounts.find(
      (a: { chainId: string }) => a.chainId.startsWith("eip155:")
    );
    if (!evmAccount) {
      throw new Error(`Wallet "${walletName}" has no EVM account`);
    }
    return evmAccount.address;
  }
}

