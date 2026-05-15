/**
 * Sprint 3.0.6 — `policy-view-filter` test suite.
 *
 *  - W3 (PV-H1..PV-H5): `hydrateDestinations` provenance tagging.
 *  - W5 (PV-M*, PV-CHILDNAME*, PV-WALLETS*): `filterPolicyForRole` matrix —
 *    added once the helper exists.
 *
 * No StateManager needed here; helpers are pure functions operating on
 * FamilyConfig + Member objects.
 */
import { describe, it, expect } from "vitest";
import {
  hydrateDestinations,
  filterPolicyForRole,
  type FilterFailure,
  type Section,
} from "../src/middleware/policy-view-filter.js";
import type { FamilyConfig, Member, LearningGoal } from "../src/schemas.js";
import { ROLES, USDC } from "../src/constants.js";
import type { Role } from "../src/constants.js";

const NOW = "2026-05-15T10:00:00.000Z";

function buildFamily(opts: {
  authorizedDestinations: string[];
  children?: Array<{ name: string; walletAddress?: string }>;
}): FamilyConfig {
  return {
    familyId: "f0000000-0000-0000-0000-000000000001",
    familyName: "Garcia",
    children: (opts.children ?? []).map((c) => ({
      name: c.name,
      walletName: `child-${c.name.toLowerCase()}`,
      walletAddress: c.walletAddress,
      weeklyBudget: 15_000_000,
      categories: [{ name: "education", pct: 100, budget: 15_000_000 }],
      savingsPercent: 20,
      savingsLockDays: 90,
    })),
    createdAt: NOW,
    updatedAt: NOW,
    chainId: "eip155:84532",
    usdcAddress: USDC.BASE_SEPOLIA,
    authorizedDestinations: opts.authorizedDestinations,
    policyVersion: 1,
  };
}

function manager(walletAddress?: string): Member {
  return {
    id: `m-${walletAddress ?? "no-addr"}`,
    name: "Manager",
    role: ROLES.MANAGER,
    walletAddress: walletAddress?.toLowerCase(),
    joinedAt: NOW,
    active: true,
  };
}

const MANAGER_WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND_MANAGER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CHILD_AIDEN = "0xcccccccccccccccccccccccccccccccccccccccc";
const CHILD_MAYA = "0xdddddddddddddddddddddddddddddddddddddddd";
const CUSTOM_ADDR = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

