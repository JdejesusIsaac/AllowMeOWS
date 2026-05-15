/**
 * Sprint 3.0.6 — `view-policy` filter and provenance helpers.
 *
 * Two responsibilities:
 *
 *  1. `hydrateDestinations` — tag each entry of `FamilyConfig.authorizedDestinations`
 *     with a provenance label (`manager-wallet | child:<name> | custom`) and a
 *     source discriminator (`force-added | configured`). Read-side only;
 *     no storage change. Inverts `buildAuthorizedDestinations` from
 *     `src/core/configure-family.ts`.
 *
 *  2. (W5) `filterPolicyForRole` — apply the role × section access-control
 *     matrix to a fully-loaded policy, returning either the filtered shape
 *     or `{ error: ... }`. Encoded as data so the matrix is auditable in
 *     one place rather than scattered across nested switches.
 */

import type { FamilyConfig, Member, ChildConfig } from "../schemas.js";
import type { Role } from "../constants.js";
import { ROLES } from "../constants.js";

export type DestinationSource = "force-added" | "configured";

/**
 * Provenance label for a single allowlist entry.
 *   - "manager-wallet" — matches an active Manager Member's walletAddress
 *   - "child:<name>"   — matches a `family.children[i].walletAddress` (BYO)
 *   - "custom"         — user-supplied address that doesn't match either
 *                        (e.g., a friend's wallet for gifts, a vendor address)
 *
 * OWS-managed child wallets do NOT show up in `family.children[i].walletAddress`
 * (only BYO addresses are persisted there per `src/wallet/setup.ts:196-208`),
 * so they fall into the `custom` bucket if they're explicitly added to the
 * allowlist via the `authorizedDestinations` input. Per Sprint 3.0.2's
 * construction, OWS-managed wallets are NOT auto-added to the allowlist —
 * the allowlist applies to outflows on the child-wallet leg; the OWS leg
 * is exempt by design.
 */
export type DestinationLabel = "manager-wallet" | "custom" | `child:${string}`;

export interface HydratedDestination {
  /** Address as persisted (lowercased per Sprint 3.0.2). */
  address: string;
  label: DestinationLabel;
  source: DestinationSource;
}

/**
 * Tag each `authorizedDestinations` entry with provenance.
 *
 * Force-added set (computed on read):
 *   { all-managers.walletAddress } ∪ { all BYO children.walletAddress }
 *
 * Labelling precedence: child labels win over manager labels when an address
 * appears in both lists (defensive — shouldn't happen in practice). A "custom"
 * entry is anything NOT in the force-added set.
 *
 * Matching is case-insensitive; the returned `address` preserves whatever
 * casing is on disk (`authorizedDestinations` is lowercased per Sprint 3.0.2,
 * so callers can rely on consistent casing).
 */
export function hydrateDestinations(
  family: FamilyConfig,
  managers: Member[]
): HydratedDestination[] {
  const forceAdded = new Map<string, DestinationLabel>();

  // Managers first — child labels overwrite below if they collide.
  for (const m of managers) {
    if (!m.walletAddress) continue;
    forceAdded.set(m.walletAddress.toLowerCase(), "manager-wallet");
  }

  // BYO child wallets — overwrites manager label on collision (defensive).
  for (const child of family.children) {
    if (!child.walletAddress) continue;
    forceAdded.set(
      child.walletAddress.toLowerCase(),
      `child:${child.name}` as DestinationLabel
    );
  }

  return family.authorizedDestinations.map((rawAddr) => {
    const key = rawAddr.toLowerCase();
    const label = forceAdded.get(key);
    if (label !== undefined) {
      return { address: rawAddr, label, source: "force-added" };
    }
    return { address: rawAddr, label: "custom", source: "configured" };
  });
}

// ============================================================================
// W5 — `filterPolicyForRole` access-control matrix
// ============================================================================

export type Section =
  | "all"
  | "summary"
  | "children"
  | "destinations"
  | "learning-goals";

export const SECTION_VALUES: readonly Section[] = [
  "all",
  "summary",
  "children",
  "destinations",
  "learning-goals",
] as const;

