/**
 * Sprint 3.0.6 — `view-policy` MCP tool.
 *
 * Read counterpart to `configure-policy`. Returns the persisted family
 * policy with destination provenance tagging, role-aware filtering, and
 * the new `policyVersion` counter. Read-only by construction — no
 * state mutation, no audit-log entries.
 *
 * Response shape (mirrored for populated AND empty-policy families):
 *
 *   {
 *     success: true,
 *     policyVersion: number,
 *     familyName: string,
 *     network: string,
 *     children: ChildView[],
 *     authorizedDestinations: HydratedDestination[],
 *     summary: { childCount, totalWeeklyBudgetUsd, destinationCount,
 *                learningGoalCount, activeGoalCount },
 *     updatedAt: string,    // ISO-8601 or "" for empty shell
 *     message: string,
 *   }
 *
 * Error states (reserved — see C3/C6/C7):
 *   - INSUFFICIENT_ROLE  — caller's role can't access the requested section
 *   - CHILD_NOT_FOUND    — `childName` filter matches no visible child
 *   - FAMILY_NOT_FOUND   — structural break (authenticated caller, but no
 *                          family record on disk). Distinct from the empty
 *                          shell (success-shaped).
 *
 * Sprint 3.0.6 workstream wiring:
 *   - W4 ships the Manager happy path.
 *   - W5 layers in `filterPolicyForRole` for the 5x4 access-control matrix.
 *   - W6 adds the cache + synchronous write-invalidation.
 *   - W7 (already done in W4 for cohesion) expands `ROLE_TOOL_ACCESS` to
 *     Manager + Co-parent + Advisor; Family + Learner denied at the gate.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import { USDC, CHAIN_IDS, ROLES } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  type ToolResponse,
  type CallerContext,
  rbacFields,
} from "../middleware/access-control.js";
import {
  hydrateDestinations,
  filterPolicyForRole,
  type HydratedDestination,
} from "../middleware/policy-view-filter.js";
import { policyCache } from "../cache/policy-cache.js";
import type {
  FamilyConfig,
  ChildConfig,
  LearningGoal,
} from "../schemas.js";

const SECTION_VALUES = [
  "all",
  "summary",
  "children",
  "destinations",
  "learning-goals",
] as const;
type Section = (typeof SECTION_VALUES)[number];

export interface ChildView {
  name: string;
  walletAddress?: string;
  weeklyBudgetUsd: number;
  categories: Array<{ name: string; pct: number; budgetUsd: number }>;
  savingsPercent: number;
  savingsLockDays: number;
  learningGoals: Array<{
    topic: string;
    category: string;
    completed: boolean;
    subgoals?: Array<{ topic: string; completed: boolean }>;
    deadline?: string;
  }>;
}

export interface PolicySummary {
  childCount: number;
  totalWeeklyBudgetUsd: number;
  destinationCount: number;
  learningGoalCount: number;
  activeGoalCount: number;
}

export interface ViewPolicySuccess {
  success: true;
  policyVersion: number;
  familyName: string;
  network: string;
  children: ChildView[];
  authorizedDestinations: HydratedDestination[];
  summary: PolicySummary;
  updatedAt: string;
  message: string;
}

export interface ViewPolicyFailure {
  success: false;
  error: string;
  kind?: "INSUFFICIENT_ROLE" | "CHILD_NOT_FOUND" | "FAMILY_NOT_FOUND";
  role?: string;
  requestedSection?: Section;
  validChildNames?: string[];
}

/**
 * Inner handler for `view-policy`. Exported separately from
 * `registerViewPolicyTool` so tests can invoke it without going through
 * the McpServer transport. `withAccessControl` is applied during
 * registration; tests that exercise the auth gate should call
 * `withAccessControl("view-policy", viewPolicyHandler)({...args})` directly.
 *
 * `caller` is non-null by construction (view-policy is NOT in
 * `UNIDENTIFIED_CALLER_TOOLS`), but we accept null and degrade to the
 * standard no-identity response for defensive coding.
 */
