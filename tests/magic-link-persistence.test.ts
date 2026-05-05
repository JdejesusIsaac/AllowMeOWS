// Sprint 3.0 v4 — W4.5 ML1-ML3 magic-link persistence for adults.
//
// The spec (sprint-3.0/test-3.0.md:57-63) requires proof that a setup code
// issued from the verify page:
//   ML1: has the expected shape (`…?setup=SETUP-XXXX-XXXX`)
//   ML2: routes to a Manager identity when presented as `?setup=CODE` in
//        the HTTP query string of a subsequent request
//   ML3: keeps working across multiple sessions — a returning connector
//        with the same URL still resolves to the same Manager (regression
//        guard for the Sprint 2.9.1 "Angelica bug", where setup codes were
//        accidentally single-use)
//
// Design: instead of standing up a full MCP stdio client to round-trip a
// real tool call, these tests exercise the exact piece of code that the
// MCP HTTP transport delegates to — `resolveCallerRole` inside a
// `runWithRequestContext` block — for a setup code extracted from the
// live `/api/configure-family` response. The HTTP-side path that *builds*
// the request context is already covered by HE1-HE5 / RT1-RT3 / HE7 /
// HE8a-h / CF1-CF2. That decomposition keeps ML1-ML3 focused on the
// "URL → identity → authorization" chain without re-implementing the MCP
// SDK session handshake.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { baseSepolia } from "viem/chains";
import { buildVerifyRoutes } from "../app/verify-routes.js";
import { _clearSessionSecretCache } from "../src/auth/session-tokens.js";
import { _clearRateLimitBuckets } from "../src/middleware/rate-limit.js";
import {
  runWithRequestContext,
  type RequestContext,
} from "../src/middleware/request-context.js";
import {
  resolveCallerRole,
  isToolAuthorized,
} from "../src/middleware/access-control.js";

const DATA_DIR = join(process.cwd(), "data");

let server: Server;
let baseUrl: string;
let host: string;

beforeAll(async () => {
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  _clearSessionSecretCache();

  const app = express();
  app.use(express.json());
  app.use(buildVerifyRoutes());

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bad server address");
  host = `127.0.0.1:${addr.port}`;
  baseUrl = `http://${host}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.SESSION_SECRET;
  _clearSessionSecretCache();
});

beforeEach(async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });
  _clearRateLimitBuckets();
});

const SETUP_CODE_RE = /^SETUP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const MAGIC_LINK_RE = /\?setup=SETUP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/**
 * Drive the full SIWE → /api/auth/verify → /api/configure-family flow for
 * a fresh wallet, and return the resulting magic-link payload. This is the
 * exact code path the verify page walks for a new Manager.
 */
async function bootstrapManagerViaVerifyPage(): Promise<{
  familyId: string;
  memberId: string;
  setupCode: string;
  mcpUrl: string;
  walletAddress: string;
}> {
  const account = privateKeyToAccount(
    "0xabababababababababababababababababababababababababababababababab"
  );

  const nonceRes = await fetch(`${baseUrl}/api/auth/nonce`);
  const nonce = (await nonceRes.text()).trim();
  const message = createSiweMessage({
    address: account.address,
    domain: host,
    uri: `${baseUrl}/verify`,
    version: "1",
    chainId: baseSepolia.id,
    nonce,
    statement: "Sign in to AllowMe to manage your family's allowance.",
    issuedAt: new Date(),
  });
  const signature = await account.signMessage({ message });

  const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  const verifyBody = await verifyRes.json();
  if (!verifyBody.ok) {
    throw new Error(`verify failed: ${JSON.stringify(verifyBody)}`);
  }
  expect(verifyBody.requiresFamilyCreation).toBe(true);

  const cfgRes = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${verifyBody.sessionToken}`,
    },
    body: JSON.stringify({
      familyName: "ML Test Family",
      useTestnet: true,
      children: [
        {
          name: "Sofia",
          weeklyBudgetUsd: 10,
          categories: [
            { name: "reading", pct: 50 },
            { name: "movement", pct: 50 },
          ],
          savingsPercent: 20,
        },
      ],
    }),
  });
  const cfg = await cfgRes.json();
  if (!cfg.ok) {
    throw new Error(`configure-family failed: ${JSON.stringify(cfg)}`);
  }

  return {
    familyId: cfg.familyId,
    memberId: cfg.memberId,
    setupCode: cfg.setupCode,
    mcpUrl: cfg.mcpUrl,
    walletAddress: verifyBody.walletAddress,
  };
}

