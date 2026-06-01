// Sprint 4.0.2 W1 — OpenTelemetry must initialize before any other
// import that creates spans or instruments libraries (Express, HTTP).
// The SDK is env-conditional: it only starts when AXIOM_INGEST_TOKEN
// is set, so local-dev runs are unaffected.
import { startOtel } from "../src/observability/otel.js";
startOtel();

// Sprint 4.0.2 W4 — Sentry initializes second so the error boundary is
// established before any tool handler can throw. Also env-conditional.
import { initSentry } from "../src/observability/sentry.js";
await initSentry();

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
import { runDeepHealth } from "../src/health/deep-health.js";
import { runTool } from "../src/middleware/tool-runner.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

// Tool registrations (same as src/index.ts)
import { registerConfigurePolicyTool } from "../src/tools/configure-policy.js";
import { registerViewPolicyTool } from "../src/tools/view-policy.js";
import { registerVerifyAchievementTool } from "../src/tools/verify-achievement.js";
import { registerDistributeAllowanceTool } from "../src/tools/distribute-allowance.js";
import { registerSettleBalanceTool } from "../src/tools/settle-balance.js";
import { registerCheckProgressTool } from "../src/tools/check-progress.js";
import { registerCheckSavingsTool } from "../src/tools/check-savings.js";
import { registerCheckGoalsTool } from "../src/tools/check-goals.js";
import { registerInviteMemberTool } from "../src/tools/invite-member.js";
import { registerResendInviteTool } from "../src/tools/resend-invite.js";
import { registerAcceptInviteTool } from "../src/tools/accept-invite.js";
import { registerTestConnectionTool } from "../src/tools/test-connection.js";
import { registerViewMyLinkTool } from "../src/tools/view-my-link.js";
import { registerManageMembersTool } from "../src/tools/manage-members.js";
import { registerGetFundingAddressTool } from "../src/tools/get-funding-address.js";
import { registerReleaseSavingsTool } from "../src/tools/release-savings.js";
import { registerConnectFitbitTool } from "../src/tools/connect-fitbit.js";
import { registerConvertSavingsTool } from "../src/tools/convert-savings.js";
// Sprint 4.0 — Learning Mode tools
import { registerStartLearningSessionTool } from "../src/tools/start-learning-session.js";
import { registerGetSessionStateTool } from "../src/tools/get-session-state.js";
import { registerCompleteLearningSessionTool } from "../src/tools/complete-learning-session.js";
import { registerViewSessionReceiptTool } from "../src/tools/view-session-receipt.js";

// Sprint 3.0 v4 — Sign-in-with-Base verify-page endpoints.
import { buildVerifyRoutes } from "./verify-routes.js";

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

  // Sprint 4.0.2 W1 — wrap `server.tool` so every subsequent tool
  // registration gets its handler span-instrumented. This is the C15-
  // compliant approach: a single-file monkeypatch in app/server.ts
  // rather than 21 edits to individual tool registration files. The
  // wrapper records `tool.name` and `tool.success`; `tool.role` and
  // `tool.family_id` are recorded when available from the request
  // context (not all tools have a caller).
  const originalTool = server.tool.bind(server) as (...args: unknown[]) => unknown;
  // The MCP SDK's `tool` method has multiple overloads. The handler
  // is always the last function argument; we intercept and wrap it.
  (server as unknown as { tool: (...args: unknown[]) => unknown }).tool = (...args: unknown[]) => {
    const name = typeof args[0] === "string" ? (args[0] as string) : "unknown";
    const handlerIdx = args.findIndex((a) => typeof a === "function");
    if (handlerIdx === -1) {
      return originalTool(...args);
    }
    const handler = args[handlerIdx] as (...hArgs: unknown[]) => unknown;
    const wrapped = async (...hArgs: unknown[]) => {
      // Role / family_id are not available at wrap time — they're
      // resolved per-call by `withAccessControl`. The span records what
      // we know (tool.name + success/error); the per-tool tests in
      // tests/observability/otel.test.ts assert the full attribute set
      // via the lower-level `runTool` API.
      return runTool(
        { name, role: "unknown", familyId: "unknown" },
        async () => await handler(...hArgs),
      );
    };
    const newArgs = [...args];
    newArgs[handlerIdx] = wrapped;
    return originalTool(...newArgs);
  };

  // Register all 17 tools — same registrations as src/index.ts
  registerConfigurePolicyTool(server);
  registerViewPolicyTool(server);
  registerVerifyAchievementTool(server);
  registerDistributeAllowanceTool(server);
  registerCheckProgressTool(server);
  registerCheckGoalsTool(server);
  registerCheckSavingsTool(server);
  registerInviteMemberTool(server);
  registerResendInviteTool(server);
  registerTestConnectionTool(server);
  registerViewMyLinkTool(server);
  registerAcceptInviteTool(server);
  registerManageMembersTool(server);
  registerGetFundingAddressTool(server);
  registerReleaseSavingsTool(server);
  registerConnectFitbitTool(server);
  registerConvertSavingsTool(server);
  // Sprint 4.0 — Learning Mode lifecycle + parent visibility
  registerStartLearningSessionTool(server);
  registerGetSessionStateTool(server);
  registerCompleteLearningSessionTool(server);
  registerViewSessionReceiptTool(server);
  // Sprint 4.0.3 — settle-balance is the only on-chain path post-cutover.
  registerSettleBalanceTool(server);

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

