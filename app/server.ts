import { AixyzServer } from "aixyz/server";
import { useA2A } from "aixyz/server/adapters/a2a";
import { AixyzMCP } from "aixyz/server/adapters/mcp";
import { resolveMasterKey } from "../src/keys/master-key.js";
import * as agent from "./agent";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

// Resolve master encryption key at startup (auto-generates if needed)
try {
  resolveMasterKey();
} catch (err) {
  console.error("[AllowanceAgent] FATAL: Could not resolve master key:", err);
  process.exit(1);
}

// Import tools for MCP exposure
import configurePolicy from "./tools/configure-policy";
import verifyAchievement from "./tools/verify-achievement";
import distributeAllowance from "./tools/distribute-allowance";
import checkProgress from "./tools/check-progress";
import checkSavings from "./tools/check-savings";
import inviteMember from "./tools/invite-member";
import acceptInvite from "./tools/accept-invite";
import manageMembers from "./tools/manage-members";
import getFundingAddress from "./tools/get-funding-address";
import releaseSavings from "./tools/release-savings";
import connectFitbit from "./tools/connect-fitbit";
import { FitbitClient } from "../src/fitbit/client";

// ===== Crash Guard =====
process.on("unhandledRejection", (reason) => {
  console.error("[AllowanceAgent] Unhandled rejection (suppressed):", reason);
});

// ===== Server Initialization =====
console.log("[AllowanceAgent] Creating server...");
const server = new AixyzServer();
await server.initialize();

// ===== A2A: Agent-to-Agent Discovery + JSON-RPC =====
// Other agents (OpenMAIC, MoonPay) discover AllowanceAgent at:
//   GET  /.well-known/agent-card.json  (capabilities, skills)
//   POST /agent                        (JSON-RPC task execution)
console.log("[AllowanceAgent] Wiring A2A...");
useA2A(server, agent);

// ===== MCP: Model Context Protocol =====
// Claude Desktop, Cursor, VS Code connect at:
//   POST /mcp  (StreamableHTTPServerTransport)
// Each tool priced individually via x402. Free tools omit `accepts`.
console.log("[AllowanceAgent] Creating MCP...");
const mcp = new AixyzMCP(server);

// --- Paid tools (x402 gated) ---
// Only manager power tools that move money or change membership are gated.
// These are what external agents (OpenMAIC, MoonPay) pay for.
await mcp.register("distribute-allowance", {
  default: distributeAllowance,
  accepts: { scheme: "exact", price: "$0.01" },
});

await mcp.register("manage-members", {
  default: manageMembers,
  accepts: { scheme: "exact", price: "$0.005" },
});

await mcp.register("get-funding-address", {
  default: getFundingAddress,
  accepts: { scheme: "exact", price: "$0.001" },
});

await mcp.register("invite-member", {
  default: inviteMember,
  accepts: { scheme: "exact", price: "$0.003" },
});

// --- Free tools (no x402 gating) ---
// Learner-accessible tools are free so daughter's Claude Mobile works seamlessly.
// Direct Claude users (parent + child) should never hit a 402 paywall.
await mcp.register("configure-policy", {
  default: configurePolicy,
  // Free — initial setup should not require payment
});

await mcp.register("accept-invite", {
  default: acceptInvite,
  // Free — joining a family should be frictionless
});

await mcp.register("verify-achievement", {
  default: verifyAchievement,
  // Free — children self-report achievements via Claude Mobile
});

await mcp.register("check-progress", {
  default: checkProgress,
  // Free — children check their own progress via Claude Mobile
});

await mcp.register("check-savings", {
  default: checkSavings,
  // Free — children check their savings via Claude Mobile
});

await mcp.register("release-savings", {
  default: releaseSavings,
  // Free — releasing earned savings is not a paid action
});

await mcp.register("connect-fitbit", {
  default: connectFitbit,
  // Free — initiating Fitbit connection should be frictionless
});

console.log("[AllowanceAgent] Connecting MCP...");
await mcp.connect();

// ===== Custom Routes =====
// Health check
server.express.get("/health", (_req: any, res: any) => {
  res.json({
    status: "ok",
    version: "0.2.0",
    transport: "http",
    uptime: process.uptime(),
  });
});

// ===== Fitbit OAuth Endpoints =====
// GET /fitbit/connect?child=maya → redirect to Fitbit consent screen
server.express.get("/fitbit/connect", (req: any, res: any) => {
  const childName = req.query.child as string;
  if (!childName) {
    return res.status(400).json({ error: "Missing ?child= query parameter" });
  }
  if (!FitbitClient.isConfigured()) {
    return res.status(503).json({ error: "Fitbit not configured. Set FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET." });
  }
  try {
    const client = new FitbitClient();
    const authUrl = client.getAuthUrl(childName);
    res.redirect(authUrl);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// GET /fitbit/callback?code=AUTH_CODE&state=childName → exchange code, store tokens, redirect to success
server.express.get("/fitbit/callback", async (req: any, res: any) => {
  const code = req.query.code as string;
  const childName = req.query.state as string;

  if (!code || !childName) {
    return res.status(400).send(`
      <html><body style="font-family:system-ui;max-width:500px;margin:40px auto;text-align:center">
        <h2>Connection Failed</h2>
        <p>Missing authorization code or child name. Please try again from your AllowanceAgent.</p>
      </body></html>
    `);
  }

  try {
    const client = new FitbitClient();
    await client.exchangeCode(code, childName);
    console.log(`[Fitbit] Successfully connected for child: ${childName}`);
    res.send(`
      <html><body style="font-family:system-ui;max-width:500px;margin:40px auto;text-align:center">
        <h2>Fitbit Connected!</h2>
        <p><strong>${childName}</strong>'s Fitbit account is now linked.</p>
        <p>Health achievements (steps, active minutes) will be tracked automatically.</p>
        <p style="color:#666;margin-top:24px">You can close this tab and return to Claude.</p>
      </body></html>
    `);
  } catch (error) {
    console.error(`[Fitbit] OAuth callback error for ${childName}:`, error);
    res.status(500).send(`
      <html><body style="font-family:system-ui;max-width:500px;margin:40px auto;text-align:center">
        <h2>Connection Failed</h2>
        <p>Could not connect Fitbit for ${childName}.</p>
        <p style="color:#c00">${error instanceof Error ? error.message : "Unknown error"}</p>
        <p>Please try again from your AllowanceAgent.</p>
      </body></html>
    `);
  }
});

// ===== Start Listening =====
const PORT = parseInt(process.env.PORT || "3000", 10);
// Serve landing page at GET /
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "..", "public");
const landingHtml = readFileSync(join(publicDir, "index.html"), "utf-8");

server.express.get("/", (_req: any, res: any) => {
  res.type("html").send(landingHtml);
});

const httpServer = server.express.listen(PORT, () => {
  console.log(`[AllowanceAgent] Server listening on http://localhost:${PORT}`);
  console.log(`  A2A:    http://localhost:${PORT}/agent`);
  console.log(`  MCP:    http://localhost:${PORT}/mcp`);
  console.log(`  Card:   http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`  Health: http://localhost:${PORT}/health`);
});

// Graceful shutdown for Railway zero-downtime deploys
process.on("SIGTERM", () => {
  console.error("[AllowanceAgent] SIGTERM received, shutting down gracefully");
  httpServer.close(() => {
    console.error("[AllowanceAgent] Server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
});

export default server;
