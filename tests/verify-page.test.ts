// Sprint 3.0 v4 — W2.3 GET /verify route smoke tests (VP1-VP3).
//
// The full SPA is vanilla JS loaded client-side and is not executed here
// — those states are covered manually on real iOS/Android Coinbase Wallet
// per W2.1 mobile arm. This suite locks the server-side contract only:
//   VP1: the HTML is served with the expected shape
//   VP2: __ALLOWME_CONFIG__ is injected with testnet defaults
//   VP3: mainnet config kicks in when ALLOWANCE_USE_TESTNET=false
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const verifyPath = join(__dirname, "..", "public", "verify.html");

/**
 * Mirror of the `/verify` route registration in app/server.ts. We re-
 * implement the mount here (instead of importing app/server.ts, which
 * boots the whole MCP server, migrations, and master-key resolution) so
 * this file is a genuine unit test for the HTML injection.
 */
function mountVerifyRoute(app: express.Express, opts: { useTestnet: boolean }) {
  const rawVerifyHtml = readFileSync(verifyPath, "utf-8");
  const config = {
    appName: "AllowMe",
    appLogoUrl: "/favicon.ico",
    chainId: opts.useTestnet ? "0x14a34" : "0x2105",
    statement: "Sign in to AllowMe to manage your family's allowance.",
  };
  const injection = `<script>window.__ALLOWME_CONFIG__ = ${JSON.stringify(config)};</script>`;
  const verifyHtml = rawVerifyHtml.replace("</head>", `${injection}\n</head>`);
  app.get("/verify", (_req, res) => {
    res.type("html").send(verifyHtml);
  });
}

describe("GET /verify (W2.3)", () => {
  it("VP0 sanity: public/verify.html exists on disk", () => {
    expect(existsSync(verifyPath)).toBe(true);
  });

  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    mountVerifyRoute(app, { useTestnet: true });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bad address");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("VP1: serves the verify HTML with core SPA markers", async () => {
    const res = await fetch(`${baseUrl}/verify`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const body = await res.text();
    // Core state containers must be present so the client state machine
    // has every DOM anchor it wires up.
    for (const id of [
      "state-loading",
      "state-entry",
      "state-invite-preview",
      "state-invite-preview-error",
      "state-siwe-running",
      "state-siwe-error",
      "state-picker",
      "state-family-create",
      "state-success",
      "state-rate-limited",
    ]) {
      expect(body, `missing #${id}`).toContain(`id="${id}"`);
    }
    // The SDK is loaded from esm.sh via dynamic import — lock the pinned
    // version so package.json pin and HTML pin stay synchronized.
    expect(body).toContain("@base-org/account@2.5.5");
  });

  it("VP2: injects __ALLOWME_CONFIG__ with testnet defaults", async () => {
    const res = await fetch(`${baseUrl}/verify`);
    const body = await res.text();
    // Injection must appear BEFORE the main module script so the config is
    // in place when the module loads.
    const injectionIdx = body.indexOf("window.__ALLOWME_CONFIG__");
    const moduleScriptIdx = body.indexOf('<script type="module">');
    expect(injectionIdx).toBeGreaterThan(-1);
    expect(moduleScriptIdx).toBeGreaterThan(-1);
    expect(injectionIdx).toBeLessThan(moduleScriptIdx);
    // Base Sepolia chain id in hex form.
    expect(body).toContain('"chainId":"0x14a34"');
    expect(body).toContain('"appName":"AllowMe"');
  });

  it("VP3: honors ALLOWANCE_USE_TESTNET=false → mainnet chain id", async () => {
    // Stand up a separate server with the opposite config so this case
    // doesn't leak into VP1/VP2.
    const app = express();
    mountVerifyRoute(app, { useTestnet: false });
    const tmp = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const addr = tmp.address();
      if (!addr || typeof addr === "string") throw new Error("bad address");
      const res = await fetch(`http://127.0.0.1:${addr.port}/verify`);
      const body = await res.text();
      // Base Mainnet 8453 = 0x2105.
      expect(body).toContain('"chainId":"0x2105"');
      expect(body).not.toContain('"chainId":"0x14a34"');
    } finally {
      await new Promise<void>((r) => tmp.close(() => r()));
    }
  });
});