describe("Sprint 3.0.6 — hydrateDestinations (W3)", () => {
  it("PV-H1: manager wallet only, no children configured — labels manager-wallet/force-added", () => {
    const family = buildFamily({
      authorizedDestinations: [MANAGER_WALLET],
      children: [],
    });
    const result = hydrateDestinations(family, [manager(MANAGER_WALLET)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      address: MANAGER_WALLET,
      label: "manager-wallet",
      source: "force-added",
    });
  });

  it("PV-H2: manager + 2 BYO children, no custom — all three force-added with correct labels", () => {
    const family = buildFamily({
      authorizedDestinations: [MANAGER_WALLET, CHILD_AIDEN, CHILD_MAYA],
      children: [
        { name: "Aiden", walletAddress: CHILD_AIDEN },
        { name: "Maya", walletAddress: CHILD_MAYA },
      ],
    });
    const result = hydrateDestinations(family, [manager(MANAGER_WALLET)]);
    expect(result).toEqual([
      {
        address: MANAGER_WALLET,
        label: "manager-wallet",
        source: "force-added",
      },
      { address: CHILD_AIDEN, label: "child:Aiden", source: "force-added" },
      { address: CHILD_MAYA, label: "child:Maya", source: "force-added" },
    ]);
  });

  it("PV-H3: manager + 1 BYO child + 1 custom configured address — splits force-added vs configured", () => {
    const family = buildFamily({
      authorizedDestinations: [MANAGER_WALLET, CHILD_AIDEN, CUSTOM_ADDR],
      children: [{ name: "Aiden", walletAddress: CHILD_AIDEN }],
    });
    const result = hydrateDestinations(family, [manager(MANAGER_WALLET)]);
    expect(result).toEqual([
      {
        address: MANAGER_WALLET,
        label: "manager-wallet",
        source: "force-added",
      },
      { address: CHILD_AIDEN, label: "child:Aiden", source: "force-added" },
      { address: CUSTOM_ADDR, label: "custom", source: "configured" },
    ]);
  });

  it("PV-H4: multiple managers (legacy promoted co-parent) — every manager wallet matched", () => {
    const family = buildFamily({
      authorizedDestinations: [MANAGER_WALLET, SECOND_MANAGER],
      children: [],
    });
    const result = hydrateDestinations(family, [
      manager(MANAGER_WALLET),
      manager(SECOND_MANAGER),
    ]);
    expect(result).toEqual([
      {
        address: MANAGER_WALLET,
        label: "manager-wallet",
        source: "force-added",
      },
      {
        address: SECOND_MANAGER,
        label: "manager-wallet",
        source: "force-added",
      },
    ]);
  });

  it("PV-H5: address matching is case-insensitive (mixed-case input, lowercase allowlist)", () => {
    // Allowlist persists lowercase per Sprint 3.0.2. The helper compares
    // against lowercased force-added set; the Manager/Child record can
    // carry mixed-case input (e.g., from a SIWE-verified wallet) without
    // breaking the label match.
    const MIXED_CASE_MANAGER = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
    const family = buildFamily({
      authorizedDestinations: [MANAGER_WALLET], // already lowercase on disk
      children: [],
    });
    const result = hydrateDestinations(family, [manager(MIXED_CASE_MANAGER)]);
    expect(result).toEqual([
      {
        address: MANAGER_WALLET,
        label: "manager-wallet",
        source: "force-added",
      },
    ]);
  });
});

// ============================================================================
// W5 — `filterPolicyForRole` 5×4 access-control matrix
// ============================================================================

const AIDEN = "Aiden";
const MAYA = "Maya";

/**
 * Standard test fixture for matrix tests: two children with BYO wallets,
 * each with a learning goal, plus a Manager wallet and a custom address
 * in the allowlist.
 */
function matrixFixture(): {
  family: FamilyConfig;
  hydrated: ReturnType<typeof hydrateDestinations>;
} {
  const aidenGoals: LearningGoal[] = [
    {
      topic: "Fractions",
      category: "education",
      completed: false,
    },
  ];
  const mayaGoals: LearningGoal[] = [
    {
      topic: "Phonics",
      category: "education",
      completed: false,
    },
  ];
  const family = buildFamily({
    authorizedDestinations: [
      MANAGER_WALLET,
      CHILD_AIDEN,
      CHILD_MAYA,
      CUSTOM_ADDR,
    ],
    children: [
      { name: AIDEN, walletAddress: CHILD_AIDEN },
      { name: MAYA, walletAddress: CHILD_MAYA },
    ],
  });
  family.children[0]!.learningGoals = aidenGoals;
  family.children[1]!.learningGoals = mayaGoals;
  const hydrated = hydrateDestinations(family, [manager(MANAGER_WALLET)]);
  return { family, hydrated };
}

/**
 * Concrete sections (excluding "all" — the matrix tests 4 specific sections
 * per cell; "all" is exercised by the W4 happy-path suite and the
 * composition smoke below).
 */
const CONCRETE_SECTIONS: Array<Exclude<Section, "all">> = [
  "summary",
  "children",
  "destinations",
  "learning-goals",
];

const ALL_ROLES: Role[] = [
  ROLES.MANAGER,
  ROLES.CO_PARENT,
  ROLES.ADVISOR,
  ROLES.FAMILY,
  ROLES.LEARNER,
];

/**
 * 5×4 access-control matrix. Each cell maps `[role, section]` → expected
 * outcome shape. `INSUFFICIENT_ROLE` for forbidden cells (only the
 * destinations column has explicit denials in v1); every other cell is
 * `allowed` with role-specific stripping checked separately below.
 */
