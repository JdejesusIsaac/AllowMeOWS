import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveCallerRole,
  isToolAuthorized,
  buildAccessDeniedResponse,
  stripInternalArgs,
} from "../src/middleware/access-control.js";
import { StateManager } from "../src/engine/state.js";
import { ROLES } from "../src/constants.js";

const testDataDir = join(process.cwd(), "data");

describe("isToolAuthorized", () => {
  // Manager has access to all 8 tools
  it("grants manager access to configure-policy", () => {
    expect(isToolAuthorized("configure-policy", "manager")).toBe(true);
  });
  it("grants manager access to distribute-allowance", () => {
    expect(isToolAuthorized("distribute-allowance", "manager")).toBe(true);
  });
  it("grants manager access to manage-members", () => {
    expect(isToolAuthorized("manage-members", "manager")).toBe(true);
  });

  // Co-parent has limited access
  it("grants co-parent access to verify-achievement", () => {
    expect(isToolAuthorized("verify-achievement", "co-parent")).toBe(true);
  });
  it("grants co-parent access to check-progress", () => {
    expect(isToolAuthorized("check-progress", "co-parent")).toBe(true);
  });
  it("denies co-parent access to configure-policy", () => {
    expect(isToolAuthorized("configure-policy", "co-parent")).toBe(false);
  });
  it("denies co-parent access to distribute-allowance", () => {
    expect(isToolAuthorized("distribute-allowance", "co-parent")).toBe(false);
  });
  it("denies co-parent access to manage-members", () => {
    expect(isToolAuthorized("manage-members", "co-parent")).toBe(false);
  });

  // Family role
  it("grants family access to check-progress", () => {
    expect(isToolAuthorized("check-progress", "family")).toBe(true);
  });
  it("denies family access to verify-achievement", () => {
    expect(isToolAuthorized("verify-achievement", "family")).toBe(false);
  });
  it("denies family access to distribute-allowance", () => {
    expect(isToolAuthorized("distribute-allowance", "family")).toBe(false);
  });

  // Advisor role
  it("grants advisor access to query-audit-log", () => {
    expect(isToolAuthorized("query-audit-log", "advisor")).toBe(true);
  });
  it("denies advisor access to everything else", () => {
    expect(isToolAuthorized("configure-policy", "advisor")).toBe(false);
    expect(isToolAuthorized("verify-achievement", "advisor")).toBe(false);
    expect(isToolAuthorized("distribute-allowance", "advisor")).toBe(false);
    expect(isToolAuthorized("check-progress", "advisor")).toBe(false);
  });

  // Accept-invite is available to all roles
  it("grants accept-invite to all roles", () => {
    expect(isToolAuthorized("accept-invite", "manager")).toBe(true);
    expect(isToolAuthorized("accept-invite", "co-parent")).toBe(true);
    expect(isToolAuthorized("accept-invite", "family")).toBe(true);
    expect(isToolAuthorized("accept-invite", "advisor")).toBe(true);
  });
});

describe("resolveCallerRole", () => {
  beforeEach(async () => {
    await mkdir(testDataDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("defaults to manager when no role info provided", async () => {
    const result = await resolveCallerRole({});
    expect(result.role).toBe(ROLES.MANAGER);
    expect(result.memberId).toBe("manager");
  });

  it("uses explicit _callerRole override", async () => {
    const result = await resolveCallerRole({ _callerRole: "co-parent" });
    expect(result.role).toBe("co-parent");
  });

  it("uses explicit _callerId + _callerRole", async () => {
    const result = await resolveCallerRole({
      _callerRole: "family",
      _callerId: "grandma-123",
    });
    expect(result.role).toBe("family");
    expect(result.memberId).toBe("grandma-123");
  });

  it("looks up member by _callerId from state", async () => {
    const state = new StateManager();
    const memberId = "a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4";
    await state.addMember({
      id: memberId,
      name: "Grandma Rosa",
      role: "family",
      joinedAt: new Date().toISOString(),
      active: true,
    });

    const result = await resolveCallerRole({ _callerId: memberId });
    expect(result.role).toBe("family");
    expect(result.memberId).toBe(memberId);
  });

  it("defaults to manager for unknown _callerId", async () => {
    const result = await resolveCallerRole({ _callerId: "nonexistent" });
    expect(result.role).toBe(ROLES.MANAGER);
  });
});

describe("buildAccessDeniedResponse", () => {
  it("returns structured error with role and tool info", () => {
    const resp = buildAccessDeniedResponse("distribute-allowance", "family");
    expect(resp.content).toHaveLength(1);
    const parsed = JSON.parse(resp.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("family");
    expect(parsed.error).toContain("distribute-allowance");
    expect(parsed.role).toBe("family");
    expect(parsed.toolName).toBe("distribute-allowance");
  });
});

describe("stripInternalArgs", () => {
  it("removes _callerRole and _callerId", () => {
    const args = {
      childName: "Maya",
      score: 85,
      _callerRole: "manager",
      _callerId: "mgr-1",
    };
    const stripped = stripInternalArgs(args);
    expect(stripped).toEqual({ childName: "Maya", score: 85 });
    expect("_callerRole" in stripped).toBe(false);
    expect("_callerId" in stripped).toBe(false);
  });

  it("works when internal args are absent", () => {
    const args = { childName: "Maya" };
    const stripped = stripInternalArgs(args);
    expect(stripped).toEqual({ childName: "Maya" });
  });
});
