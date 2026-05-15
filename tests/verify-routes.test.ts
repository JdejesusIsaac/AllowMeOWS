// Sprint 3.0 v4 — W4.4 HTTP endpoint tests (HE1-HE7).
// Spins the verify-route router on a random port, hits it with native fetch,
// tears down. Does not need supertest or any new devDep.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { baseSepolia } from "viem/chains";
import { buildVerifyRoutes } from "../app/verify-routes.js";
import { _clearSessionSecretCache } from "../src/auth/session-tokens.js";
import { nonceStore } from "../src/auth/nonce-store.js";
import { _clearRateLimitBuckets } from "../src/middleware/rate-limit.js";

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
  // Start each test from a clean data/ directory so MemberIndex, setup codes,
  // and family state don't leak between tests.
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });
  // Reset rate-limit buckets so HE8a-HE8g aren't starved by HE8h and vice versa.
  _clearRateLimitBuckets();
});

async function siweExchange(account: ReturnType<typeof privateKeyToAccount>): Promise<{
  message: string;
  signature: `0x${string}`;
  nonce: string;
}> {
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
  return { message, signature, nonce };
}

describe("HTTP verify-routes (W4.4)", () => {
  const PK = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
  const account = privateKeyToAccount(PK);

  it("HE1: GET /api/auth/nonce returns a hex nonce persisted in the nonce store", async () => {
    const res = await fetch(`${baseUrl}/api/auth/nonce`);
    expect(res.status).toBe(200);
    const body = (await res.text()).trim();
    expect(body).toMatch(/^[0-9a-f]{32}$/);
    expect(nonceStore.has(body)).toBe(true);
  });

  it("HE2: POST /api/auth/verify with new wallet returns requiresFamilyCreation=true", async () => {
    const { message, signature } = await siweExchange(account);
    const res = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.walletAddress).toBe(account.address.toLowerCase());
    expect(body.families).toEqual([]);
    expect(body.requiresFamilyCreation).toBe(true);
    expect(typeof body.sessionToken).toBe("string");
    expect(body.memberId).toBeNull();
  });

  it("HE4: POST /api/auth/verify with tampered signature returns 400 and does NOT consume nonce", async () => {
    const { message, signature, nonce } = await siweExchange(account);
    const sigBytes = Buffer.from(signature.slice(2), "hex");
    sigBytes[10] ^= 0xff;
    const tampered = ("0x" + sigBytes.toString("hex")) as `0x${string}`;

    const res = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature: tampered }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("invalid-signature");
    // Nonce stays valid so the user can retry with a fresh sig — HE4 contract.
    expect(nonceStore.has(nonce)).toBe(true);
  });

  it("HE5: POST /api/configure-family bootstraps a family + returns magic-link URL", async () => {
    const { message, signature } = await siweExchange(account);
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    const verifyBody = await verifyRes.json();
    expect(verifyBody.requiresFamilyCreation).toBe(true);

    const cfgRes = await fetch(`${baseUrl}/api/configure-family`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${verifyBody.sessionToken}`,
      },
      body: JSON.stringify({
        familyName: "The Test Family",
        useTestnet: true,
        children: [
          {
            name: "Sofia",
            weeklyBudgetUsd: 15,
            categories: [
              { name: "reading", pct: 40 },
              { name: "movement", pct: 35 },
              { name: "creativity", pct: 25 },
            ],
            savingsPercent: 20,
          },
        ],
      }),
    });

    expect(cfgRes.status).toBe(200);
    const body = await cfgRes.json();
    expect(body.ok).toBe(true);
    expect(body.familyName).toBe("The Test Family");
    expect(body.mcpUrl).toMatch(/\?setup=SETUP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(body.setupCode).toMatch(/^SETUP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(typeof body.memberId).toBe("string");
    expect(typeof body.familyId).toBe("string");
    expect(typeof body.sessionToken).toBe("string");
  });

  it("HE5b: POST /api/configure-family without session token returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/configure-family`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familyName: "Nope",
        useTestnet: true,
        children: [
          {
            name: "x",
            weeklyBudgetUsd: 1,
            categories: [{ name: "c", pct: 100 }],
            savingsPercent: 0,
          },
        ],
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("missing-or-invalid-session-token");
  });

  // Sprint 3.0.5 HE5c — backward-compat regression bar (contract C1, DEL8).
  // Locks the central correctness constraint of Sprint 3.0.5: the *old* form
  // payload (no walletAddress, no learningGoals on any child) must continue
  // to bootstrap a valid family with no schema-default surprises. Asserts on
  // the persisted FamilyConfig file (per evaluator E-PB1: API 200 is necessary
  // but not sufficient — disk shape is the truth), and on the Sprint 3.0.2
  // auto-populate behaviour (`authorizedDestinations` contains the manager
  // wallet lowercased). The body-level `authorizedDestinations` assertion
  // becomes green once W2 (DEL5/DEL6) lands the response field.
  it("HE5c: backward-compat — pre-3.0.5 form payload still bootstraps cleanly", async () => {
    const { message, signature } = await siweExchange(account);
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    const verifyBody = await verifyRes.json();
    expect(verifyBody.requiresFamilyCreation).toBe(true);
    const managerWallet = account.address.toLowerCase();
    expect(verifyBody.walletAddress).toBe(managerWallet);

    const cfgRes = await fetch(`${baseUrl}/api/configure-family`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${verifyBody.sessionToken}`,
      },
      // *Exact* shape the pre-3.0.5 form posted — no walletAddress, no
      // learningGoals, no subgoals, no deadline. If this stops being accepted
      // by `/api/configure-family`, Sprint 3.0.5 has broken its central
      // promise (DEL3 + contract Scope "out of scope").
      body: JSON.stringify({
        familyName: "Backward Compat Family",
        useTestnet: true,
        children: [
          {
            name: "Sofia",
            weeklyBudgetUsd: 15,
            categories: [
              { name: "reading", pct: 40 },
              { name: "movement", pct: 35 },
              { name: "creativity", pct: 25 },
            ],
            savingsPercent: 20,
          },
        ],
      }),
    });

    expect(cfgRes.status).toBe(200);
    const body = await cfgRes.json();
    expect(body.ok).toBe(true);
    expect(typeof body.familyId).toBe("string");
    expect(typeof body.memberId).toBe("string");
    expect(typeof body.setupCode).toBe("string");
    expect(body.mcpUrl).toMatch(/\?setup=SETUP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(typeof body.sessionToken).toBe("string");

    // E-PB1: the persisted shape is the truth. Load via StateManager
    // (parses through FamilyConfigSchema so defaults apply on read per
    // Sprint 3.0.2 lazy-migration enabler) and assert against it.
    const { StateManager } = await import("../src/engine/state.js");
    const state = new StateManager();
    const persisted = await state.loadFamilyConfig(body.familyId);
    expect(persisted).not.toBeNull();
    if (!persisted) throw new Error("loadFamilyConfig returned null"); // narrowing

    expect(persisted.children.length).toBe(1);
    const sofia = persisted.children[0];
    expect(sofia.name).toBe("Sofia");
    // Backward-compat shape — no opt-in 3.0.5 fields persisted.
    expect(sofia.walletAddress).toBeUndefined();
    expect(sofia.learningGoals).toBeUndefined();
    // Sprint 3.0.2 auto-populate (regardless of 3.0.5 changes) — manager
    // wallet from the SIWE session lands on the family's allowlist.
    expect(persisted.authorizedDestinations).toContain(managerWallet);

    // W2 forward bar (DEL5/DEL6): the HTTP response carries
    // `authorizedDestinations` so the verify-page transparency panel can
    // render it. Currently undefined; becomes the manager-wallet-only array
    // after W2 ships. Until then, this assertion is the spec for W2.
    expect(Array.isArray(body.authorizedDestinations)).toBe(true);
    expect(body.authorizedDestinations).toContain(managerWallet);
  });

  // Sprint 3.0.5 HE5d — rich-payload persistence (contract C2/C3/C5, DEL9).
  // The mirror of HE5c: post the *new* form's payload with walletAddress,
  // learningGoals carrying subgoals + an ISO deadline, and confirm the
  // backend persists everything correctly AND the response carries the
  // BYO-wallet address back to the form via `authorizedDestinations` so
  // the transparency panel can render it. This test was the silent-data-
  // loss failure-mode shield called out by evaluator E-PB5.
  it("HE5d: rich payload — walletAddress + subgoals + deadline persist; allowlist includes child wallet", async () => {
    const { message, signature } = await siweExchange(account);
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    const verifyBody = await verifyRes.json();
    const managerWallet = account.address.toLowerCase();
    // Vitalik's address — EIP-55 checksummed input; tryNormalizeWallet
    // lower-cases on persistence per the canonical Sprint 3.0 v4 W3.4
    // helper. Using a checksummed input also exercises the case-
    // insensitive comparison path the allowlist relies on (Sprint 3.0.2
    // AL-CORE5).
    const childWalletInput = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const childWalletLower = childWalletInput.toLowerCase();
    const deadlineIso = "2026-08-15T00:00:00.000Z";

    const cfgRes = await fetch(`${baseUrl}/api/configure-family`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${verifyBody.sessionToken}`,
      },
      body: JSON.stringify({
        familyName: "Rich Payload Family",
        useTestnet: true,
        children: [
          {
            name: "Aiden",
            walletAddress: childWalletInput,
            weeklyBudgetUsd: 20,
            categories: [
              { name: "reading", pct: 50 },
              { name: "movement", pct: 50 },
            ],
            savingsPercent: 25,
            learningGoals: [
              {
                topic: "Catch up to grade-level math",
                category: "reading",
                subgoals: [
                  { topic: "Fractions" },
                  { topic: "Decimals" },
                ],
                deadline: deadlineIso,
              },
            ],
          },
        ],
      }),
    });

    expect(cfgRes.status).toBe(200);
    const body = await cfgRes.json();
    expect(body.ok).toBe(true);

    // C3 — Sprint 3.0.2 allowlist auto-feed: BYO child wallet lands on the
    // family's `authorizedDestinations` after `buildAuthorizedDestinations`
    // resolves. Manager wallet is force-added in the same pass.
    expect(Array.isArray(body.authorizedDestinations)).toBe(true);
    expect(body.authorizedDestinations).toContain(managerWallet);
    expect(body.authorizedDestinations).toContain(childWalletLower);

    // C2/C5 — disk-shape is the truth. Load via StateManager and assert
    // the persisted shape matches what the form posted (with the
    // expected Sprint 3.0.4 `subgoal.completed = false` default applied).
    const { StateManager } = await import("../src/engine/state.js");
    const state = new StateManager();
    const persisted = await state.loadFamilyConfig(body.familyId);
    expect(persisted).not.toBeNull();
    if (!persisted) throw new Error("loadFamilyConfig returned null");

    const aiden = persisted.children[0];
    expect(aiden.name).toBe("Aiden");
    expect(aiden.walletAddress).toBe(childWalletInput); // raw input — server-side `tryNormalizeWallet` canonicalises in allowlist only
    expect(Array.isArray(aiden.learningGoals)).toBe(true);
    expect(aiden.learningGoals?.length).toBe(1);

    const goal = aiden.learningGoals?.[0];
    expect(goal).toBeDefined();
    if (!goal) throw new Error("expected learning goal to be present");
    expect(goal.topic).toBe("Catch up to grade-level math");
    expect(goal.category).toBe("reading");
    // Sprint 3.0.4 — subgoals persist with `completed: false` default
    // applied by `normalizeChildren` (see src/core/configure-family.ts).
    expect(goal.subgoals?.length).toBe(2);
    expect(goal.subgoals?.[0]?.topic).toBe("Fractions");
    expect(goal.subgoals?.[0]?.completed).toBe(false);
    expect(goal.subgoals?.[1]?.topic).toBe("Decimals");
    expect(goal.subgoals?.[1]?.completed).toBe(false);
    // C5 — deadline ISO datetime round-trips verbatim.
    expect(goal.deadline).toBe(deadlineIso);

    // Persisted allowlist agrees with the response. The disk file is the
    // ultimate authority; the response is a convenience surface.
    expect(persisted.authorizedDestinations).toContain(managerWallet);
    expect(persisted.authorizedDestinations).toContain(childWalletLower);
  });

  // Sprint 3.0.5 HE5e — multi-child mixed-wallet path. One child supplies
  // a BYO wallet (goes on the allowlist); the second omits it (OWS-managed,
  // not on the allowlist). Locks contract C3 + C4 as a single integration.
  it("HE5e: multi-child mix — BYO + OWS-managed coexist; allowlist contains only the BYO wallet", async () => {
    const { message, signature } = await siweExchange(account);
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    const verifyBody = await verifyRes.json();
    const managerWallet = account.address.toLowerCase();
    const byoWallet = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045".toLowerCase();

    const cfgRes = await fetch(`${baseUrl}/api/configure-family`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${verifyBody.sessionToken}`,
      },
      body: JSON.stringify({
        familyName: "Mixed Wallet Family",
        useTestnet: true,
        children: [
          {
            name: "Aiden",
            walletAddress: byoWallet,
            weeklyBudgetUsd: 15,
            categories: [{ name: "reading", pct: 100 }],
            savingsPercent: 20,
          },
          {
            name: "Sofia",
            weeklyBudgetUsd: 10,
            categories: [{ name: "reading", pct: 100 }],
            savingsPercent: 30,
          },
        ],
      }),
    });
    expect(cfgRes.status).toBe(200);
    const body = await cfgRes.json();
    expect(body.ok).toBe(true);
    expect(body.authorizedDestinations).toContain(managerWallet);
    expect(body.authorizedDestinations).toContain(byoWallet);

    const { StateManager } = await import("../src/engine/state.js");
    const state = new StateManager();
    const persisted = await state.loadFamilyConfig(body.familyId);
    if (!persisted) throw new Error("loadFamilyConfig returned null");
    expect(persisted.children.length).toBe(2);
    const aiden = persisted.children.find((c) => c.name === "Aiden");
    const sofia = persisted.children.find((c) => c.name === "Sofia");
    expect(aiden?.walletAddress).toBe(byoWallet);
    expect(sofia?.walletAddress).toBeUndefined(); // OWS-managed path
  });

  // Sprint 3.0.5 HE5f — a goal with a deadline but no subgoals must persist.
  // Locks Sprint 3.0.4's deadline-without-subgoals independence (each
  // optional field stands alone).
  it("HE5f: deadline without subgoals — goal persists with deadline only", async () => {
    const { message, signature } = await siweExchange(account);
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    const verifyBody = await verifyRes.json();
    const deadlineIso = "2026-12-31T00:00:00.000Z";

    const cfgRes = await fetch(`${baseUrl}/api/configure-family`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${verifyBody.sessionToken}`,
      },
      body: JSON.stringify({
        familyName: "Deadline Only Family",
        useTestnet: true,
        children: [
          {
            name: "Sofia",
            weeklyBudgetUsd: 10,
            categories: [{ name: "reading", pct: 100 }],
            savingsPercent: 20,
            learningGoals: [
              { topic: "Finish Charlotte's Web", category: "reading", deadline: deadlineIso },
            ],
          },
        ],
      }),
    });
    expect(cfgRes.status).toBe(200);
    const body = await cfgRes.json();
    expect(body.ok).toBe(true);

    const { StateManager } = await import("../src/engine/state.js");
    const state = new StateManager();
    const persisted = await state.loadFamilyConfig(body.familyId);
    if (!persisted) throw new Error("loadFamilyConfig returned null");
    const goal = persisted.children[0].learningGoals?.[0];
    expect(goal).toBeDefined();
    expect(goal?.topic).toBe("Finish Charlotte's Web");
    expect(goal?.deadline).toBe(deadlineIso);
    expect(goal?.subgoals).toBeUndefined();
  });

  // Sprint 3.0.5 HE5g — a goal with subgoals but no deadline must persist.
  // Mirror of HE5f for the other optional field.
  it("HE5g: subgoals without deadline — goal persists with subgoals only", async () => {
    const { message, signature } = await siweExchange(account);
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    const verifyBody = await verifyRes.json();

    const cfgRes = await fetch(`${baseUrl}/api/configure-family`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${verifyBody.sessionToken}`,
      },
      body: JSON.stringify({
        familyName: "Subgoals Only Family",
        useTestnet: true,
        children: [
          {
            name: "Aiden",
            weeklyBudgetUsd: 12,
            categories: [{ name: "reading", pct: 100 }],
            savingsPercent: 20,
            learningGoals: [
              {
                topic: "Improve handwriting",
                category: "reading",
                subgoals: [{ topic: "Letter shapes" }, { topic: "Spacing" }, { topic: "Speed" }],
              },
            ],
          },
        ],
      }),
    });
    expect(cfgRes.status).toBe(200);
    const body = await cfgRes.json();
    expect(body.ok).toBe(true);

    const { StateManager } = await import("../src/engine/state.js");
    const state = new StateManager();
    const persisted = await state.loadFamilyConfig(body.familyId);
    if (!persisted) throw new Error("loadFamilyConfig returned null");
    const goal = persisted.children[0].learningGoals?.[0];
    expect(goal?.topic).toBe("Improve handwriting");
    expect(goal?.subgoals?.length).toBe(3);
    expect(goal?.subgoals?.map((s) => s.topic)).toEqual([
      "Letter shapes",
      "Spacing",
      "Speed",
    ]);
    expect(goal?.subgoals?.every((s) => s.completed === false)).toBe(true);
    expect(goal?.deadline).toBeUndefined();
  });

  it("HE3: POST /api/auth/verify with known wallet returns family list + memberships", async () => {
    // Arrange: sign in, create family, sign in again with same wallet.
    {
      const { message, signature } = await siweExchange(account);
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const { sessionToken } = await verifyRes.json();
      await fetch(`${baseUrl}/api/configure-family`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          familyName: "Round-Trip Family",
          useTestnet: true,
          children: [
            {
              name: "kid",
              weeklyBudgetUsd: 10,
              categories: [{ name: "c", pct: 100 }],
              savingsPercent: 0,
            },
          ],
        }),
      });
    }

    // Act: second sign-in with same wallet.
    const { message, signature } = await siweExchange(account);
    const res = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.requiresFamilyCreation).toBe(false);
    expect(body.families.length).toBe(1);
    expect(body.families[0].role).toBe("manager");
    expect(body.families[0].familyName).toBe("Round-Trip Family");
    expect(typeof body.memberId).toBe("string");
  });

  async function bootstrapViaHttp() {
    const { message, signature } = await siweExchange(account);
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    const { sessionToken } = await verifyRes.json();
    const cfgRes = await fetch(`${baseUrl}/api/configure-family`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        familyName: "Rotation Family",
        useTestnet: true,
        children: [
          {
            name: "kid",
            weeklyBudgetUsd: 10,
            categories: [{ name: "c", pct: 100 }],
            savingsPercent: 0,
          },
        ],
      }),
    });
    const body = await cfgRes.json();
    if (!body.ok) throw new Error(`bootstrap http failed: ${JSON.stringify(body)}`);
    return body as {
      familyId: string;
      memberId: string;
      mcpUrl: string;
      setupCode: string;
      sessionToken: string;
    };
  }

  async function rotateSetupCode(sessionToken: string) {
    const { message, signature } = await siweExchange(account);
    const reVerifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    const reVerifyBody = await reVerifyRes.json();
    const rotateRes = await fetch(`${baseUrl}/api/rotate-setup-code`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${reVerifyBody.sessionToken}`,
      },
      body: JSON.stringify({}),
    });
    return { status: rotateRes.status, body: await rotateRes.json() };
  }

  it("RT1: known wallet revisits /verify → /api/rotate-setup-code issues a fresh code", async () => {
    const first = await bootstrapViaHttp();
    const rotated = await rotateSetupCode(first.sessionToken);

    expect(rotated.status).toBe(200);
    expect(rotated.body.ok).toBe(true);
    expect(rotated.body.setupCode).not.toBe(first.setupCode);
    expect(rotated.body.mcpUrl).toMatch(/\?setup=SETUP-/);
    expect(rotated.body.memberId).toBe(first.memberId);
    expect(rotated.body.familyId).toBe(first.familyId);
  });

  it("RT2: old setup code is revoked after rotation (resolve returns null)", async () => {
    const first = await bootstrapViaHttp();
    await rotateSetupCode(first.sessionToken);

    const { SetupCodeStore } = await import("../src/identity/setup-codes.js");
    const store = new SetupCodeStore();
    const resolved = await store.resolve(first.setupCode);
    expect(resolved).toBeNull();
  });

  it("RT3: rotation does NOT create a duplicate Member (listByWallet still returns 1)", async () => {
    await bootstrapViaHttp();
    const { listMembershipsByWallet } = await import("../src/core/wallet-memberships.js");
    const before = await listMembershipsByWallet(account.address);
    expect(before.length).toBe(1);

    // Rotate twice.
    {
      const { message, signature } = await siweExchange(account);
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const { sessionToken } = await verifyRes.json();
      await fetch(`${baseUrl}/api/rotate-setup-code`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({}),
      });
    }
    {
      const { message, signature } = await siweExchange(account);
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const { sessionToken } = await verifyRes.json();
      await fetch(`${baseUrl}/api/rotate-setup-code`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({}),
      });
    }

    const after = await listMembershipsByWallet(account.address);
    expect(after.length).toBe(1);
    expect(after[0].memberId).toBe(before[0].memberId);

    // walletVerifiedAt should be populated after rotation.
    const { StateManager } = await import("../src/engine/state.js");
    const state = new StateManager();
    const member = await state.loadMember(after[0].familyId, after[0].memberId);
    expect(member?.walletVerifiedAt).toBeDefined();
  });

  it("HE7: POST /api/redeem-invite works for an invite without a session token (Learner path)", async () => {
    // Arrange: create a family + Learner invite via the core modules directly.
    // (Invite issuance happens via the MCP `invite-member` tool, not an HTTP
    // endpoint. We shortcut by calling the state layer.)
    const { StateManager } = await import("../src/engine/state.js");
    const { InviteSystem } = await import("../src/invites/system.js");
    const { configureFamilyCore, normalizeChildren } = await import(
      "../src/core/configure-family.js"
    );

    const bootstrap = await configureFamilyCore(
      {
        familyName: "Invite Test Family",
        children: normalizeChildren([
          {
            name: "Sofia",
            weeklyBudgetUsd: 10,
            categories: [{ name: "c", pct: 100 }],
            savingsPercent: 0,
          },
        ]),
        chainId: "eip155:84532",
        usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        useTestnet: true,
      },
      null
    );
    if (!bootstrap.ok || !bootstrap.bootstrap) throw new Error("bootstrap failed");

    const state = new StateManager();
    const inviteSystem = new InviteSystem();
    const invites = await state.loadInvites(bootstrap.familyId);
    const newInvite = inviteSystem.generateInvite(
      "learner",
      "Sofia",
      bootstrap.familyId,
      bootstrap.memberId
    );
    invites.push(newInvite);
    await state.saveInvites(bootstrap.familyId, invites);

    // Act: redeem the invite as Sofia — no session token (Learner path).
    const res = await fetch(`${baseUrl}/api/redeem-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: newInvite.code, name: "Sofia" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.role).toBe("learner");
    expect(body.childName).toBe("Sofia");
    expect(body.mcpUrl).toMatch(/\?setup=SETUP-/);
  });

  // ======================================================================
  // HE8: GET /api/invites/:code/preview
  // ======================================================================
  //
  // The preview endpoint resolves invite metadata (family name, role,
  // childName for Learner role, expiresAt) without consuming the invite,
  // so the verify page can render "Joining the Asencio family as Learner
  // — Sofia" before the recipient taps the redeem button.
  //
  // CRITICAL CONTRACT: the preview endpoint MUST NOT mark the invite as
  // used under any circumstance. Consumption happens only at
  // /api/redeem-invite. HE8d is the test that locks this contract.

  async function seedFamilyWithInvite(opts: {
    role: "learner" | "co-parent";
    childName?: string;
  }): Promise<{ familyId: string; managerId: string; inviteCode: string }> {
    const { configureFamilyCore, normalizeChildren } = await import(
      "../src/core/configure-family.js"
    );
    const { StateManager } = await import("../src/engine/state.js");
    const { InviteSystem } = await import("../src/invites/system.js");

    const bootstrap = await configureFamilyCore(
      {
        familyName: "Asencio Family",
        children: normalizeChildren([
          {
            name: "Sofia",
            weeklyBudgetUsd: 5,
            categories: [{ name: "reading", pct: 100 }],
            savingsPercent: 0,
          },
        ]),
        chainId: "eip155:84532",
        usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        useTestnet: true,
      },
      null
    );
    if (!bootstrap.ok || !bootstrap.bootstrap) throw new Error("bootstrap failed");

    const state = new StateManager();
    const inviteSystem = new InviteSystem();
    const invites = await state.loadInvites(bootstrap.familyId);
    // Co-parent invites are family-scoped, not child-scoped, but the
    // generator still needs a non-empty name to produce a well-formed code
    // (`{NAME_PREFIX}-{ROLE_HINT}-{SUFFIX}`). "FAM" is a neutral stand-in;
    // the preview endpoint strips childName from the response for non-
    // Learner roles regardless.
    const nameForCode = opts.childName ?? "FAM";
    const newInvite = inviteSystem.generateInvite(
      opts.role,
      nameForCode,
      bootstrap.familyId,
      bootstrap.memberId
    );
    invites.push(newInvite);
    await state.saveInvites(bootstrap.familyId, invites);

    return {
      familyId: bootstrap.familyId,
      managerId: bootstrap.memberId,
      inviteCode: newInvite.code,
    };
  }

  async function expireInvite(familyId: string, code: string): Promise<void> {
    const { StateManager } = await import("../src/engine/state.js");
    const state = new StateManager();
    const invites = await state.loadInvites(familyId);
    const target = invites.find((i) => i.code === code);
    if (!target) throw new Error(`invite ${code} not found for family ${familyId}`);
    target.expiresAt = new Date(0).toISOString();
    await state.saveInvites(familyId, invites);
  }

  async function loadInvitesForFamily(familyId: string) {
    const { StateManager } = await import("../src/engine/state.js");
    return new StateManager().loadInvites(familyId);
  }

  // ======================================================================
  // CF: Cross-family Manager — one wallet, multiple memberships
  // ======================================================================
  //
  // The research doc Option A ("linear-scan listMembershipsByWallet")
  // supports a single wallet legitimately holding Manager in Family A AND
  // Co-parent in Family B. CF1 locks that /api/auth/verify surfaces both
  // memberships in the `families[]` response (picker data). CF2 locks
  // per-membership rotation isolation — rotating Family A's setup code
  // MUST NOT revoke the code the wallet holds in Family B.

  describe("CF: cross-family Manager", () => {
    it("CF1: single wallet → 2 memberships surfaced in /api/auth/verify", async () => {
      // Arrange: bootstrap Family A with `account` as Manager via HTTP.
      const first = await bootstrapViaHttp();
      expect(first.familyId).toBeTruthy();

      // Arrange: bootstrap Family B via core (stand-alone Manager, no wallet
      // binding). We'll redeem a Co-parent invite from Family B with
      // `account`'s wallet to produce the cross-family state.
      const { configureFamilyCore, normalizeChildren } = await import(
        "../src/core/configure-family.js"
      );
      const { StateManager } = await import("../src/engine/state.js");
      const { InviteSystem } = await import("../src/invites/system.js");

      const familyBBootstrap = await configureFamilyCore(
        {
          familyName: "Other Family",
          children: normalizeChildren([
            {
              name: "kid2",
              weeklyBudgetUsd: 7,
              categories: [{ name: "music", pct: 100 }],
              savingsPercent: 0,
            },
          ]),
          chainId: "eip155:84532",
          usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          useTestnet: true,
        },
        null
      );
      if (!familyBBootstrap.ok || !familyBBootstrap.bootstrap) {
        throw new Error("CF1: bootstrapping Family B failed");
      }

      // Issue a Co-parent invite from Family B.
      const state = new StateManager();
      const invites = await state.loadInvites(familyBBootstrap.familyId);
      const inviteSystem = new InviteSystem();
      const coparentInvite = inviteSystem.generateInvite(
        "co-parent",
        "FAM",
        familyBBootstrap.familyId,
        familyBBootstrap.memberId
      );
      invites.push(coparentInvite);
      await state.saveInvites(familyBBootstrap.familyId, invites);

      // Same wallet signs in, then redeems the invite with Bearer token.
      const { message, signature } = await siweExchange(account);
      const verifyRes1 = await fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const verify1 = await verifyRes1.json();
      expect(verify1.families.length).toBe(1); // only Family A so far

      const redeemRes = await fetch(`${baseUrl}/api/redeem-invite`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${verify1.sessionToken}`,
        },
        body: JSON.stringify({ code: coparentInvite.code, name: "Alex" }),
      });
      expect(redeemRes.status).toBe(200);

      // Act: second sign-in with same wallet.
      const { message: m2, signature: s2 } = await siweExchange(account);
      const verifyRes2 = await fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: m2, signature: s2 }),
      });
      expect(verifyRes2.status).toBe(200);
      const verify2 = await verifyRes2.json();

      // Assert: picker sees both memberships.
      expect(verify2.requiresFamilyCreation).toBe(false);
      expect(verify2.families.length).toBe(2);
      const roles = verify2.families
        .map((f: { role: string }) => f.role)
        .sort();
      expect(roles).toEqual(["co-parent", "manager"]);
      // When >1 membership, the session token carries NO memberId — the
      // verify-page picker is responsible for disambiguating.
      expect(verify2.memberId).toBeNull();
    });

    it("CF2: rotation on Family A does not revoke the setup code in Family B", async () => {
      // Arrange: replay the CF1 setup to reach the 2-membership state.
      const familyA = await bootstrapViaHttp();
      const { configureFamilyCore, normalizeChildren } = await import(
        "../src/core/configure-family.js"
      );
      const { StateManager } = await import("../src/engine/state.js");
      const { InviteSystem } = await import("../src/invites/system.js");
      const { SetupCodeStore } = await import("../src/identity/setup-codes.js");

      const familyBBootstrap = await configureFamilyCore(
        {
          familyName: "Other Family",
          children: normalizeChildren([
            {
              name: "kid2",
              weeklyBudgetUsd: 7,
              categories: [{ name: "music", pct: 100 }],
              savingsPercent: 0,
            },
          ]),
          chainId: "eip155:84532",
          usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          useTestnet: true,
        },
        null
      );
      if (!familyBBootstrap.ok || !familyBBootstrap.bootstrap) {
        throw new Error("CF2: bootstrapping Family B failed");
      }

      const state = new StateManager();
      const invites = await state.loadInvites(familyBBootstrap.familyId);
      const coparentInvite = new InviteSystem().generateInvite(
        "co-parent",
        "FAM",
        familyBBootstrap.familyId,
        familyBBootstrap.memberId
      );
      invites.push(coparentInvite);
      await state.saveInvites(familyBBootstrap.familyId, invites);

      const { message, signature } = await siweExchange(account);
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const verify = await verifyRes.json();
      const redeemRes = await fetch(`${baseUrl}/api/redeem-invite`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${verify.sessionToken}`,
        },
        body: JSON.stringify({ code: coparentInvite.code, name: "Alex" }),
      });
      const redeem = await redeemRes.json();
      expect(redeem.ok).toBe(true);
      const familyBSetupCode = redeem.setupCode as string;
      expect(familyBSetupCode).toMatch(/^SETUP-/);
      const familyASetupCode = familyA.setupCode;

      // Act: rotate Family A's setup code for this wallet. The wallet has
      // 2 memberships so the session token has no memberId — pass it in
      // the body explicitly.
      const { message: m2, signature: s2 } = await siweExchange(account);
      const reVerifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: m2, signature: s2 }),
      });
      const reVerify = await reVerifyRes.json();
      const familyAMember = reVerify.families.find(
        (f: { role: string }) => f.role === "manager"
      );
      expect(familyAMember).toBeDefined();

      const rotateRes = await fetch(`${baseUrl}/api/rotate-setup-code`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${reVerify.sessionToken}`,
        },
        body: JSON.stringify({ memberId: familyAMember.memberId }),
      });
      expect(rotateRes.status).toBe(200);
      const rotate = await rotateRes.json();
      expect(rotate.ok).toBe(true);
      expect(rotate.setupCode).not.toBe(familyASetupCode);

      // Assert: Family B's setup code is STILL resolvable (isolation held).
      const setupStore = new SetupCodeStore();
      const resolvedB = await setupStore.resolve(familyBSetupCode);
      expect(resolvedB).not.toBeNull();
      expect(resolvedB?.memberId).toBe(redeem.memberId);

      // And Family A's old code IS revoked.
      const resolvedAOld = await setupStore.resolve(familyASetupCode);
      expect(resolvedAOld).toBeNull();
    });
  });

  describe("HE8: GET /api/invites/:code/preview", () => {
    it("HE8a: returns 200 + metadata for a valid unconsumed Learner invite", async () => {
      const { inviteCode } = await seedFamilyWithInvite({
        role: "learner",
        childName: "Sofia",
      });

      const res = await fetch(`${baseUrl}/api/invites/${inviteCode}/preview`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        familyName: "Asencio Family",
        role: "learner",
        childName: "Sofia",
        expiresAt: expect.any(String),
      });
      // ISO datetime parses cleanly
      expect(new Date(body.expiresAt).toString()).not.toBe("Invalid Date");
      // No leakage of sensitive fields
      expect(body).not.toHaveProperty("createdBy");
      expect(body).not.toHaveProperty("code");
      expect(body).not.toHaveProperty("walletAddress");
      expect(body).not.toHaveProperty("members");
    });

    it("HE8b: omits childName for non-Learner-role invites", async () => {
      const { inviteCode } = await seedFamilyWithInvite({ role: "co-parent" });

      const res = await fetch(`${baseUrl}/api/invites/${inviteCode}/preview`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        familyName: "Asencio Family",
        role: "co-parent",
        expiresAt: expect.any(String),
      });
      // childName must be absent — co-parent invites don't disclose children.
      expect(body.childName).toBeUndefined();
    });

    it("HE8c: returns 404 for a well-formed but unknown invite code", async () => {
      const res = await fetch(`${baseUrl}/api/invites/SOFI-LEARN-XXXX/preview`);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toMatchObject({
        error: expect.stringMatching(/not found|invalid/i),
      });
      // Must not leak whether other invites with similar codes exist.
      expect(body).not.toHaveProperty("similar");
      expect(body).not.toHaveProperty("suggestion");
    });

    it("HE8d: does NOT consume the invite — preview is read-only", async () => {
      // The critical contract test. A flaky preview must never burn a
      // parent-generated invite.
      const { familyId, inviteCode } = await seedFamilyWithInvite({
        role: "learner",
        childName: "Sofia",
      });

      // Preview multiple times.
      await fetch(`${baseUrl}/api/invites/${inviteCode}/preview`);
      await fetch(`${baseUrl}/api/invites/${inviteCode}/preview`);
      await fetch(`${baseUrl}/api/invites/${inviteCode}/preview`);

      // Confirm the underlying invite is still unused.
      const before = await loadInvitesForFamily(familyId);
      expect(before.find((i) => i.code === inviteCode)?.used).toBe(false);

      // Verify the invite is still redeemable end-to-end.
      const redeemRes = await fetch(`${baseUrl}/api/redeem-invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: inviteCode, name: "Sofia" }),
      });
      expect(redeemRes.status).toBe(200);
      const redeemBody = await redeemRes.json();
      expect(redeemBody.ok).toBe(true);
      expect(redeemBody.mcpUrl).toContain("?setup=");

      // And confirm in state that redemption DID consume it (so HE8d's
      // "preview didn't consume" is meaningful vs "nothing consumed ever").
      const after = await loadInvitesForFamily(familyId);
      expect(after.find((i) => i.code === inviteCode)?.used).toBe(true);
    });

    it("HE8e: returns 410 Gone for an already-redeemed invite", async () => {
      const { inviteCode } = await seedFamilyWithInvite({
        role: "learner",
        childName: "Sofia",
      });

      // Redeem.
      await fetch(`${baseUrl}/api/redeem-invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: inviteCode, name: "Sofia" }),
      });

      // Now preview should fail with 410.
      const res = await fetch(`${baseUrl}/api/invites/${inviteCode}/preview`);
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body).toMatchObject({
        error: expect.stringMatching(/already.*redeemed|used/i),
      });
      expect(body.expired).toBeUndefined();
    });

    it("HE8f: returns 410 Gone with expired:true for an expired invite", async () => {
      const { familyId, inviteCode } = await seedFamilyWithInvite({
        role: "learner",
        childName: "Sofia",
      });
      await expireInvite(familyId, inviteCode);

      const res = await fetch(`${baseUrl}/api/invites/${inviteCode}/preview`);
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body).toMatchObject({
        error: expect.stringMatching(/expired/i),
        expired: true,
      });
    });

    it("HE8g: returns 400 for malformed invite codes", async () => {
      const malformedCodes = [
        "SHORT",
        "TOOLONG-LEARN-XXXX-EXTRA-SEGMENTS",
        "lower-case-fails", // regex requires uppercase for prefix + role hint
        "SOFI LEARN XXXX", // whitespace
        "SOFI/LEARN/XXXX", // path-traversal shape
        "../../../etc/passwd",
      ];

      for (const code of malformedCodes) {
        const res = await fetch(
          `${baseUrl}/api/invites/${encodeURIComponent(code)}/preview`
        );
        expect(res.status, `code=${code}`).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/malformed|invalid/i);
      }
    });

    it("HE8h: rate-limits aggressive enumeration with 429 + Retry-After", async () => {
      // Fire 35 preview requests rapidly. The 31st onward should 429.
      // (Rate limit: 30 requests per IP per minute.) Fresh bucket thanks
      // to the beforeEach _clearRateLimitBuckets() call.
      const requests: Promise<Response>[] = [];
      for (let i = 0; i < 35; i++) {
        requests.push(
          fetch(`${baseUrl}/api/invites/NOPE-LEARN-XXXX/preview`)
        );
      }
      const responses = await Promise.all(requests);

      const allowed = responses.filter((r) => r.status !== 429);
      const rateLimited = responses.filter((r) => r.status === 429);

      expect(allowed.length).toBeLessThanOrEqual(30);
      expect(rateLimited.length).toBeGreaterThanOrEqual(5);

      // 429 responses must include Retry-After to guide the client.
      const firstLimited = rateLimited[0];
      expect(firstLimited.headers.get("retry-after")).not.toBeNull();
      const retry = Number(firstLimited.headers.get("retry-after"));
      expect(retry).toBeGreaterThan(0);
      expect(retry).toBeLessThanOrEqual(60);
    });
  });
});
