/**
 * Sprint 4.0 W3.4 — `view-session-receipt`.
 *
 * Returns recent Learning Mode session receipts for the caller.
 *
 * RBAC + scoping:
 *   - Learner: returns only their own child's receipts. `childName`
 *     arg is ignored (security: a learner cannot scrape another kid's
 *     receipts by passing their name).
 *   - Manager / co-parent / advisor: may pass `childName` to scope
 *     to one child, or omit it to get receipts for all children in
 *     the family.
 *
 * Returns up to `limit` most-recent receipts per child, default 5.
 * Each receipt includes the session summary text plus the metadata
 * a parent might want at a glance (engagement avg, assessment outcome,
 * USDC settled, confidence flag).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";
import { USDC } from "../constants.js";
import type { SessionRecord } from "../schemas.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;

export interface ReceiptListItem {
  childName: string;
  goalTopic: string;
  sessionId: string;
  date: string;
  topic: string;
  avgEngagement: number;
  assessmentPassed: boolean;
  confidenceFlag: "ok" | "low";
  usdcSettledUsd: string;
  receiptSummary: string;
}

export async function viewSessionReceiptHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("view-session-receipt");
  const requestedChild = args.childName as string | undefined;
  const rawLimit = Number(args.limit ?? DEFAULT_LIMIT);
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT)
  );

  // Learner scope — ignore requestedChild, force own child. If the
  // learner Member has no childName bound (shouldn't happen in normal
  // flow, but defensive), refuse.
  let scopedChildName: string | undefined;
  if (caller.role === "learner") {
    if (!caller.childName) {
      return jsonResponse({
        success: false,
        error: "Learner identity is missing childName binding.",
      });
    }
    scopedChildName = caller.childName;
  } else {
    scopedChildName = requestedChild;
  }

  const state = new StateManager();
  const config = await state.loadFamilyConfig(caller.familyId);
  if (!config) {
    return jsonResponse({ success: false, error: "No family configured." });
  }

  const targetChildren = scopedChildName
    ? config.children.filter(
        (c) => c.name.toLowerCase() === scopedChildName!.toLowerCase()
      )
    : config.children;

  if (scopedChildName && targetChildren.length === 0) {
    return jsonResponse({
      success: false,
      error: `Child "${scopedChildName}" not found.`,
    });
  }

  const receipts: ReceiptListItem[] = [];
  for (const child of targetChildren) {
    for (const goal of child.learningGoals ?? []) {
      if (!goal.studyPlan) continue;
      const sessions = [...goal.studyPlan.sessions]
        .sort((a, b) =>
          new Date(b.date).getTime() - new Date(a.date).getTime()
        )
        .slice(0, limit);
      for (const session of sessions) {
        receipts.push(mapSessionToReceipt(child.name, goal.topic, session));
      }
    }
  }

  // Order receipts across children by date descending. Take only the
  // top `limit` if a single child was requested; otherwise return the
  // per-child top-`limit` flattened (already sliced above).
  receipts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const trimmed = scopedChildName ? receipts.slice(0, limit) : receipts;

  return jsonResponse({
    success: true,
    receipts: trimmed,
    count: trimmed.length,
  });
}

function mapSessionToReceipt(
  childName: string,
  goalTopic: string,
  session: SessionRecord
): ReceiptListItem {
  return {
    childName,
    goalTopic,
    sessionId: session.sessionId,
    date: session.date,
    topic: session.topic,
    avgEngagement: session.avgEngagement,
    assessmentPassed: session.assessmentPassed,
    confidenceFlag: session.confidenceFlag,
    usdcSettledUsd: (session.usdcSettled / 10 ** USDC.DECIMALS).toFixed(2),
    receiptSummary: session.receiptSummary,
  };
}

function jsonResponse(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

export const viewSessionReceiptWrapped = withAccessControl(
  "view-session-receipt",
  viewSessionReceiptHandler
);

export function registerViewSessionReceiptTool(server: McpServer): void {
  server.tool(
    "view-session-receipt",
    "Return recent Learning Mode session receipts. Learners see only their own; manager / co-parent / advisor can scope to one child by name or get the whole family.",
    {
      childName: z
        .string()
        .optional()
        .describe(
          "Scope to one child by name. Ignored for learners (always their own)."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LIMIT)
        .optional()
        .describe(
          `Max receipts per child (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`
        ),
      ...rbacFields,
    },
    viewSessionReceiptWrapped
  );
}
