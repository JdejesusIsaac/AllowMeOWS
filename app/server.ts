import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { resolveMasterKey } from "../src/keys/master-key.js";
import { migrateToMultiTenant } from "../src/migrations/2.9-multi-tenant.js";
import { FitbitClient } from "../src/fitbit/client.js";
import { runWithRequestContext } from "../src/middleware/request-context.js";
import { StateManager } from "../src/engine/state.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

// Tool registrations (same as src/index.ts)
import { registerConfigurePolicyTool } from "../src/tools/configure-policy.js";
import { registerVerifyAchievementTool } from "../src/tools/verify-achievement.js";
import { registerDistributeAllowanceTool } from "../src/tools/distribute-allowance.js";
import { registerCheckProgressTool } from "../src/tools/check-progress.js";
import { registerCheckSavingsTool } from "../src/tools/check-savings.js";
import { registerInviteMemberTool } from "../src/tools/invite-member.js";
import { registerAcceptInviteTool } from "../src/tools/accept-invite.js";
import { registerManageMembersTool } from "../src/tools/manage-members.js";
import { registerGetFundingAddressTool } from "../src/tools/get-funding-address.js";
import { registerReleaseSavingsTool } from "../src/tools/release-savings.js";
import { registerConnectFitbitTool } from "../src/tools/connect-fitbit.js";
import { registerConvertSavingsTool } from "../src/tools/convert-savings.js";

// ===== Resolve master key at startup =====
try {
  resolveMasterKey();
} catch (err) {
  console.error("[AllowanceAgent] Failed to resolve master key:", err);
  process.exit(1);
}

// ===== Run Sprint 2.9 multi-tenant migration at startup =====
try {
  await migrateToMultiTenant();
} catch (err) {
  console.error("[AllowanceAgent] FATAL: Sprint 2.9 migration failed:", err);
  process.exit(1);
}


// ===== Crash guard =====
process.on("unhandledRejection", (reason) => {
  console.error("[AllowanceAgent] Unhandled rejection (suppressed):", reason);
});

// ===== Express app =====
const app = express();
app.use(express.json());
app.use(cors({ origin: "*", exposedHeaders: ["Mcp-Session-Id"] }));

// ===== Session management =====
const transports: Record<string, StreamableHTTPServerTransport> = {};

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "allowance-agent",
    version: "0.3.0",
  });

  // Register all 12 tools — same registrations as src/index.ts
  registerConfigurePolicyTool(server);
  registerVerifyAchievementTool(server);
  registerDistributeAllowanceTool(server);
  registerCheckProgressTool(server);
  registerCheckSavingsTool(server);
  registerInviteMemberTool(server);
  registerAcceptInviteTool(server);
  registerManageMembersTool(server);
  registerGetFundingAddressTool(server);
  registerReleaseSavingsTool(server);
  registerConnectFitbitTool(server);
  registerConvertSavingsTool(server);

  return server;
}

/**
 * Build the per-request AsyncLocalStorage context so deeply-nested tool
 * handlers can read auth headers (X-Member-Id) and URL query params
 * (?setup=CODE) via `getRequestContext()`.
 */
function buildRequestContext(req: express.Request) {
  return {
    headers: req.headers as Record<string, string | string[] | undefined>,
    query: req.query as Record<string, string | string[] | undefined>,
  };
}

// ===== MCP endpoint: POST /mcp =====
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    // Existing session
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New session — create transport + server
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        transports[newSessionId] = transport;
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };

    const server = createMcpServer();
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID" },
      id: null,
    });
    return;
  }

  await runWithRequestContext(buildRequestContext(req), () =>
    transport.handleRequest(req, res, req.body)
  );
});

// ===== MCP endpoint: GET /mcp (SSE fallback for resumable streams) =====
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await runWithRequestContext(buildRequestContext(req), () =>
    transports[sessionId].handleRequest(req, res)
  );
});

// ===== MCP endpoint: DELETE /mcp (session cleanup) =====
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await runWithRequestContext(buildRequestContext(req), () =>
    transports[sessionId].handleRequest(req, res)
  );
});

// ===== Health check =====
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "0.3.0",
    transport: "http",
    tools: 12,
    uptime: process.uptime(),
  });
});

