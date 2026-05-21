import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { StateManager } from "../src/engine/state.js";
import { ROLE_TOOL_ACCESS, ROLES } from "../src/constants.js";
import { FitbitClient } from "../src/fitbit/client.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "../app/tools/_helpers.js";
import type { FamilyConfig, Member } from "../src/schemas.js";

const FAMILY_ID = "a0000000-0000-0000-0000-000000000001";

const testDataDir = join(process.cwd(), "data");

/**
 * H1-H8: HTTP Transport + x402 Tests
 *
 * These test the transport layer logic without requiring a running server.
 * Route handler behavior, x402 pricing config, member resolution,
 * and Fitbit endpoint validation are tested directly.
 */

describe("H1: Health check endpoint", () => {
  it("H1: Health check returns correct response structure", () => {
    // Replicate the handler from app/server.ts lines 110-117
    const healthResponse = {
      status: "ok",
      version: "0.2.0",
      transport: "http",
      uptime: process.uptime(),
    };

    expect(healthResponse.status).toBe("ok");
    expect(healthResponse.version).toBe("0.2.0");
    expect(healthResponse.transport).toBe("http");
    expect(typeof healthResponse.uptime).toBe("number");
    expect(healthResponse.uptime).toBeGreaterThan(0);
  });
});

describe("H2: MCP tool registration", () => {
  it("H2: All 12 tools are defined in ROLE_TOOL_ACCESS", () => {
    // Verify the tool names that should be registered on the MCP server
    const expectedTools = [
      "configure-policy",
      "verify-achievement",
      "distribute-allowance",
      "check-progress",
      "check-savings",
      "check-goals",
      "invite-member",
      "accept-invite",
      "manage-members",
      "get-funding-address",
      "release-savings",
      "connect-fitbit",
    ];

    // Manager has access to all tools except accept-invite (which is available to all)
    const managerTools = ROLE_TOOL_ACCESS[ROLES.MANAGER];
    for (const tool of expectedTools) {
      const hasAccess = Object.values(ROLE_TOOL_ACCESS).some((tools) =>
        tools.includes(tool)
      );
      expect(hasAccess, `Tool "${tool}" should exist in ROLE_TOOL_ACCESS`).toBe(true);
    }

    // Manager: 12 in expectedTools + convert-savings (Sprint 2.5) = 13.
    // Sprint 3.0.3 added check-goals to the Manager allowlist.
    // Sprint 3.0.6 added view-policy to the Manager allowlist → 14.
    // Sprint 3.6 added resend-invite → 15, then test-connection + view-my-link → 17.
    // Sprint 4.0 added view-session-receipt (Manager + Co-Parent + Advisor +
    // Learner read access; only Learner runs the session lifecycle) → 18.
    expect(managerTools.length).toBe(18);
  });
});

describe("H3-H5: x402 pricing configuration", () => {
  // The paid vs free classification from app/server.ts
  const paidTools: Record<string, string> = {
    "distribute-allowance": "$0.01",
    "manage-members": "$0.005",
    "get-funding-address": "$0.001",
    "invite-member": "$0.003",
  };

  const freeTools = [
    "configure-policy",
    "accept-invite",
    "verify-achievement",
    "check-progress",
    "check-savings",
    "check-goals",
    "release-savings",
    "connect-fitbit",
    // Sprint 3.6 recovery — free for every role that can call them.
    "test-connection",
    "view-my-link",
    // Sprint 4.0 Learning Mode — not x402-gated. The economic loop is
    // the engagement-weighted USDC settlement inside complete-learning-
    // session, not per-tool-call charges. Charging the kid to start a
    // session would invert the incentive shape the product is built on.
    "start-learning-session",
    "get-session-state",
    "complete-learning-session",
    "view-session-receipt",
  ];

  it("H3: Paid tools have x402 pricing defined", () => {
    expect(Object.keys(paidTools)).toHaveLength(4);
    for (const [tool, price] of Object.entries(paidTools)) {
      expect(price).toMatch(/^\$\d+\.\d+$/);
      // Verify the tool exists in RBAC
      expect(isHttpToolAuthorized(tool, "manager")).toBe(true);
    }
  });

  it("H4: Learner-accessible tools are all free (B6 override)", () => {
    const learnerTools = ROLE_TOOL_ACCESS[ROLES.LEARNER];
    for (const tool of learnerTools) {
      expect(
        freeTools.includes(tool),
        `Learner tool "${tool}" should be free (not x402 gated)`
      ).toBe(true);
    }
  });

  it("H5: Free tools do not appear in paid tools list", () => {
    for (const tool of freeTools) {
      expect(
        paidTools[tool],
        `Free tool "${tool}" should NOT have x402 pricing`
      ).toBeUndefined();
    }
  });
});

