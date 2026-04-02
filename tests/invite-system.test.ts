import { describe, it, expect } from "vitest";
import { InviteSystem } from "../src/invites/system.js";
import type { Invite } from "../src/schemas.js";

const system = new InviteSystem();

describe("InviteSystem.generateCode", () => {
  it("produces a code in XXXX-XXXXX-XXXX format", () => {
    const code = system.generateCode("Maya", "family");
    const parts = code.split("-");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(4); // child prefix
    expect(parts[2]).toHaveLength(4); // random suffix
  });

  it("uses role hint in the middle segment", () => {
    const managerCode = system.generateCode("Maya", "manager");
    expect(managerCode).toContain("ADMIN");

    const familyCode = system.generateCode("Maya", "family");
    expect(familyCode).toContain("GIFT");

    const coParentCode = system.generateCode("Maya", "co-parent");
    expect(coParentCode).toContain("COPRT");

    const advisorCode = system.generateCode("Maya", "advisor");
    expect(advisorCode).toContain("ADVSR");
  });

  it("uppercases the child name prefix", () => {
    const code = system.generateCode("maya", "manager");
    expect(code.startsWith("MAYA")).toBe(true);
  });

  it("truncates long child names to 4 chars", () => {
    const code = system.generateCode("Alejandro", "family");
    expect(code.startsWith("ALEJ")).toBe(true);
  });

  it("generates unique codes", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      codes.add(system.generateCode("Maya", "family"));
    }
    // With 4-char alphanumeric suffix (32^4 = 1M+ combos), 50 should all be unique
    expect(codes.size).toBe(50);
  });

  it("avoids ambiguous characters (0, O, 1, I)", () => {
    // Generate many codes and check none contain ambiguous chars in suffix
    for (let i = 0; i < 100; i++) {
      const code = system.generateCode("Test", "family");
      const suffix = code.split("-")[2];
      expect(suffix).not.toMatch(/[01OI]/);
    }
  });
});

describe("InviteSystem.generateInvite", () => {
  it("creates an invite with 48h expiry", () => {
    const invite = system.generateInvite("family", "Maya", "TestFamily", "manager-id");
    const created = new Date(invite.createdAt).getTime();
    const expires = new Date(invite.expiresAt).getTime();
    const diffHours = (expires - created) / (1000 * 60 * 60);
    expect(diffHours).toBe(48);
  });

  it("sets correct role and metadata", () => {
    const invite = system.generateInvite("co-parent", "Maya", "TestFamily", "mgr-1");
    expect(invite.role).toBe("co-parent");
    expect(invite.childName).toBe("Maya");
    expect(invite.familyId).toBe("TestFamily");
    expect(invite.createdBy).toBe("mgr-1");
    expect(invite.used).toBe(false);
  });
});

describe("InviteSystem.validateInvite", () => {
  function createTestInvite(overrides: Partial<Invite> = {}): Invite {
    const now = new Date();
    return {
      code: "MAYA-GIFT-AB12",
      role: "family",
      childName: "Maya",
      familyId: "test",
      createdBy: "mgr",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
      used: false,
      ...overrides,
    };
  }

  it("validates a valid invite", () => {
    const invite = createTestInvite();
    const result = system.validateInvite("MAYA-GIFT-AB12", [invite]);
    expect(result).not.toBeNull();
    expect(result?.code).toBe("MAYA-GIFT-AB12");
  });

  it("returns null for unknown code", () => {
    const invite = createTestInvite();
    const result = system.validateInvite("FAKE-CODE-XXXX", [invite]);
    expect(result).toBeNull();
  });

  it("returns null for used invite", () => {
    const invite = createTestInvite({ used: true });
    const result = system.validateInvite("MAYA-GIFT-AB12", [invite]);
    expect(result).toBeNull();
  });

  it("returns null for expired invite", () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    const invite = createTestInvite({ expiresAt: expired });
    const result = system.validateInvite("MAYA-GIFT-AB12", [invite]);
    expect(result).toBeNull();
  });

  it("normalizes code to uppercase", () => {
    const invite = createTestInvite();
    const result = system.validateInvite("maya-gift-ab12", [invite]);
    expect(result).not.toBeNull();
  });

  it("trims whitespace from code", () => {
    const invite = createTestInvite();
    const result = system.validateInvite("  MAYA-GIFT-AB12  ", [invite]);
    expect(result).not.toBeNull();
  });
});