/**
 * Per-role visibility policy. Encoded as data so the matrix is auditable
 * in one place — no nested switches across the codebase. Each role has
 * four orthogonal dimensions; the section filter (`all | summary | children
 * | destinations | learning-goals`) gates which dimensions appear in the
 * response, but the dimension-level policy below determines what a role
 * can SEE within each dimension.
 *
 * Sprint 3.0.6 v1 — tight_v1 profile per user-confirmed contract D-OQ1/2/4/5:
 *   - Manager / Co-parent: full visibility across every dimension.
 *   - Advisor: wallets stripped from children (D-OQ1 tight); destinations
 *     and goals visible (audit role needs the data).
 *   - Family: wallets stripped, destinations hidden (D-OQ2 tight). NOTE:
 *     Family is denied at the `withAccessControl` gate in v1 per D-OQ4
 *     tight_v1 — this row exists as matrix data so the future sprint that
 *     adds Family to ROLE_TOOL_ACCESS inherits the decision.
 *   - Learner: own-record only; sibling enumeration impossible. NOTE:
 *     Learner is also denied at the gate in v1; matrix data only.
 */
interface RolePolicy {
  wallets: "visible" | "stripped";
  destinations: "full" | "hidden";
  childScope: "all" | "own";
  goalScope: "all" | "own";
}

const ROLE_POLICY: Record<Role, RolePolicy> = {
  [ROLES.MANAGER]: {
    wallets: "visible",
    destinations: "full",
    childScope: "all",
    goalScope: "all",
  },
  [ROLES.CO_PARENT]: {
    wallets: "visible",
    destinations: "full",
    childScope: "all",
    goalScope: "all",
  },
  [ROLES.ADVISOR]: {
    wallets: "stripped",
    destinations: "full",
    childScope: "all",
    goalScope: "all",
  },
  [ROLES.FAMILY]: {
    wallets: "stripped",
    destinations: "hidden",
    childScope: "all",
    goalScope: "all",
  },
  [ROLES.LEARNER]: {
    wallets: "stripped",
    destinations: "hidden",
    childScope: "own",
    goalScope: "own",
  },
};

/**
 * Read access to a role's policy. Exported so callers (and tests) can
 * introspect the matrix without poking at the private constant.
 */
export function getRolePolicy(role: Role): RolePolicy {
  return ROLE_POLICY[role];
}

export type FilterErrorKind = "INSUFFICIENT_ROLE" | "CHILD_NOT_FOUND";

export interface FilterArgs {
  section: Section;
  childName?: string;
  /** Client preference for showing children[].walletAddress. Role policy
   * wins — if `wallets: "stripped"`, walletAddress is ALWAYS undefined
   * regardless of this flag (per contract C8). */
  includeWallets: boolean;
  /** Caller's role + identity. childName scoping for learners uses
   *  `caller.childName`. */
  callerRole: Role;
  callerChildName?: string;
}

export interface FilterSuccess {
  ok: true;
  /** Filtered children, possibly scoped by role + childName. May be empty
   *  if section excludes children. Wallet field stripped per role policy. */
  children: ChildConfig[];
  /** Filtered destinations. Empty array if section excludes destinations
   *  OR role policy hides them. */
  destinations: HydratedDestination[];
  /** Effective values used (callers can introspect for debugging). */
  effective: {
    wallets: RolePolicy["wallets"];
    destinationsVisible: boolean;
    childrenSection: boolean;
    summarySection: boolean;
    goalsSection: boolean;
  };
}

export interface FilterFailure {
  ok: false;
  error: FilterErrorKind;
  /** For INSUFFICIENT_ROLE: the requested section that's forbidden. */
  requestedSection?: Section;
  /** For CHILD_NOT_FOUND with Manager/Co-parent/Advisor/Family roles ONLY:
   *  the visible-child names. NEVER populated for Learner — that would leak
   *  sibling existence (contract C7). */
  validChildNames?: string[];
}

export type FilterResult = FilterSuccess | FilterFailure;

/**
 * Apply role + section filters to a fully-loaded policy. Returns either a
 * filtered shape (children + destinations narrowed per matrix rules) OR a
 * structured error.
 *
 * NOTE: this helper assumes the caller has already passed the tool-level
 * RBAC gate (`withAccessControl`). It performs SECTION-level and FIELD-
 * level filtering only. The caller is responsible for tool-level access.
 *
 * Matrix logic (contract C6):
 *   - Section "destinations" + role.destinations === "hidden" → INSUFFICIENT_ROLE
 *   - childName provided + no match in visible children:
 *       Learner role  → CHILD_NOT_FOUND with NO validChildNames (C7)
 *       Other roles   → CHILD_NOT_FOUND WITH validChildNames (the names
 *                       the caller could ask for instead)
 *   - Otherwise: success with role-appropriate stripping applied.
 */