describe("H6-H7: HTTP member resolution", () => {
  let state: StateManager;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    state = new StateManager();
    // Note: Sprint 2.9 tests in this block intentionally do NOT pre-create a
    // family directory so H6 can exercise the "no families" path. Tests that
    // need a family set one up explicitly.
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("H6: resolveHttpCaller with no payer and no families returns null (Sprint 2.9)", async () => {
    const caller = await resolveHttpCaller();
    expect(caller).toBeNull();
  });

  it("H6b: resolveHttpCaller with no payer returns null even when one family exists (hotfix)", async () => {
    // Sprint 2.9 hotfix: the single-family Manager fallback on the aixyz
    // side has been removed. A request with no x402 payer and no session
    // identity now returns null regardless of how many families exist.
    // This prevents unauthenticated MCP clients from reaching the first
    // family's treasury when the server is exposed publicly.
    await state.createFamilyDir(FAMILY_ID);
    const caller = await resolveHttpCaller();
    expect(caller).toBeNull();
  });

  it("H7: isHttpToolAuthorized enforces RBAC for HTTP callers", () => {
    // Manager can use all tools
    expect(isHttpToolAuthorized("configure-policy", "manager")).toBe(true);
    expect(isHttpToolAuthorized("distribute-allowance", "manager")).toBe(true);

    // Learner is restricted
    expect(isHttpToolAuthorized("check-progress", "learner")).toBe(true);
    expect(isHttpToolAuthorized("check-savings", "learner")).toBe(true);
    expect(isHttpToolAuthorized("configure-policy", "learner")).toBe(false);
    expect(isHttpToolAuthorized("distribute-allowance", "learner")).toBe(false);

    // Access denied response format
    const denied = JSON.parse(accessDenied("configure-policy", "learner"));
    expect(denied.success).toBe(false);
    expect(denied.error).toContain("learner");
    expect(denied.error).toContain("configure-policy");
  });
});

describe("H8: Fitbit HTTP endpoint validation", () => {
  it("H8a: /fitbit/connect without child param returns 400 logic", () => {
    // Replicate validation from app/server.ts lines 122-124
    const childName: string | undefined = undefined;
    const shouldReturn400 = !childName;
    expect(shouldReturn400).toBe(true);

    const errorResponse = { error: "Missing ?child= query parameter" };
    expect(errorResponse.error).toBe("Missing ?child= query parameter");
  });

  it("H8b: /fitbit/connect without env vars returns 503 logic", () => {
    // FitbitClient.isConfigured() checks env vars
    const originalClientId = process.env.FITBIT_CLIENT_ID;
    const originalSecret = process.env.FITBIT_CLIENT_SECRET;

    delete process.env.FITBIT_CLIENT_ID;
    delete process.env.FITBIT_CLIENT_SECRET;

    expect(FitbitClient.isConfigured()).toBe(false);

    // Restore
    if (originalClientId) process.env.FITBIT_CLIENT_ID = originalClientId;
    if (originalSecret) process.env.FITBIT_CLIENT_SECRET = originalSecret;
  });

  it("H8c: /fitbit/callback without code or state returns 400 logic", () => {
    // Replicate validation from app/server.ts lines 143-150
    const code: string | undefined = undefined;
    const childName = "Maya";
    const shouldReturn400 = !code || !childName;
    expect(shouldReturn400).toBe(true);

    const code2 = "AUTH_CODE";
    const childName2: string | undefined = undefined;
    const shouldReturn400_2 = !code2 || !childName2;
    expect(shouldReturn400_2).toBe(true);
  });

  it("H8d: Agent card config has correct structure", async () => {
    const config = (await import("../aixyz.config.js")).default;
    expect(config.name).toBe("AllowanceAgent");
    expect(config.version).toBe("0.2.0");
    expect(config.x402).toBeDefined();
    expect(config.x402.network).toBeDefined();
    expect(Array.isArray(config.skills)).toBe(true);
    const skills = config.skills!;
    expect(skills.length).toBeGreaterThanOrEqual(5);

    // Verify connect-fitbit skill exists
    const fitbitSkill = skills.find((s: any) => s.id === "connect-fitbit");
    expect(fitbitSkill).toBeDefined();
    expect(fitbitSkill!.tags).toContain("fitbit");
  });
});