/**
 * Simulate what the MCP HTTP transport does for an incoming request: populate
 * `runWithRequestContext` with the parsed query string, then ask the RBAC
 * layer who the caller is. This is exactly the code path hit when Claude
 * connects to `…/mcp?setup=SETUP-XXXX-XXXX` and issues a `tools/call`.
 */
async function resolveForSetupCode(
  setupCode: string
): Promise<Awaited<ReturnType<typeof resolveCallerRole>>> {
  const ctx: RequestContext = {
    headers: {},
    query: { setup: setupCode },
  };
  return runWithRequestContext(ctx, () => resolveCallerRole({}));
}

describe("W4.5 Magic-link persistence — adults (ML1-ML3)", () => {
  it("ML1: Manager bootstrap via verify page returns a well-formed magic-link URL", async () => {
    const result = await bootstrapManagerViaVerifyPage();

    expect(result.setupCode).toMatch(SETUP_CODE_RE);
    expect(result.mcpUrl).toMatch(MAGIC_LINK_RE);
    expect(result.mcpUrl).toContain(result.setupCode);
    expect(result.familyId).toBeTruthy();
    expect(result.memberId).toBeTruthy();
    // Magic-link URL must also contain the MCP endpoint, not just a bare
    // setup code — this is what Claude actually consumes.
    expect(result.mcpUrl).toMatch(/\/mcp\?setup=/);
  });

  it("ML2: magic-link setup code resolves to the Manager identity when presented via ?setup= query", async () => {
    const { setupCode, memberId, familyId } =
      await bootstrapManagerViaVerifyPage();

    const caller = await resolveForSetupCode(setupCode);

    expect(caller, "setup code must resolve to an identity").not.toBeNull();
    expect(caller!.role).toBe("manager");
    expect(caller!.memberId).toBe(memberId);
    expect(caller!.familyId).toBe(familyId);

    // And the resolved identity passes the RBAC gate for Manager-scoped
    // tools — this is the `withAccessControl` check every tool handler
    // runs before executing. Priority: prove `check-progress` and
    // `distribute-allowance` (Manager-only) are both authorized for this
    // caller. If RBAC is mis-wired, at least one of these will return
    // false and the test will fail loudly.
    expect(isToolAuthorized("check-progress", caller!.role)).toBe(true);
    expect(isToolAuthorized("distribute-allowance", caller!.role)).toBe(true);
    expect(isToolAuthorized("configure-policy", caller!.role)).toBe(true);
  });

  it("ML3: setup code survives multiple fresh-client sessions (regression of the Angelica single-use bug)", async () => {
    const { setupCode, memberId, familyId } =
      await bootstrapManagerViaVerifyPage();

    // Three independent request contexts, each one simulating a separate
    // Claude session reconnecting with the same magic-link URL. If the
    // setup code were accidentally single-use (the Sprint 2.9.1 regression),
    // session 2 or 3 would resolve to `null` and RBAC would bail with
    // `buildNoIdentityResponse`.
    const session1 = await resolveForSetupCode(setupCode);
    const session2 = await resolveForSetupCode(setupCode);
    const session3 = await resolveForSetupCode(setupCode);

    for (const [idx, session] of [session1, session2, session3].entries()) {
      expect(session, `session ${idx + 1} must still resolve`).not.toBeNull();
      expect(session!.role, `session ${idx + 1} role`).toBe("manager");
      expect(session!.memberId, `session ${idx + 1} memberId`).toBe(memberId);
      expect(session!.familyId, `session ${idx + 1} familyId`).toBe(familyId);
    }

    // And the resolver must return the SAME memberId across sessions (no
    // accidental Member duplication on reconnect — would surface as
    // MemberIndex.listByFamily growing across sessions).
    const { MemberIndex } = await import("../src/identity/member-index.js");
    const members = await new MemberIndex().listByFamily(familyId);
    expect(members.length).toBe(1);
    expect(members[0].memberId).toBe(memberId);
    expect(members[0].role).toBe("manager");
  });
});