export function filterPolicyForRole(
  family: FamilyConfig,
  hydrated: HydratedDestination[],
  args: FilterArgs
): FilterResult {
  const rolePolicy = ROLE_POLICY[args.callerRole];
  const section = args.section;

  // ── Section-level forbidden cells ──────────────────────────────────────
  // Only "destinations" gates explicitly today. Other sections degrade to
  // empty/scoped content rather than erroring — "all" is the most permissive.
  if (section === "destinations" && rolePolicy.destinations === "hidden") {
    return {
      ok: false,
      error: "INSUFFICIENT_ROLE",
      requestedSection: section,
    };
  }

  // ── Child scope (role-level) ───────────────────────────────────────────
  // For learners: narrow to their bound child FIRST (caller.childName).
  // For everyone else: full children visible.
  let scopedChildren: ChildConfig[];
  if (rolePolicy.childScope === "own") {
    if (!args.callerChildName) {
      // A learner without a bound childName is a config error. Return as
      // CHILD_NOT_FOUND (no validChildNames — same shape as sibling-block).
      return { ok: false, error: "CHILD_NOT_FOUND" };
    }
    scopedChildren = family.children.filter(
      (c) => c.name.toLowerCase() === args.callerChildName!.toLowerCase()
    );
  } else {
    scopedChildren = family.children;
  }

  // ── childName arg filter ───────────────────────────────────────────────
  if (args.childName !== undefined) {
    const matched = scopedChildren.filter(
      (c) => c.name.toLowerCase() === args.childName!.toLowerCase()
    );
    if (matched.length === 0) {
      // Sibling-enumeration block (contract C7):
      //   - Learner: NO validChildNames (identical shape whether the name
      //     refers to a real sibling or a fake one).
      //   - Other roles: list the names they could have asked for.
      const failure: FilterFailure = {
        ok: false,
        error: "CHILD_NOT_FOUND",
      };
      if (rolePolicy.childScope === "all") {
        failure.validChildNames = scopedChildren.map((c) => c.name);
      }
      return failure;
    }
    scopedChildren = matched;
  }

  // ── Wallet stripping ───────────────────────────────────────────────────
  // Role policy `wallets: "stripped"` wins over client `includeWallets`
  // preference (contract C8). The advisor / family / learner can NEVER see
  // children[].walletAddress, regardless of what the client asked for.
  const effectiveWallets =
    rolePolicy.wallets === "stripped" || !args.includeWallets
      ? "stripped"
      : "visible";

  const filteredChildren = scopedChildren.map<ChildConfig>((c) => {
    const out: ChildConfig = { ...c };
    if (effectiveWallets === "stripped") {
      out.walletAddress = undefined;
    }
    // Goal scope: learner sees own goals only (already narrowed by
    // childScope). Non-learners pass goals through unchanged here. (Goals
    // are bound to a child, so child-narrowing IS goal-narrowing for the
    // learner case.)
    return out;
  });

  // ── Destinations visibility ────────────────────────────────────────────
  const destinationsVisible = rolePolicy.destinations === "full";
  const includeDestinationsInResponse =
    destinationsVisible && (section === "all" || section === "destinations");
  const destinations: HydratedDestination[] = includeDestinationsInResponse
    ? hydrated
    : [];

  // ── Children visibility (section gating) ──────────────────────────────
  // section="summary" or "destinations" → children array is empty.
  // section="learning-goals" → children stay populated; caller projects.
  const includeChildrenInResponse =
    section === "all" || section === "children" || section === "learning-goals";
  const childrenForResponse: ChildConfig[] = includeChildrenInResponse
    ? filteredChildren
    : [];

  return {
    ok: true,
    children: childrenForResponse,
    destinations,
    effective: {
      wallets: effectiveWallets,
      destinationsVisible,
      childrenSection: includeChildrenInResponse,
      summarySection: section === "all" || section === "summary",
      goalsSection:
        section === "all" || section === "learning-goals" || section === "children",
    },
  };
}

