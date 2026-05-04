import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { USDC, CHAIN_IDS, DEFAULT_SAVINGS_PERCENT } from "../constants.js";
import {
  configureFamilyCore,
  validateChildren,
  normalizeChildren,
  type ConfigureFamilyResult,
} from "../core/configure-family.js";
import {
  withAccessControl,
  rbacFields,
  type ToolResponse,
} from "../middleware/access-control.js";

export function registerConfigurePolicyTool(server: McpServer): void {
  server.tool(
    "configure-policy",
    "Set up or update allowance rules for your family. Example: 'Maya gets $15/week: 40% reading, 35% movement, 25% creativity, 20% savings.'",
    {
      familyName: z.string().describe("Your family name"),
      children: z.array(
        z.object({
          name: z.string().describe("Child's name"),
          walletAddress: z
            .string()
            .optional()
            .describe(
              "External EVM wallet address (e.g. MetaMask). If omitted, OWS creates a wallet for this child."
            ),
          weeklyBudgetUsd: z
            .number()
            .positive()
            .describe("Weekly allowance in USD (e.g. 15 for $15)"),
          categories: z
            .array(
              z.object({
                name: z
                  .string()
                  .min(1)
                  .max(50)
                  .describe(
                    "Category name (e.g. 'reading', 'movement', 'AI subscriptions')"
                  ),
                pct: z
                  .number()
                  .min(0)
                  .max(100)
                  .describe("Percentage of weekly budget for this category"),
              })
            )
            .min(1)
            .max(10)
            .describe("Budget categories with percentages (must sum to ≤ 100%)"),
          savingsPercent: z
            .number()
            .min(0)
            .max(100)
            .default(DEFAULT_SAVINGS_PERCENT)
            .describe("% of earned allowance routed to savings"),
          learningGoals: z
            .array(
              z.object({
                topic: z
                  .string()
                  .min(1)
                  .max(200)
                  .describe(
                    "What the child should learn (e.g. 'Fractions — equivalent fractions')"
                  ),
                category: z
                  .string()
                  .min(1)
                  .describe(
                    "Which configured category this goal counts toward (e.g. 'education')"
                  ),
              })
            )
            .max(20)
            .optional()
            .describe(
              "Optional parent-defined curriculum (max 20). Achievements auto-match goals via category + description."
            ),
        })
      ).describe("Children to configure"),
      useTestnet: z
        .boolean()
        .default(true)
        .describe("Use Base Sepolia testnet (recommended for setup)"),
      ...rbacFields,
    },
    withAccessControl("configure-policy", async (args, caller) => {
      try {
        const useTestnet = args.useTestnet as boolean;
        const chainId = useTestnet ? CHAIN_IDS.BASE_SEPOLIA : CHAIN_IDS.BASE_MAINNET;
        const usdcAddress = useTestnet ? USDC.BASE_SEPOLIA : USDC.BASE_MAINNET;

        const rawChildren = args.children as Parameters<typeof normalizeChildren>[0];

        const validationError = validateChildren(rawChildren);
        if (validationError) {
          return jsonResponse({ success: false, error: validationError });
        }

        const children = normalizeChildren(rawChildren);

        const result = await configureFamilyCore(
          {
            familyName: args.familyName as string,
            children,
            chainId,
            usdcAddress,
            useTestnet,
          },
          caller
        );

        return jsonResponse(toMcpPayload(result, useTestnet));
      } catch (error) {
        return jsonResponse({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    })
  );
}

function jsonResponse(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function toMcpPayload(result: ConfigureFamilyResult, useTestnet: boolean): unknown {
  const network = useTestnet ? "Base Sepolia (testnet)" : "Base (mainnet)";

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  if (result.bootstrap) {
    return {
      success: true,
      bootstrap: true,
      familyId: result.familyId,
      memberId: result.memberId,
      setupCode: result.setupCode,
      mcpUrl: result.mcpUrl,
      familyName: result.familyName,
      network,
      children: result.children,
      walletsCreated: true,
      message:
        `Family "${result.familyName}" created! You are Manager. ` +
        `To continue using AllowanceAgent, update your MCP connector URL to:\n\n${result.mcpUrl}\n\n` +
        `The setup code expires in 48 hours. You can invite co-parents and learners from here. ` +
        `For a longer-lived 30-day code, visit https://allowme.dev/verify and sign in with your Base wallet.`,
    };
  }

  return {
    success: true,
    bootstrap: false,
    familyId: result.familyId,
    familyName: result.familyName,
    network,
    children: result.children,
    walletsCreated: true,
    message: `Family "${result.familyName}" configured! Wallets and policies are set up. You're ready to verify achievements.`,
  };
}
