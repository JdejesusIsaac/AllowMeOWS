// @ts-nocheck — Sprint 2.9: aixyz legacy tool, superseded by src/tools/
import { tool } from "ai";
import { z } from "zod";
import { getWallet } from "@open-wallet-standard/core";
import { WALLET_NAMES } from "../../src/constants.js";
import { StateManager } from "../../src/engine/state.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "./_helpers.js";

const getFundingAddress = tool({
  description: "Get the treasury wallet address so you can fund it with USDC. Manager only.",
  inputSchema: z.object({
    walletName: z.enum(["treasury", "savings-vault", "gift-fund"]).default("treasury").describe("Which wallet"),
  }),
  execute: async (args) => {
    const caller = await resolveHttpCaller();
    if (!isHttpToolAuthorized("get-funding-address", caller.role)) {
      return accessDenied("get-funding-address", caller.role);
    }
    try {
      const state = new StateManager();
      const config = await state.loadFamilyConfig();
      if (!config) {
        return JSON.stringify({ success: false, error: "No family configured." });
      }

      let wallet;
      try { wallet = getWallet(args.walletName); }
      catch { return JSON.stringify({ success: false, error: `Wallet "${args.walletName}" not found.` }); }

      const evmAccount = wallet.accounts.find((a: { chainId: string }) => a.chainId.startsWith("eip155:"));
      if (!evmAccount) {
        return JSON.stringify({ success: false, error: `Wallet "${args.walletName}" has no EVM account.` });
      }

      const network = config.chainId === "eip155:8453" ? "Base (mainnet)" : "Base Sepolia (testnet)";
      const token = config.chainId === "eip155:8453" ? "USDC" : "testnet USDC";

      const childAddresses: Array<{ name: string; address: string }> = [];
      if (args.walletName === "treasury") {
        for (const child of config.children) {
          try {
            const cw = getWallet(WALLET_NAMES.childWallet(child.name));
            const ce = cw.accounts.find((a: { chainId: string }) => a.chainId.startsWith("eip155:"));
            if (ce) childAddresses.push({ name: child.name, address: ce.address });
          } catch {}
        }
      }

      return JSON.stringify({
        success: true, walletName: args.walletName, address: evmAccount.address, network,
        childWallets: childAddresses.length > 0 ? childAddresses : undefined,
        message: `Send ${token} to ${evmAccount.address} on ${network}.`,
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
});

export default getFundingAddress;
