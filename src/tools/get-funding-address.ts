import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getWallet } from "@open-wallet-standard/core";
import { WALLET_NAMES } from "../constants.js";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
} from "../middleware/access-control.js";

export function registerGetFundingAddressTool(server: McpServer): void {
  server.tool(
    "get-funding-address",
    "Get the treasury wallet address so you can fund it with USDC. Manager only.",
    {
      walletName: z.enum(["treasury", "savings-vault", "gift-fund"]).default("treasury").describe("Which wallet address to show (default: treasury)"),
      ...rbacFields,
    },
    withAccessControl("get-funding-address", async (args, caller) => {
      if (!caller) return buildNoIdentityResponse("get-funding-address");
      const walletName = args.walletName as "treasury" | "savings-vault" | "gift-fund";
      try {
        const state = new StateManager();
        const familyId = caller.familyId;
        const config = await state.loadFamilyConfig(familyId);

        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No family configured. Use configure-policy first." }),
            }],
          };
        }

        // Resolve wallet from OWS — each family has its own OWS vault
        // (Sprint 2.9.1), so we must pass the per-family vault path.
        const vaultPath = getFamilyVaultPath(familyId);
        let wallet;
        try {
          wallet = getWallet(walletName, vaultPath);
        } catch {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Wallet "${walletName}" not found. Run configure-policy first to create wallets.`,
              }),
            }],
          };
        }

        // Find the EVM account
        const evmAccount = wallet.accounts.find(
          (a: { chainId: string }) => a.chainId.startsWith("eip155:")
        );

        if (!evmAccount) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Wallet "${walletName}" has no EVM account.`,
              }),
            }],
          };
        }

        const network = config.chainId === "eip155:8453" ? "Base (mainnet)" : "Base Sepolia (testnet)";
        const token = config.chainId === "eip155:8453" ? "USDC" : "testnet USDC";

        // Also resolve child wallet addresses if treasury requested
        const childAddresses: Array<{ name: string; address: string }> = [];
        if (walletName === "treasury") {
          for (const child of config.children) {
            try {
              const childWallet = getWallet(WALLET_NAMES.childWallet(child.name), vaultPath);
              const childEvm = childWallet.accounts.find(
                (a: { chainId: string }) => a.chainId.startsWith("eip155:")
              );
              if (childEvm) {
                childAddresses.push({ name: child.name, address: childEvm.address });
              }
            } catch {
              // Child wallet may not exist yet
            }
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              walletName,
              address: evmAccount.address,
              network,
              childWallets: childAddresses.length > 0 ? childAddresses : undefined,
              message:
                `Send ${token} to this address on ${network}:\n\n` +
                `  ${evmAccount.address}\n\n` +
                (childAddresses.length > 0
                  ? `Child wallets:\n${childAddresses.map((c) => `  ${c.name}: ${c.address}`).join("\n")}\n\n`
                  : "") +
                `Once funded, use distribute-allowance to send rewards to your children.`,
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          }],
        };
      }
    })
  );
}
