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
});