// ===== Sprint 3.0 v4: verify-page + Sign-in-with-Base endpoints =====
app.use(buildVerifyRoutes());

// ===== Health check (Sprint 4.0.2 W5 — deep checks per contract C6) =====
// Four parallel checks: master key, OWS vault readability, recent tx
// outcome, policy engagement signal. Returns 503 when any check
// reports `status: "fail"`. The original lightweight body is
// preserved (version, transport, tools, uptime) for backward
// compatibility with any monitoring that reads those fields.
app.get("/health", async (_req, res) => {
  const deep = await runDeepHealth();
  const httpStatus = deep.status === "ok" ? 200 : 503;
  res.status(httpStatus).json({
    status: deep.status,
    version: "0.3.0",
    transport: "http",
    tools: 12,
    uptime: process.uptime(),
    checks: deep.checks,
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

// ===== Landing page + Sprint 3.0 v4 verify page =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "..", "public");
const landingPath = join(publicDir, "index.html");
const verifyPath = join(publicDir, "verify.html");

if (existsSync(landingPath)) {
  const landingHtml = readFileSync(landingPath, "utf-8");
  app.get("/", (_req, res) => {
    res.type("html").send(landingHtml);
  });
}

// W2.3 — GET /verify serves the Sign-in-with-Base onboarding SPA. Query
// params (`?invite=CODE&role=ROLE`) are read client-side by the page JS.
//
// Sprint 3.7 — GET /join/:code serves the same SPA at a cleaner path-shaped
// URL. The client-side bootstrap reads the path segment (or queryparam, for
// backward compat with old invite links) and resolves role-from-record via
// the `/api/invites/:code/preview` endpoint — the URL form does NOT carry
// the role. See research-3.7.md Decision 1 for the URL design rationale.
//
// The page expects a `window.__ALLOWME_CONFIG__` blob to pick up the
// network (testnet vs mainnet) and app branding, so we inject it inline
// before sending the raw HTML through. Injection uses a unique placeholder
// comment to avoid brittle string regex against the file's `<script>` tag.
if (existsSync(verifyPath)) {
  const rawVerifyHtml = readFileSync(verifyPath, "utf-8");
  const useTestnet = process.env.ALLOWANCE_USE_TESTNET !== "false";
  const config = {
    appName: "AllowMe",
    appLogoUrl: "/favicon.ico",
    // Base Sepolia 84532 (0x14a34) for pilot; Base Mainnet 8453 (0x2105) if flipped.
    chainId: useTestnet ? "0x14a34" : "0x2105",
    statement: "Sign in to AllowMe to manage your family's allowance.",
  };
  const injection = `<script>window.__ALLOWME_CONFIG__ = ${JSON.stringify(config)};</script>`;
  // The verify.html script block runs on DOMContentLoaded — inserting the
  // config assignment anywhere inside <head> ensures it executes first.
  const verifyHtml = rawVerifyHtml.replace("</head>", `${injection}\n</head>`);

  app.get("/verify", (_req, res) => {
    res.type("html").send(verifyHtml);
  });
  // Sprint 3.7 — path-shaped invite URL. The same SPA handles both forms;
  // client-side JS extracts the code from `location.pathname` when no
  // `?invite=` queryparam is present. Backward-compat with the old
  // `/verify?invite=…&role=…` form is preserved by the existing route.
  app.get("/join/:code", (_req, res) => {
    res.type("html").send(verifyHtml);
  });
}

// Sprint 3.6 — static markdown + verify-ua.js (`/copy/*.md`, `/verify-ua.js`, favicon…)
app.use(express.static(publicDir, { etag: true, index: false }));

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
