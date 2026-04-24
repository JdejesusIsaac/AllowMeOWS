import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveCallerRole,
  isToolAuthorized,
  buildAccessDeniedResponse,
  stripInternalArgs,
} from "../src/middleware/access-control.js";
import { ROLES } from "../src/constants.js";
import { createTestFamily } from "./helpers/family.js";

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

describe("resolveCallerRole (Sprint 2.9)", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("returns null with no identity and no families (no default Manager)", async () => {
    const result = await resolveCallerRole({});
    expect(result).toBeNull();
  });

  it("returns legacy single-family fallback when exactly one family exists", async () => {
    await createTestFamily({ familyName: "SoloFamily" });
    const result = await resolveCallerRole({});
    expect(result).not.toBeNull();
    expect(result!.role).toBe(ROLES.MANAGER);
    expect(result!.memberId).toBe("legacy-manager");
  });

  it("returns null with no identity and multiple families (fallback deactivates)", async () => {
    await createTestFamily({ familyName: "Alice" });
    await createTestFamily({ familyName: "Bob" });
    const result = await resolveCallerRole({});
    expect(result).toBeNull();
  });

  it("uses explicit _callerRole + _familyId (test mode)", async () => {
    const { familyId } = await createTestFamily();
    const result = await resolveCallerRole({
      _callerRole: "co-parent",
      _familyId: familyId,
    });
    expect(result).not.toBeNull();
    expect(result!.role).toBe("co-parent");
    expect(result!.familyId).toBe(familyId);
  });

  it("looks up member by _callerId via MemberIndex", async () => {
    const family = await createTestFamily();
    const result = await resolveCallerRole({ _callerId: family.memberId });
    expect(result).not.toBeNull();
    expect(result!.role).toBe(ROLES.MANAGER);
    expect(result!.memberId).toBe(family.memberId);
    expect(result!.familyId).toBe(family.familyId);
  });

  it("returns null for unknown _callerId (no default Manager fallback)", async () => {
    await createTestFamily();
    const result = await resolveCallerRole({ _callerId: "nonexistent-id" });
    // With one family present, the legacy single-family fallback activates
    // (member-id doesn't match, so the resolver falls through to Priority 5).
    expect(result).not.toBeNull();
    expect(result!.memberId).toBe("legacy-manager");
  });

  it("_callerRole without _familyId falls through (pure test-mode requires both)", async () => {
    const result = await resolveCallerRole({ _callerRole: "co-parent" });
    expect(result).toBeNull();
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
