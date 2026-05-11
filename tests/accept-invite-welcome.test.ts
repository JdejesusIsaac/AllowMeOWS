/**
 * Sprint 3.0.4 — `buildWelcomeMessage` role-flavored welcome copy tests.
 *
 * Strategy: unit-test the pure helper exported from `src/core/accept-invite.ts`.
 * Same pattern as `tests/check-goals.test.ts` (`buildCheckGoalsSummary`) —
 * exercises the branchy per-role copy in isolation without spinning up state,
 * vaults, or the MCP server.
 *
 * Coverage:
 *   - AW1: Learner greeting uses "Hi {name}!" (softer register for kid)
 *   - AW2: Non-learner roles greet with "Welcome, {name}."
 *   - AW3: Learner welcome includes the goal-discovery hint (the gap that
 *          motivated this sprint — kids weren't finding their goals)
 *   - AW4: Family name is embedded verbatim ("the Asencio family economy")
 *   - AW5: Learner childName appears in the role line when provided
 *   - AW6: Each role gets at least one role-specific starter prompt
 *   - AW7: Co-parent welcome surfaces the no-fund-movement RBAC boundary
 *   - AW8: Setup-code TTL note mentions both 48h inline + /verify rotation
 *   - AW9: All welcomes include the 3-step "connect this to your own Claude"
 *          MCP setup instructions
 *   - AW10: All welcomes carry the mcpUrl verbatim (so users can copy it)
 */
import { describe, it, expect } from "vitest";
import { buildWelcomeMessage } from "../src/core/accept-invite.js";

const MCP_URL = "https://allowme.dev/mcp?setup=TEST-CODE-EXAMPLE";

describe("buildWelcomeMessage: greeting register (AW1, AW2)", () => {
  it("AW1: learner role greets with 'Hi {name}!' (kid-friendly register)", () => {
    const msg = buildWelcomeMessage({
      name: "Elina",
      role: "learner",
      childName: "Elina",
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/^Hi Elina!/);
    expect(msg).not.toMatch(/^Welcome,/);
  });

  it("AW2: non-learner roles greet with 'Welcome, {name}.' (formal register)", () => {
    for (const role of ["manager", "co-parent", "family", "advisor"] as const) {
      const msg = buildWelcomeMessage({
        name: "Maria",
        role,
        familyName: "Asencio",
        mcpUrl: MCP_URL,
      });
      expect(msg).toMatch(/^Welcome, Maria\./);
    }
  });
});

describe("buildWelcomeMessage: learner-specific content (AW3, AW5)", () => {
  it("AW3: learner welcome includes the goal-discovery hint", () => {
    const msg = buildWelcomeMessage({
      name: "Elina",
      role: "learner",
      childName: "Elina",
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/what are my goals\?/i);
    expect(msg).toMatch(/best place to start/i);
  });

  it("AW5: learner welcome embeds the childName in the role line", () => {
    const msg = buildWelcomeMessage({
      name: "Elina",
      role: "learner",
      childName: "Elina",
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/connected to the Asencio family economy as Elina/);
  });

  it("AW5b: learner without explicit childName omits the 'as {child}' suffix", () => {
    const msg = buildWelcomeMessage({
      name: "Elina",
      role: "learner",
      // childName intentionally omitted
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/connected to the Asencio family economy\./);
    expect(msg).not.toMatch(/ as undefined/);
  });
});

describe("buildWelcomeMessage: family name embedding (AW4)", () => {
  it("AW4: family name appears verbatim in each role's welcome", () => {
    for (const role of [
      "manager",
      "co-parent",
      "family",
      "advisor",
      "learner",
    ] as const) {
      const msg = buildWelcomeMessage({
        name: "Maria",
        role,
        familyName: "Asencio",
        mcpUrl: MCP_URL,
      });
      expect(msg).toContain("Asencio family economy");
    }
  });

  it("AW4b: missing family name falls back to 'your family economy' (graceful default)", () => {
    // Core passes `familyName ?? "your"` when FamilyConfig is unloadable.
    const msg = buildWelcomeMessage({
      name: "Maria",
      role: "manager",
      familyName: "your",
      mcpUrl: MCP_URL,
    });
    expect(msg).toContain("your family economy");
  });
});

describe("buildWelcomeMessage: starter prompts per role (AW6)", () => {
  it("AW6 learner: includes 'check my savings' and 'how am I doing this week?'", () => {
    const msg = buildWelcomeMessage({
      name: "Elina",
      role: "learner",
      childName: "Elina",
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/check my savings/i);
    expect(msg).toMatch(/how am i doing this week/i);
  });

  it("AW6 manager: includes 'set up allowance' + treasury address prompt", () => {
    const msg = buildWelcomeMessage({
      name: "Maria",
      role: "manager",
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/set up allowance/i);
    expect(msg).toMatch(/treasury address/i);
  });

  it("AW6 co-parent: includes verify-achievement example", () => {
    const msg = buildWelcomeMessage({
      name: "Juan",
      role: "co-parent",
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/verify an achievement/i);
  });

  it("AW6 family: includes gift-fund-address prompt", () => {
    const msg = buildWelcomeMessage({
      name: "Grandma",
      role: "family",
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/gift fund address/i);
  });

  it("AW6 advisor: includes audit-log prompt", () => {
    const msg = buildWelcomeMessage({
      name: "Counsel",
      role: "advisor",
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/audit log/i);
  });
});

describe("buildWelcomeMessage: RBAC boundary copy (AW7)", () => {
  it("AW7: co-parent welcome explicitly surfaces the no-fund-movement boundary", () => {
    const msg = buildWelcomeMessage({
      name: "Juan",
      role: "co-parent",
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/can't move funds/i);
    expect(msg).toMatch(/manager's role/i);
  });
});

describe("buildWelcomeMessage: shared footer (AW8, AW9, AW10)", () => {
  it("AW8: setup-code TTL note mentions 48h inline + /verify 30-day rotation", () => {
    const msg = buildWelcomeMessage({
      name: "Maria",
      role: "manager",
      familyName: "Asencio",
      mcpUrl: MCP_URL,
    });
    expect(msg).toMatch(/48 hours/);
    expect(msg).toMatch(/30-day code/);
    expect(msg).toContain("https://allowme.dev/verify");
  });

  it("AW9: every welcome includes the 3-step MCP setup instructions", () => {
    for (const role of [
      "manager",
      "co-parent",
      "family",
      "advisor",
      "learner",
    ] as const) {
      const msg = buildWelcomeMessage({
        name: "User",
        role,
        familyName: "Asencio",
        mcpUrl: MCP_URL,
      });
      expect(msg).toContain("Open Claude → Settings → Connectors");
      expect(msg).toContain("Paste this URL:");
      expect(msg).toContain("Enable it in your conversation");
    }
  });

  it("AW10: every welcome embeds the mcpUrl verbatim (user must be able to copy it)", () => {
    for (const role of [
      "manager",
      "co-parent",
      "family",
      "advisor",
      "learner",
    ] as const) {
      const msg = buildWelcomeMessage({
        name: "User",
        role,
        familyName: "Asencio",
        mcpUrl: MCP_URL,
      });
      expect(msg).toContain(MCP_URL);
    }
  });
});
