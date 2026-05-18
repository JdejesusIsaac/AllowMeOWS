/**
 * Sprint 3.6 — `view-my-link` MCP tool.
 *
 * Surfaces the caller's current magic MCP URL (?setup=...) so they can
 * clipboard it without scraping welcome copy. Stored codes live in the
 * server-root `SetupCodeStore` (`data/setup-codes.json`).
 *
 * Emits `magic-link-viewed` audits with **no plaintext setup token** —
 * contract C6: only opaque correlation fields (`setupFingerprint`).
 *
 * Exported handler mirrors the `invite-member` pattern for tests.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID, createHash } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { SetupCodeStore } from "../identity/setup-codes.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";

function json(payload: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

/** Pick newest non-expired, non-revoked setup row for `memberId`. */
function pickLatestActiveCode(
  entries: Array<{
    code: string;
    memberId: string;
    createdAt: string;
    expiresAt: string;
    revokedAt?: string;
  }>,
): (typeof entries)[0] | null {
  const now = Date.now();
  const alive = entries.filter((e) => {
    if (e.revokedAt) return false;
    return new Date(e.expiresAt).getTime() > now;
  });
  alive.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return alive[0] ?? null;
}

export async function viewMyLinkHandler(
  _args: Record<string, unknown>,
  caller: CallerContext | null,
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("view-my-link");

  try {
    const state = new StateManager();
    const familyId = caller.familyId;
    const setupCodes = new SetupCodeStore();
    const rows = await setupCodes.list(caller.memberId);
    const best = pickLatestActiveCode(rows);
    if (!best) {
      return json({
        success: false,
        error:
          "No active magic link on file yet. Finish onboarding (accept your invite / configure-policy) — a link is issued when your account connects.",
      });
    }

    const baseUrl = process.env.ALLOWANCE_AGENT_URL || "https://allowme.dev";
    const magicLinkUrl = `${baseUrl}/mcp?setup=${encodeURIComponent(best.code)}`;

    await state.addAuditEntry(familyId, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "magic-link-viewed",
      actor: caller.memberId,
      details: {
        // Opaque discriminator only — persists no `SETUP-*` plaintext (C6).
        setupFingerprint: createHash("sha256")
          .update(best.code)
          .digest("hex")
          .slice(0, 16),
      },
    });

    return json({
      success: true,
      magicLinkUrl,
      expiresAt: best.expiresAt,
      warning:
        "Don't share — anyone with this link can act as you in AllowMe.",
    });
  } catch (error) {
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function registerViewMyLinkTool(server: McpServer): void {
  server.tool(
    "view-my-link",
    "Show your personal AllowMe MCP URL (embedded setup code). For your eyes only.",
    { ...rbacFields },
    withAccessControl("view-my-link", viewMyLinkHandler),
  );
}
