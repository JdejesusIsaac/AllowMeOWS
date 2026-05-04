/**
 * Sprint 3.0 v4 — verify-page HTTP endpoints (W1.6–W1.10).
 *
 * Mounted by `app/server.ts`. Five endpoints:
 *   GET  /api/auth/nonce            — issue SIWE nonce, 5-min TTL
 *   POST /api/auth/verify           — SIWE verify + session-token issuance
 *   POST /api/configure-family      — create family + Manager (Recommendation B)
 *   POST /api/redeem-invite         — accept invite (adult-with-SIWE or Learner-without)
 *   POST /api/rotate-setup-code     — known wallet → fresh 30-day setup code
 *
 * Auth pattern: the verify-page-issued session token is threaded via
 * `Authorization: Bearer <jwt>`. The same JWT also works as `X-Session-Token`
 * (Priority 0 in `resolveCallerRole`) for MCP tool calls after onboarding.
 *
 * All success paths return JSON `{ ok: true, ... }`. Failures return JSON
 * `{ ok: false, error, reason? }` with a conventional 4xx HTTP status.
 */

import type { Router, Request, Response } from "express";
import { Router as makeRouter } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { verifySiwe } from "../src/auth/siwe.js";
import { nonceStore } from "../src/auth/nonce-store.js";
import {
  sessionTokens,
  DEFAULT_SESSION_TTL_SEC,
  type SessionClaims,
} from "../src/auth/session-tokens.js";
import {
  configureFamilyCore,
  validateChildren,
  normalizeChildren,
} from "../src/core/configure-family.js";
import { acceptInviteCore } from "../src/core/accept-invite.js";
import { listMembershipsByWallet } from "../src/core/wallet-memberships.js";
import { SetupCodeStore } from "../src/identity/setup-codes.js";
import { StateManager } from "../src/engine/state.js";
import { CHAIN_IDS, USDC, DEFAULT_SAVINGS_PERCENT } from "../src/constants.js";

// 30-day setup codes for verify-page-issued rotations (plan Decision 6).
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Compute the expected SIWE domain from the incoming request. Uses the
 * `Host` header so localhost:3000 / allowme.dev / staging.allowme.dev all
 * validate correctly without hardcoding.
 */
function expectedDomain(req: Request): string {
  return String(req.headers.host ?? "allowme.dev");
}

/** Extract and validate the Bearer session token. Returns claims or null. */
function readSessionToken(req: Request): SessionClaims | null {
  const header = req.headers.authorization ?? req.headers.Authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  return sessionTokens.validate(match[1]);
}

// === Input schemas ===

const verifyBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

const configureFamilyBodySchema = z.object({
  familyName: z.string().min(1),
  children: z
    .array(
      z.object({
        name: z.string().min(1),
        walletAddress: z.string().optional(),
        weeklyBudgetUsd: z.number().positive(),
        categories: z
          .array(
            z.object({
              name: z.string().min(1).max(50),
              pct: z.number().min(0).max(100),
            })
          )
          .min(1)
          .max(10),
        savingsPercent: z.number().min(0).max(100).default(DEFAULT_SAVINGS_PERCENT),
        learningGoals: z
          .array(
            z.object({
              topic: z.string().min(1).max(200),
              category: z.string().min(1),
            })
          )
          .max(20)
          .optional(),
      })
    )
    .min(1),
  useTestnet: z.boolean().default(true),
});

const redeemInviteBodySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});