const FORBIDDEN_CELLS: Array<[Role, Exclude<Section, "all">]> = [
  [ROLES.FAMILY, "destinations"],
  [ROLES.LEARNER, "destinations"],
];

function isForbidden(role: Role, section: Section): boolean {
  return FORBIDDEN_CELLS.some(([r, s]) => r === role && s === section);
}

describe("Sprint 3.0.6 — filterPolicyForRole 5×4 access matrix (W5)", () => {
  // PV-M-FORBIDDEN — explicit denial cells.
  describe("PV-M-FORBIDDEN: cells that return INSUFFICIENT_ROLE", () => {
    it.each(FORBIDDEN_CELLS)(
      "PV-M-%s-%s: returns INSUFFICIENT_ROLE with requestedSection",
      (role, section) => {
        const { family, hydrated } = matrixFixture();
        const result = filterPolicyForRole(family, hydrated, {
          section,
          includeWallets: true,
          callerRole: role,
          callerChildName: role === ROLES.LEARNER ? AIDEN : undefined,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBe("INSUFFICIENT_ROLE");
        expect(result.requestedSection).toBe(section);
      }
    );
  });

  // PV-M-ALLOWED — every (role, section) cell that is NOT in FORBIDDEN_CELLS.
  // Asserts the cell returns ok=true and the structural shape matches the
  // role's policy (wallets, child scope, destination visibility).
  describe("PV-M-ALLOWED: cells that return populated filtered shapes", () => {
    const allowedCells: Array<[Role, Exclude<Section, "all">]> = [];
    for (const role of ALL_ROLES) {
      for (const section of CONCRETE_SECTIONS) {
        if (!isForbidden(role, section)) {
          allowedCells.push([role, section]);
        }
      }
    }
    // Sanity check: 5 roles × 4 sections − 2 forbidden = 18 allowed cells.
    if (allowedCells.length !== 18) {
      throw new Error(
        `expected 18 allowed cells, got ${allowedCells.length} (matrix drift)`
      );
    }

    it.each(allowedCells)(
      "PV-M-%s-%s: returns ok=true with role-correct stripping",
      (role, section) => {
        const { family, hydrated } = matrixFixture();
        const result = filterPolicyForRole(family, hydrated, {
          section,
          includeWallets: true,
          callerRole: role,
          callerChildName: role === ROLES.LEARNER ? AIDEN : undefined,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const walletsExpected =
          role === ROLES.MANAGER || role === ROLES.CO_PARENT
            ? "visible"
            : "stripped";
        expect(result.effective.wallets).toBe(walletsExpected);

        const destinationsExpected =
          role === ROLES.MANAGER ||
          role === ROLES.CO_PARENT ||
          role === ROLES.ADVISOR;
        expect(result.effective.destinationsVisible).toBe(destinationsExpected);

        // Section-presence check: destinations array populated only when
        // the section requests it AND role allows it.
        if (section === "destinations") {
          // Already filtered out by FORBIDDEN_CELLS for family/learner.
          expect(result.destinations.length).toBeGreaterThan(0);
        } else if (section === "summary") {
          expect(result.children).toEqual([]);
          expect(result.destinations).toEqual([]);
        } else if (section === "children" || section === "learning-goals") {
          // Learners narrow children to own; others see both.
          if (role === ROLES.LEARNER) {
            expect(result.children.map((c) => c.name)).toEqual([AIDEN]);
          } else {
            expect(result.children.map((c) => c.name)).toEqual([AIDEN, MAYA]);
          }
          expect(result.destinations).toEqual([]);
        }
      }
    );
  });

  // ── childName scoping edge cases ─────────────────────────────────────────

  describe("PV-CHILDNAME: childName arg scoping", () => {
    it("PV-CHILDNAME1: Manager + childName='ghost' → CHILD_NOT_FOUND with validChildNames listing real children", () => {
      const { family, hydrated } = matrixFixture();
      const result = filterPolicyForRole(family, hydrated, {
        section: "children",
        childName: "Ghost",
        includeWallets: true,
        callerRole: ROLES.MANAGER,
      });
      expect(result.ok).toBe(false);
      const failure = result as FilterFailure;
      expect(failure.error).toBe("CHILD_NOT_FOUND");
      expect(failure.validChildNames).toEqual([AIDEN, MAYA]);
    });

    it("PV-CHILDNAME2: Learner + childName='ghost' → CHILD_NOT_FOUND with NO validChildNames", () => {
      const { family, hydrated } = matrixFixture();
      const result = filterPolicyForRole(family, hydrated, {
        section: "children",
        childName: "Ghost",
        includeWallets: true,
        callerRole: ROLES.LEARNER,
        callerChildName: AIDEN,
      });
      expect(result.ok).toBe(false);
      const failure = result as FilterFailure;
      expect(failure.error).toBe("CHILD_NOT_FOUND");
      expect(failure.validChildNames).toBeUndefined();
    });

    it("PV-CHILDNAME3: Learner + childName=own → success, sees only own record", () => {
      const { family, hydrated } = matrixFixture();
      const result = filterPolicyForRole(family, hydrated, {
        section: "children",
        childName: AIDEN,
        includeWallets: true,
        callerRole: ROLES.LEARNER,
        callerChildName: AIDEN,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.children).toHaveLength(1);
      expect(result.children[0]!.name).toBe(AIDEN);
    });

    it("PV-CHILDNAME4: Learner + childName=sibling → CHILD_NOT_FOUND with NO validChildNames (sibling enumeration blocked)", () => {
      const { family, hydrated } = matrixFixture();
      const result = filterPolicyForRole(family, hydrated, {
        section: "children",
        childName: MAYA, // sibling — Maya is a real child but not the learner's
        includeWallets: true,
        callerRole: ROLES.LEARNER,
        callerChildName: AIDEN,
      });
      expect(result.ok).toBe(false);
      const failure = result as FilterFailure;
      expect(failure.error).toBe("CHILD_NOT_FOUND");
      // Critical: identical shape to PV-CHILDNAME2 (ghost name) so callers
      // can't distinguish "real sibling I can't see" from "made-up name".
      expect(failure.validChildNames).toBeUndefined();
    });
  });

  // ── Wallet redaction precedence ──────────────────────────────────────────

  describe("PV-WALLETS: role policy wins over client includeWallets preference", () => {
    it("PV-WALLETS1: Advisor + includeWallets=true → wallets STILL stripped (role precedence)", () => {
      const { family, hydrated } = matrixFixture();
      const result = filterPolicyForRole(family, hydrated, {
        section: "children",
        includeWallets: true,
        callerRole: ROLES.ADVISOR,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.effective.wallets).toBe("stripped");
      for (const child of result.children) {
        expect(child.walletAddress).toBeUndefined();
      }
    });

    it("PV-WALLETS2: Family + includeWallets=true → wallets STILL stripped (matrix-data row, not gated by tool access)", () => {
      const { family, hydrated } = matrixFixture();
      const result = filterPolicyForRole(family, hydrated, {
        section: "children",
        includeWallets: true,
        callerRole: ROLES.FAMILY,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.effective.wallets).toBe("stripped");
      for (const child of result.children) {
        expect(child.walletAddress).toBeUndefined();
      }
    });

    it("PV-WALLETS3: Manager + includeWallets=false → wallets stripped (client preference honored when role allows)", () => {
      const { family, hydrated } = matrixFixture();
      const result = filterPolicyForRole(family, hydrated, {
        section: "children",
        includeWallets: false,
        callerRole: ROLES.MANAGER,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.effective.wallets).toBe("stripped");
      for (const child of result.children) {
        expect(child.walletAddress).toBeUndefined();
      }
    });
  });
});
