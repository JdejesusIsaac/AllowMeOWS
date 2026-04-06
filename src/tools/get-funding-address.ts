import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getWallet } from "@open-wallet-standard/core";
import { WALLET_NAMES } from "../constants.js";
import { StateManager } from "../engine/state.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

export function registerGetFundingAddressTool(server: McpServer): void {
  server.tool(
    "get-funding-address",
    "Get the treasury wallet address so you can fund it with USDC. Manager only.",
    {
      walletName: z.enum(["treasury", "savings-vault", "gift-fund"]).default("treasury").describe("Which wallet address to show (default: treasury)"),
      ...rbacFields,
    },
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("get-funding-address", caller.role)) {
        return buildAccessDeniedResponse("get-funding-address", caller.role);
      }
      try {
        const state = new StateManager();
        const config = await state.loadFamilyConfig();

        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No family configured. Use configure-policy first." }),
            }],
          };
        }

        const walletName = args.walletName;

        // Resolve wallet from OWS
        let wallet;
        try {
          wallet = getWallet(walletName);
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
              const childWallet = getWallet(WALLET_NAMES.childWallet(child.name));
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
    }
  );
}
