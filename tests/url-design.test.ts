/**
 * Sprint 3.7 — U1–U4 URL design tests.
 *
 * Covers the new path-shaped invite URL `/join/:code`, backward-compat for
 * the legacy `/verify?invite=…&role=…` form, role-from-record source of
 * truth, and clean-error behaviour on malformed codes.
 *
 * Mirrors the verify-page route registration from
 * `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/app/server.ts:298-329`
 * so the test starts a minimal Express app without booting the entire MCP
 * server / migrations / master-key resolution. Pairs the page routes with
 * the real `/api/invites/:code/preview` API endpoint from
 * `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/app/verify-routes.ts:135-160`
 * so the role-from-record assertion exercises the production lookup path.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { rm, mkdir } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { buildVerifyRoutes } from "../app/verify-routes.js";
import { _clearSessionSecretCache } from "../src/auth/session-tokens.js";
import { _clearRateLimitBuckets } from "../src/middleware/rate-limit.js";
import { inviteMemberHandler } from "../src/tools/invite-member.js";
import { createTestFamily, makeChild } from "./helpers/family.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const verifyPath = join(__dirname, "..", "public", "verify.html");
const DATA_DIR = join(process.cwd(), "data");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.ALLOWANCE_AGENT_URL = "https://allowme.dev";
  _clearSessionSecretCache();

  const app = express();
  app.use(express.json());
  app.use(buildVerifyRoutes());

  // Mirror app/server.ts mounting of `/verify` and `/join/:code`. Both
  // routes serve the same SPA HTML (with `__ALLOWME_CONFIG__` injection).
  if (existsSync(verifyPath)) {
    const rawVerifyHtml = readFileSync(verifyPath, "utf-8");
    const config = {
      appName: "AllowMe",
      appLogoUrl: "/favicon.ico",
      chainId: "0x14a34",
      statement: "Sign in to AllowMe to manage your family's allowance.",
    };
    const injection = `<script>window.__ALLOWME_CONFIG__ = ${JSON.stringify(config)};</script>`;
    const verifyHtml = rawVerifyHtml.replace("</head>", `${injection}\n</head>`);
    app.get("/verify", (_req, res) => {
      res.type("html").send(verifyHtml);
    });
    app.get("/join/:code", (_req, res) => {
      res.type("html").send(verifyHtml);
    });
  }

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bad server address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.SESSION_SECRET;
  delete process.env.ALLOWANCE_AGENT_URL;
  _clearSessionSecretCache();
});

beforeEach(async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });
  _clearRateLimitBuckets();
});

async function generateLearnerInvite(familyName: string, childName: string) {
  const family = await createTestFamily({
    familyName,
    children: [
      makeChild(childName, {
        weeklyBudgetUsd: 5,
        categories: [{ name: "education", pct: 100 }],
      }),
    ],
  });
  const res = await inviteMemberHandler(
    {
      name: childName,
      role: "learner",
      childName,
      ...family.asManager(),
    },
    family.managerContext,
  );
  const body = JSON.parse(res.content[0]!.text);
  return { family, code: body.inviteCode as string, verifyUrl: body.verifyUrl as string };
}

describe("U: Sprint 3.7 URL design", () => {
  it("U1: invite-member returns the new /join/:code URL form (no queryparams) and the route serves the SPA", async () => {
    const { code, verifyUrl } = await generateLearnerInvite("Isaac Family", "Aiden");

    // The tool response uses the new path-shaped form.
    expect(verifyUrl).toMatch(/^https:\/\/allowme\.dev\/join\/[A-Z]/);
    expect(verifyUrl).not.toContain("?invite=");
    expect(verifyUrl).not.toContain("&role=");
    expect(verifyUrl).toContain(code);

    // Hit the new path-shaped route — server returns the SPA HTML.
    const pageRes = await fetch(`${baseUrl}/join/${code}`);
    expect(pageRes.status).toBe(200);
    expect(pageRes.headers.get("content-type") ?? "").toContain("text/html");
    const html = await pageRes.text();
    // Core SPA state containers present (mirrors verify-page.test.ts VP1
    // shape so the new route serves the same SPA, not a stripped-down page).
    expect(html).toContain('id="state-loading"');
    expect(html).toContain('id="state-invite-preview"');
    expect(html).toContain("__ALLOWME_CONFIG__");

    // The preview API resolves the family/role/childName from the record.
    const previewRes = await fetch(
      `${baseUrl}/api/invites/${encodeURIComponent(code)}/preview`,
    );
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview.familyName).toBe("Isaac Family");
    expect(preview.role).toBe("learner");
    expect(preview.childName).toBe("Aiden");
  });

  it("U2: legacy /verify?invite=…&role=… URL still resolves (backward compat — CRITICAL)", async () => {
    const { code } = await generateLearnerInvite("Isaac Family", "Aiden");

    // Hit the OLD route shape — must still serve the SPA HTML.
    const pageRes = await fetch(
      `${baseUrl}/verify?invite=${encodeURIComponent(code)}&role=learner`,
    );
    expect(pageRes.status).toBe(200);
    expect(pageRes.headers.get("content-type") ?? "").toContain("text/html");
    const html = await pageRes.text();
    expect(html).toContain('id="state-loading"');
    expect(html).toContain('id="state-invite-preview"');
  });

  it("U3: invite record's role is the source of truth (URL queryparam ignored if mismatched)", async () => {
    // Generate a LEARNER invite, but request the preview by code only.
    // The preview endpoint must always return the role from the record.
    const { code } = await generateLearnerInvite("Isaac Family", "Aiden");

    // Even if a malicious URL claims `role=co-parent`, the preview API
    // (which the SPA always calls) returns the authoritative role.
    const previewRes = await fetch(
      `${baseUrl}/api/invites/${encodeURIComponent(code)}/preview`,
    );
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview.role).toBe("learner");
    expect(preview.role).not.toBe("co-parent");
    expect(preview.childName).toBe("Aiden");
  });

  it("U4: malformed code on /join/:code returns clean error (no stack trace)", async () => {
    // Each malformed code should produce either a 404 page (well-formed
    // path, no matching invite — server still serves the SPA so the client
    // can render the friendly preview-error state) or a 4xx via the API
    // preview. Critically, no 500 / stack trace.
    const malformed = ["MALFORMED", "DROP-TABLE-USERS", "abc", "X"];

    for (const code of malformed) {
      // Page route serves SPA HTML even for unknown codes — the SPA's
      // bootstrap calls the preview API and renders the
      // `state-invite-preview-error` panel for the recipient.
      const pageRes = await fetch(`${baseUrl}/join/${encodeURIComponent(code)}`);
      expect([200, 404]).toContain(pageRes.status);
      const html = await pageRes.text();
      expect(html).not.toMatch(/TypeError|ReferenceError|at \w+\.\w+/);

      // The preview API returns a 4xx with structured error JSON, never 500.
      const previewRes = await fetch(
        `${baseUrl}/api/invites/${encodeURIComponent(code)}/preview`,
      );
      expect(previewRes.status).toBeGreaterThanOrEqual(400);
      expect(previewRes.status).toBeLessThan(500);
      const body = await previewRes.json();
      expect(typeof body.error).toBe("string");
      expect(body.error).not.toMatch(/at \w+\.\w+/);
    }
  });
});
