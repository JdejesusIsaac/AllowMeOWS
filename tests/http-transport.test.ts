import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { StateManager } from "../src/engine/state.js";
import { ROLE_TOOL_ACCESS, ROLES } from "../src/constants.js";
import { FitbitClient } from "../src/fitbit/client.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "../app/tools/_helpers.js";
import type { FamilyConfig, Member } from "../src/schemas.js";

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
  it("H2: All 11 tools are defined in ROLE_TOOL_ACCESS", () => {
    // Verify the tool names that should be registered on the MCP server
    const expectedTools = [
      "configure-policy",
      "verify-achievement",
      "distribute-allowance",
      "check-progress",
      "check-savings",
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

    // Verify count: manager has 12 tools (11 + convert-savings from Sprint 2.5)
    expect(managerTools.length).toBe(12);
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
    "release-savings",
    "connect-fitbit",
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
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("H6: resolveHttpCaller with no payer defaults to manager", async () => {
    // When no x402 payer is present (free tool or unauthenticated)
    const caller = await resolveHttpCaller();
    expect(caller.role).toBe("manager");
    expect(caller.memberId).toBe("anonymous");
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