export function buildVerifyRoutes(): Router {
  const router = makeRouter();

  // --- W1.6: GET /api/auth/nonce -----------------------------------------
  router.get("/api/auth/nonce", (_req, res) => {
    const nonce = nonceStore.issue();
    // plaintext body; the verify-page JS passes it straight into
    // `wallet_connect.capabilities.signInWithEthereum.nonce`.
    res.type("text/plain").send(nonce);
  });

  // --- W1.7: POST /api/auth/verify --------------------------------------
  router.post("/api/auth/verify", async (req, res) => {
    const parsed = verifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid-body", reason: parsed.error.message });
    }

    const result = await verifySiwe({
      message: parsed.data.message,
      signature: parsed.data.signature as `0x${string}`,
      expectedDomain: expectedDomain(req),
      nonceStore,
    });

    if (!result.ok) {
      // HE4 contract: invalid-signature leaves the nonce intact so the user
      // can retry. Other failures (domain/nonce) consume or ignore accordingly.
      const status =
        result.reason === "parse-error" || result.reason === "domain-mismatch"
          ? 400
          : result.reason === "nonce-invalid"
          ? 401
          : 400;
      return res.status(status).json({
        ok: false,
        error: "siwe-verification-failed",
        reason: result.reason,
      });
    }

    const walletAddress = result.walletAddress; // already lowercased
    const memberships = await listMembershipsByWallet(walletAddress);

    // Audit — the wallet signed in. Even when memberships is empty (new
    // wallet, pre-family-creation), log the event under a synthetic "system"
    // actor on the first family the wallet eventually joins. For now, only
    // emit the audit if we can attribute it to a family.
    if (memberships.length > 0) {
      const state = new StateManager();
      for (const m of memberships) {
        await state.addAuditEntry(m.familyId, {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "wallet-signed-in",
          actor: m.memberId,
          details: { walletAddress, chainId: result.chainId },
        });
      }
    }

    // Session token: if the wallet is bound to exactly one Member, include
    // memberId/familyId/role in the claims so subsequent endpoints can skip
    // the MemberIndex lookup. Cross-family wallets (2+ memberships) get a
    // wallet-only token; the verify-page picker calls back with the chosen
    // familyId on `/api/rotate-setup-code`.
    const singleMember = memberships.length === 1 ? memberships[0] : null;
    const sessionToken = sessionTokens.issue({
      walletAddress,
      memberId: singleMember?.memberId,
      familyId: singleMember?.familyId,
      role: singleMember?.role,
    });

    return res.json({
      ok: true,
      walletAddress,
      chainId: result.chainId,
      memberId: singleMember?.memberId ?? null,
      families: memberships.map((m) => ({
        memberId: m.memberId,
        familyId: m.familyId,
        familyName: m.familyName,
        role: m.role,
        memberName: m.memberName,
      })),
      sessionToken,
      sessionTtlSec: DEFAULT_SESSION_TTL_SEC,
      requiresFamilyCreation: memberships.length === 0,
    });
  });

  // --- W1.8: POST /api/configure-family (Recommendation B) --------------
  router.post("/api/configure-family", async (req, res) => {
    const claims = readSessionToken(req);
    if (!claims) {
      return res.status(401).json({ ok: false, error: "missing-or-invalid-session-token" });
    }

    const parsed = configureFamilyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid-body", reason: parsed.error.message });
    }

    const validationError = validateChildren(parsed.data.children);
    if (validationError) {
      return res.status(400).json({ ok: false, error: "invalid-children", reason: validationError });
    }

    const useTestnet = parsed.data.useTestnet;
    const children = normalizeChildren(parsed.data.children);

    const result = await configureFamilyCore(
      {
        familyName: parsed.data.familyName,
        children,
        chainId: useTestnet ? CHAIN_IDS.BASE_SEPOLIA : CHAIN_IDS.BASE_MAINNET,
        usdcAddress: useTestnet ? USDC.BASE_SEPOLIA : USDC.BASE_MAINNET,
        useTestnet,
        managerWalletAddress: claims.walletAddress,
      },
      null // bootstrap path — caller identity is the SIWE-verified wallet, not a pre-existing Member
    );

    if (!result.ok) {
      return res.status(500).json({ ok: false, error: result.error });
    }
    if (!result.bootstrap) {
      // Unreachable — caller was null so core takes bootstrap branch.
      return res.status(500).json({ ok: false, error: "unexpected-update-path" });
    }

    // Additional verify-page-flavored audit event per plan Decision 11.
    const state = new StateManager();
    await state.addAuditEntry(result.familyId, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "family-created-via-verify-page",
      actor: result.memberId,
      details: { walletAddress: claims.walletAddress },
    });
    await state.addAuditEntry(result.familyId, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "wallet-bound-to-member",
      actor: result.memberId,
      details: { walletAddress: claims.walletAddress },
    });

    // Mint a new session token carrying the fresh (memberId, familyId, role)
    // so the verify page can make subsequent tool calls without re-signing.
    const newSession = sessionTokens.issue({
      walletAddress: claims.walletAddress,
      memberId: result.memberId,
      familyId: result.familyId,
      role: "manager",
    });

    return res.json({
      ok: true,
      familyId: result.familyId,
      memberId: result.memberId,
      familyName: result.familyName,
      children: result.children,
      mcpUrl: result.mcpUrl,
      setupCode: result.setupCode,
      sessionToken: newSession,
      network: useTestnet ? "Base Sepolia (testnet)" : "Base (mainnet)",
    });
  });

  // --- W1.9: POST /api/redeem-invite ------------------------------------
  router.post("/api/redeem-invite", async (req, res) => {
    const parsed = redeemInviteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid-body", reason: parsed.error.message });
    }

    // Session token is OPTIONAL — adult invites carry it (SIWE-verified
    // wallet threaded onto the new Member), Learner/Advisor invites do not.
    const claims = readSessionToken(req);

    const result = await acceptInviteCore({
      code: parsed.data.code,
      name: parsed.data.name,
      acceptorWalletAddress: claims?.walletAddress,
    });

    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error,
        reason: result.reason,
      });
    }

    // Verify-page-flavored audit trail distinguishable from inline MCP
    // acceptance (which already logs `invite-accepted` in the core).
    const state = new StateManager();
    const isLearner = result.role === "learner";
    await state.addAuditEntry(result.familyId, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: isLearner
        ? "learner-invite-redeemed-via-verify-page"
        : "wallet-bound-to-member",
      actor: result.memberId,
      details: {
        role: result.role,
        ...(claims?.walletAddress ? { walletAddress: claims.walletAddress } : {}),
      },
    });

    // Mint a session token for the new Member so the verify page can run
    // follow-up calls without a second SIWE round-trip.
    const sessionToken = sessionTokens.issue({
      walletAddress: claims?.walletAddress ?? `invite:${result.memberId}`,
      memberId: result.memberId,
      familyId: result.familyId,
      role: result.role,
    });

    return res.json({
      ok: true,
      memberId: result.memberId,
      familyId: result.familyId,
      role: result.role,
      childName: result.childName,
      mcpUrl: result.mcpUrl,
      setupCode: result.setupCode,
      sessionToken,
    });
  });

  // --- W1.10: POST /api/rotate-setup-code -------------------------------
  router.post("/api/rotate-setup-code", async (req, res) => {
    const claims = readSessionToken(req);
    if (!claims) {
      return res.status(401).json({ ok: false, error: "missing-or-invalid-session-token" });
    }

    // The session token may or may not carry memberId — cross-family wallets
    // pass an optional `memberId` in the body to disambiguate. Validate that
    // the requested memberId actually belongs to the SIWE-verified wallet.
    const requestedMemberId =
      typeof req.body?.memberId === "string" ? req.body.memberId : claims.memberId;
    if (!requestedMemberId) {
      return res.status(400).json({
        ok: false,
        error: "member-id-required",
        reason:
          "Session token has no memberId (cross-family wallet). Body must include memberId of the membership to rotate.",
      });
    }

    const memberships = await listMembershipsByWallet(claims.walletAddress);
    const match = memberships.find((m) => m.memberId === requestedMemberId);
    if (!match) {
      return res.status(403).json({
        ok: false,
        error: "wallet-member-mismatch",
        reason: "Requested memberId is not bound to this wallet.",
      });
    }

    const setupCodes = new SetupCodeStore();
    await setupCodes.revokeForMember(match.memberId);
    const newCode = await setupCodes.issue(match.memberId, THIRTY_DAYS_MS);
    const baseUrl = process.env.ALLOWANCE_AGENT_URL || "https://allowme.dev";
    const mcpUrl = `${baseUrl}/mcp?setup=${newCode}`;

    // Stamp walletVerifiedAt on the Member so Sprint 4.0 can do freshness
    // checks. Also backfill walletAddress for pre-3.0 Members who SIWE-in
    // for the first time.
    const state = new StateManager();
    const members = await state.loadMembers(match.familyId);
    const idx = members.findIndex((m) => m.id === match.memberId);
    if (idx >= 0) {
      members[idx] = {
        ...members[idx],
        walletAddress: members[idx].walletAddress ?? claims.walletAddress,
        walletVerifiedAt: new Date().toISOString(),
      };
      await state.saveMembers(match.familyId, members);
    }

    await state.addAuditEntry(match.familyId, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "setup-code-rotated-via-wallet-reauth",
      actor: match.memberId,
      details: { walletAddress: claims.walletAddress },
    });

    const newSession = sessionTokens.issue({
      walletAddress: claims.walletAddress,
      memberId: match.memberId,
      familyId: match.familyId,
      role: match.role,
    });

    return res.json({
      ok: true,
      memberId: match.memberId,
      familyId: match.familyId,
      familyName: match.familyName,
      role: match.role,
      mcpUrl,
      setupCode: newCode,
      sessionToken: newSession,
    });
  });

  return router;
}