// ===== Fitbit OAuth endpoints =====
//
// Sprint 2.9: Fitbit connections are scoped to a family. The `/fitbit/connect`
// entry point now requires `?family=<familyId>&child=<name>`. Legacy callers
// that only supply `?child=` are accepted when the server has exactly one
// family (single-family fallback). The OAuth `state` param carries
// "familyId:childName" so the callback can route tokens to the correct family.

async function resolveFitbitFamilyId(requested?: string): Promise<string | null> {
  if (requested) return requested;
  const families = await new StateManager().listFamilies();
  if (families.length === 1) return families[0];
  return null;
}

app.get("/fitbit/connect", async (req, res) => {
  const childName = req.query.child as string | undefined;
  const requestedFamily = req.query.family as string | undefined;
  if (!childName) {
    return res.status(400).json({ error: "Missing ?child= query parameter" });
  }
  if (!FitbitClient.isConfigured()) {
    return res.status(503).json({ error: "Fitbit not configured." });
  }
  const familyId = await resolveFitbitFamilyId(requestedFamily);
  if (!familyId) {
    return res.status(400).json({
      error: "Missing ?family= query parameter (required when more than one family is registered)",
    });
  }
  try {
    const client = new FitbitClient(familyId);
    res.redirect(client.getAuthUrl(childName));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/fitbit/callback", async (req, res) => {
  const code = req.query.code as string;
  const rawState = req.query.state as string;
  if (!code || !rawState) {
    return res.status(400).send(`
      <html><body style="font-family:system-ui;max-width:500px;margin:40px auto;text-align:center">
        <h2>Connection Failed</h2>
        <p>Missing authorization code or state. Please try again.</p>
      </body></html>
    `);
  }
  // Sprint 2.9 state format: "familyId:childName". Legacy state format
  // (childName alone) is accepted for backward compat with the single-family
  // fallback.
  let familyId: string | null;
  let childName: string;
  if (rawState.includes(":")) {
    const [f, ...rest] = rawState.split(":");
    familyId = f;
    childName = rest.join(":");
  } else {
    childName = rawState;
    familyId = await resolveFitbitFamilyId(undefined);
  }
  if (!familyId || !childName) {
    return res.status(400).send(`
      <html><body style="font-family:system-ui;max-width:500px;margin:40px auto;text-align:center">
        <h2>Connection Failed</h2>
        <p>Could not resolve which family this Fitbit connection belongs to. Re-run connect-fitbit from Claude.</p>
      </body></html>
    `);
  }
  try {
    const client = new FitbitClient(familyId);
    await client.exchangeCode(code, childName);
    console.log(`[Fitbit] Connected for child: ${childName} (family ${familyId})`);
    res.send(`
      <html><body style="font-family:system-ui;max-width:500px;margin:40px auto;text-align:center">
        <h2>Fitbit Connected!</h2>
        <p><strong>${childName}</strong>'s Fitbit is linked.</p>
        <p>You can close this tab and return to Claude.</p>
      </body></html>
    `);
  } catch (error) {
    console.error(`[Fitbit] Callback error for ${childName}:`, error);
    res.status(500).send(`
      <html><body style="font-family:system-ui;max-width:500px;margin:40px auto;text-align:center">
        <h2>Connection Failed</h2>
        <p>${error instanceof Error ? error.message : "Unknown error"}</p>
      </body></html>
    `);
  }
});

// ===== Landing page =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "..", "public");
const landingPath = join(publicDir, "index.html");

if (existsSync(landingPath)) {
  const landingHtml = readFileSync(landingPath, "utf-8");
  app.get("/", (_req, res) => {
    res.type("html").send(landingHtml);
  });
}

// ===== Start server =====
const PORT = parseInt(process.env.PORT || "3001", 10);
const httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[AllowanceAgent] Server listening on http://0.0.0.0:${PORT}`);
  console.log(`  MCP:    http://0.0.0.0:${PORT}/mcp`);
  console.log(`  Health: http://0.0.0.0:${PORT}/health`);
});

// ===== Graceful shutdown =====
process.on("SIGTERM", () => {
  console.error("[AllowanceAgent] SIGTERM received, shutting down");
  httpServer.close(() => {
    console.error("[AllowanceAgent] Server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
});

export default app;
