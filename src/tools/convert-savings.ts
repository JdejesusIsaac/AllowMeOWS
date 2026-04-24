import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { USDC } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
} from "../middleware/access-control.js";

export function registerConvertSavingsTool(server: McpServer): void {
  server.tool(
    "convert-savings",
    "Record a Claude-orchestrated MoonPay swap result: marks USDC savings as converted and creates a new PAXG entry. Manager only. AllowanceAgent is the ledger — MoonPay is the execution engine.",
    {
      childName: z.string().describe("Name of the child whose savings to convert"),
      usdcAmount: z.number().int().positive().describe("USDC amount to convert (6-decimal units, e.g. 3000000 = $3.00)"),
      receivedAsset: z.enum(["PAXG"]).describe("Asset received from the swap"),
      receivedAmount: z.string().describe("Amount of asset received (e.g. '0.00268' PAXG — stored as string to avoid precision loss)"),
      txHash: z.string().describe("MoonPay swap transaction hash"),
      priceAtConversion: z.number().positive().describe("USD price per unit of received asset at time of swap (e.g. 4660.00 for PAXG)"),
      ...rbacFields,
    },
    withAccessControl("convert-savings", async (args, caller) => {
      if (!caller) return buildNoIdentityResponse("convert-savings");
      const childName = args.childName as string;
      const usdcAmount = args.usdcAmount as number;
      const receivedAsset = args.receivedAsset as "PAXG";
      const receivedAmount = args.receivedAmount as string;
      const txHash = args.txHash as string;
      const priceAtConversion = args.priceAtConversion as number;
      try {
        const state = new StateManager();
        const familyId = caller.familyId;
        const config = await state.loadFamilyConfig(familyId);

        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No family configured." }),
            }],
          };
        }

        // Validate child exists in config
        const childConfig = config.children.find(
          (c) => c.name.toLowerCase() === childName.toLowerCase()
        );
        if (!childConfig) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "Child not found." }),
            }],
          };
        }

        // Load all savings entries for this family (need full list to save back)
        const allEntries = await state.loadSavingsEntries(familyId);
        const childEntries = allEntries.filter(
          (e) =>
            e.childName.toLowerCase() === childName.toLowerCase() &&
            !e.released &&
            !e.converted &&
            (e.asset === "USDC" || !e.asset) // backward compat: entries without asset field are USDC
        );

        // Calculate available USDC balance
        const availableUsdc = childEntries.reduce((sum, e) => sum + e.amount, 0);

        if (availableUsdc < usdcAmount) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Insufficient USDC savings. Available: $${(availableUsdc / 10 ** USDC.DECIMALS).toFixed(2)}, requested: $${(usdcAmount / 10 ** USDC.DECIMALS).toFixed(2)}`,
              }),
            }],
          };
        }

        // Consume USDC entries (FIFO — oldest first)
        const sorted = childEntries.sort(
          (a, b) => new Date(a.depositedAt).getTime() - new Date(b.depositedAt).getTime()
        );

        let remaining = usdcAmount;
        const consumedEntryIds: string[] = [];

        for (const entry of sorted) {
          if (remaining <= 0) break;

          if (entry.amount <= remaining) {
            // Fully consume this entry
            entry.converted = true;
            remaining -= entry.amount;
            consumedEntryIds.push(entry.id);
          } else {
            // Partially consume: split entry
            const originalAmount = entry.amount;
            entry.amount = originalAmount - remaining;

            // Create a consumed entry for the converted portion
            const consumedEntry = {
              ...entry,
              id: randomUUID(),
              amount: remaining,
              converted: true,
            };
            allEntries.push(consumedEntry);
            consumedEntryIds.push(consumedEntry.id);
            remaining = 0;
          }
        }

        // Create new PAXG savings entry
        const paxgEntry = {
          id: randomUUID(),
          childName,
          amount: 0, // PAXG amount tracked as string in receivedAmount
          asset: "PAXG" as const,
          depositedAt: new Date().toISOString(),
          lockUntil: new Date().toISOString(), // PAXG has no lock period — appreciation-based
          released: false,
          multiplierAtDeposit: 1.0, // Gold doesn't earn multiplier — it earns price appreciation
          converted: false,
          convertedFrom: consumedEntryIds.join(","),
          conversionTxHash: txHash,
          priceAtConversion,
          receivedAmount,
        };
        allEntries.push(paxgEntry);

        // Save all entries
        await state.saveSavingsEntries(familyId, allEntries);

        // Audit log
        await state.addAuditEntry(familyId, {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "savings-converted",
          actor: caller.memberId,
          details: {
            childName,
            usdcConsumed: usdcAmount,
            usdcConsumedUsd: (usdcAmount / 10 ** USDC.DECIMALS).toFixed(2),
            receivedAsset,
            receivedAmount,
            priceAtConversion,
            txHash,
            consumedEntryIds,
          },
          txHash,
          amount: usdcAmount,
        });

        // Build position summary
        const remainingUsdc = allEntries.filter(
          (e) =>
            e.childName.toLowerCase() === childName.toLowerCase() &&
            !e.released &&
            !e.converted &&
            (e.asset === "USDC" || !e.asset)
        );
        const remainingUsdcTotal = remainingUsdc.reduce((sum, e) => sum + e.amount, 0);

        const paxgEntries = allEntries.filter(
          (e) =>
            e.childName.toLowerCase() === childName.toLowerCase() &&
            !e.released &&
            e.asset === "PAXG"
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              conversion: {
                usdcConsumed: `$${(usdcAmount / 10 ** USDC.DECIMALS).toFixed(2)}`,
                paxgReceived: `${receivedAmount} oz`,
                priceAtConversion: `$${priceAtConversion.toFixed(2)}/oz`,
                txHash,
              },
              positionAfter: {
                usdc: {
                  totalLocked: `$${(remainingUsdcTotal / 10 ** USDC.DECIMALS).toFixed(2)}`,
                  entries: remainingUsdc.length,
                },
                paxg: {
                  totalOz: paxgEntries.reduce((sum, e) => sum + parseFloat(e.receivedAmount || "0"), 0).toFixed(6),
                  entries: paxgEntries.length,
                  note: "Gold doesn't earn the savings multiplier — it earns price appreciation.",
                },
              },
              message: `Converted $${(usdcAmount / 10 ** USDC.DECIMALS).toFixed(2)} USDC to ${receivedAmount} oz PAXG for ${childName}. Gold earns price appreciation, not a streak multiplier.`,
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