export async function viewPolicyHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("view-policy");

  const section = (args.section as Section | undefined) ?? "all";
  const childName = args.childName as string | undefined;
  const includeWallets = (args.includeWallets as boolean | undefined) ?? true;

  try {
    const state = new StateManager();

    // Sprint 3.0.6 W6 — cache lookup. On miss, fall through to disk and
    // populate the cache for subsequent calls (60s TTL). Writes invalidate
    // synchronously inside `configureFamilyCore` so a stale read is
    // impossible inside the single-process window (PC4 locks this).
    let family = policyCache.get(caller.familyId);
    if (!family) {
      const loaded = await state.loadFamilyConfig(caller.familyId);
      if (loaded) {
        policyCache.set(caller.familyId, loaded);
        family = loaded;
      }
    }

    if (!family) {
      return jsonResponse(buildEmptyShell());
    }

    const allMembers = await state.loadMembers(caller.familyId);
    const managers = allMembers.filter((m) => m.role === ROLES.MANAGER);
    const hydrated = hydrateDestinations(family, managers);

    // W5 — apply the 5×4 access-control matrix via the filter helper.
    // Enforces section-level gating (INSUFFICIENT_ROLE for forbidden cells),
    // child scoping (learner own-record only, sibling enumeration blocked),
    // and wallet stripping with role precedence over `includeWallets`.
    const filtered = filterPolicyForRole(family, hydrated, {
      section,
      childName,
      includeWallets,
      callerRole: caller.role,
      callerChildName: caller.childName,
    });

    if (!filtered.ok) {
      const failure: ViewPolicyFailure = {
        success: false,
        error:
          filtered.error === "INSUFFICIENT_ROLE"
            ? `Role "${caller.role}" cannot view section "${filtered.requestedSection}".`
            : childName
              ? `Child "${childName}" not found in this family.`
              : "Caller has no visible children.",
        kind: filtered.error,
        role: caller.role,
      };
      if (filtered.requestedSection !== undefined) {
        failure.requestedSection = filtered.requestedSection;
      }
      if (filtered.validChildNames !== undefined) {
        failure.validChildNames = filtered.validChildNames;
      }
      return jsonResponse(failure);
    }

    const childrenView = filtered.children.map((c) =>
      buildChildView(c, filtered.effective.wallets === "visible")
    );

    const summary = buildSummary(family);
    const network = networkLabel(family);

    const response: ViewPolicySuccess = {
      success: true,
      policyVersion: family.policyVersion,
      familyName: family.familyName,
      network,
      children: childrenView,
      authorizedDestinations: filtered.destinations,
      summary,
      updatedAt: family.updatedAt,
      message: buildMessage(family, summary, section),
    };

    // Learning-goals slice projects only the goal-relevant fields onto
    // children entries so the section intent is structurally explicit.
    if (section === "learning-goals") {
      response.children = childrenView.map((c) => ({
        ...c,
        walletAddress: undefined,
        categories: [],
        weeklyBudgetUsd: 0,
        savingsPercent: 0,
        savingsLockDays: 0,
      }));
    }

    return jsonResponse(response);
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function registerViewPolicyTool(server: McpServer): void {
  server.tool(
    "view-policy",
    "Read the current family policy — children, categories, savings, learning goals, " +
      "authorized destinations, and a summary. Read-only; no mutations.",
    {
      section: z
        .enum(SECTION_VALUES)
        .default("all")
        .describe(
          "Which slice to return. 'all' returns every section (default)."
        ),
      childName: z
        .string()
        .optional()
        .describe(
          "Filter children + learning-goals to one child (case-insensitive)."
        ),
      includeWallets: z
        .boolean()
        .default(true)
        .describe(
          "Strip `children[].walletAddress` when false. Does not affect " +
            "`authorizedDestinations`."
        ),
      ...rbacFields,
    },
    withAccessControl("view-policy", viewPolicyHandler)
  );
}

function jsonResponse(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function buildEmptyShell(): ViewPolicySuccess {
  return {
    success: true,
    policyVersion: 0,
    familyName: "",
    network: "",
    children: [],
    authorizedDestinations: [],
    summary: {
      childCount: 0,
      totalWeeklyBudgetUsd: 0,
      destinationCount: 0,
      learningGoalCount: 0,
      activeGoalCount: 0,
    },
    updatedAt: "",
    message: "No policy configured yet. Call configure-policy to set one up.",
  };
}

function buildChildView(c: ChildConfig, includeWallets: boolean): ChildView {
  return {
    name: c.name,
    walletAddress: includeWallets ? c.walletAddress : undefined,
    weeklyBudgetUsd: c.weeklyBudget / 10 ** USDC.DECIMALS,
    categories: (c.categories ?? []).map((cat) => ({
      name: cat.name,
      pct: cat.pct,
      budgetUsd: cat.budget / 10 ** USDC.DECIMALS,
    })),
    savingsPercent: c.savingsPercent,
    savingsLockDays: c.savingsLockDays,
    learningGoals: (c.learningGoals ?? []).map((g) => ({
      topic: g.topic,
      category: g.category,
      completed: g.completed,
      subgoals: g.subgoals?.map((sg) => ({
        topic: sg.topic,
        completed: sg.completed,
      })),
      deadline: g.deadline,
    })),
  };
}

function buildSummary(family: FamilyConfig): PolicySummary {
  // Summary always describes the FULL policy from the caller's role
  // perspective — section filter does not shrink it. Locks the design
  // intent so callers can show "you're seeing 1 of N kids" without an
  // extra round-trip.
  const allChildren = family.children;
  const totalWeeklyMicroUsdc = allChildren.reduce(
    (sum, c) => sum + c.weeklyBudget,
    0
  );
  const allGoals: LearningGoal[] = allChildren.flatMap(
    (c) => c.learningGoals ?? []
  );
  return {
    childCount: allChildren.length,
    totalWeeklyBudgetUsd: totalWeeklyMicroUsdc / 10 ** USDC.DECIMALS,
    destinationCount: family.authorizedDestinations.length,
    learningGoalCount: allGoals.length,
    activeGoalCount: allGoals.filter((g) => !g.completed).length,
  };
}

function networkLabel(family: FamilyConfig): string {
  if (family.chainId === CHAIN_IDS.BASE_SEPOLIA) return "Base Sepolia (testnet)";
  if (family.chainId === CHAIN_IDS.BASE_MAINNET) return "Base (mainnet)";
  return family.chainId;
}

function buildMessage(
  family: FamilyConfig,
  summary: PolicySummary,
  section: Section
): string {
  if (summary.childCount === 0) {
    return `Family "${family.familyName}" has no children configured yet.`;
  }
  const childList = family.children.map((c) => c.name).join(", ");
  if (section === "summary") {
    return (
      `Family "${family.familyName}" — ${summary.childCount} ` +
      `${summary.childCount === 1 ? "child" : "children"} (${childList}), ` +
      `$${summary.totalWeeklyBudgetUsd.toFixed(2)}/week total, ` +
      `${summary.destinationCount} authorized destinations.`
    );
  }
  return (
    `Policy for "${family.familyName}": ${summary.childCount} ` +
    `${summary.childCount === 1 ? "child" : "children"} (${childList}). ` +
    `Use section="summary" for the headline, or filter by childName.`
  );
}
