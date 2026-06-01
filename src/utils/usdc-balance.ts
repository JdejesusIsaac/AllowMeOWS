/**
 * Sprint 4.0.3 W10 — read-only USDC `balanceOf` lookup.
 *
 * Used by `check-progress` and `check-savings` to surface the actual
 * on-chain spendable balance in the child's wallet alongside the
 * pending-ledger view. One ERC-20 `balanceOf` call per request — at
 * AllowMe scale (~10k calls/day) this is well within the public RPC
 * budget. If it becomes hot, cache by `(wallet, blockNumber)` per
 * plan §4 W10 mitigation.
 *
 * The function is intentionally tolerant: any RPC failure resolves
 * to `null` so the caller can fall back to a ledger-only display.
 * A red error banner would invert the "earned never decreases" UX
 * principle from `Copy-reference.md` §1.2 — a temporary RPC outage
 * must not erase the kid's earned number.
 */

import { createPublicClient, http } from "viem";
import { baseSepolia, base } from "viem/chains";
import type { Chain } from "viem";
import { CHAIN_IDS, RPC_URLS } from "../constants.js";
import { getWallet } from "@open-wallet-standard/core";

const VIEM_CHAINS: Record<string, Chain> = {
  [CHAIN_IDS.BASE_MAINNET]: base,
  [CHAIN_IDS.BASE_SEPOLIA]: baseSepolia,
};

const ERC20_BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Read the USDC balance (in 6-decimal micros) for an arbitrary EVM
 * address. Returns `null` on any RPC failure so the UI can degrade
 * gracefully.
 */
export async function fetchUsdcBalanceMicros(
  walletAddress: string,
  chainId: string,
  usdcAddress: string,
): Promise<number | null> {
  try {
    const rpcUrl = RPC_URLS[chainId];
    const chain = VIEM_CHAINS[chainId];
    if (!rpcUrl || !chain) return null;
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
    const raw = (await client.readContract({
      address: usdcAddress as `0x${string}`,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [walletAddress as `0x${string}`],
    })) as bigint;
    // USDC is 6 decimals → raw IS micros. Number() is safe under the
    // billion-USDC ceiling we care about (Number.MAX_SAFE_INTEGER is
    // ~9_007T micros = ~9T USDC).
    return Number(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve the EVM address for a child wallet. External wallets return
 * the configured `walletAddress`. OWS-internal wallets look up the
 * `child-<name>` entry in the family's OWS vault. Returns `null` if
 * neither path resolves.
 *
 * `vaultPath` is the per-family OWS vault dir (Sprint 2.9.1 isolation),
 * resolved by the caller via `getFamilyVaultPath(familyId)`.
 */
export function resolveChildWalletAddress(opts: {
  childName: string;
  externalAddress: string | undefined;
  owsWalletName: string;
  vaultPath: string;
}): string | null {
  if (opts.externalAddress) return opts.externalAddress;
  try {
    const wallet = getWallet(opts.owsWalletName, opts.vaultPath);
    const evm = wallet.accounts.find((a) => a.chainId.startsWith("eip155:"));
    return evm?.address ?? null;
  } catch {
    return null;
  }
}
