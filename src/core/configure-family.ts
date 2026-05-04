/**
 * Sprint 3.0 v4 — W1.12: extracted `configure-policy` / `configure-family`
 * core domain logic.
 *
 * Both the MCP tool wrapper (`src/tools/configure-policy.ts`) and the HTTP
 * endpoint (`POST /api/configure-family`, W1.8) call into this module. The
 * wrapper handles MCP I/O formatting; this module owns the state mutation,
 * audit log, member-index registration, and setup-code issuance.
 *
 * Design contract:
 *   - Input validation for category-percent sums + learning-goal category
 *     references belongs to the CALLER (both MCP and HTTP validate before
 *     dispatching here). Core assumes inputs are already shaped.
 *   - Core returns plain domain types (`ConfigureFamilyResult`) — no MCP
 *     content wrapper, no HTTP response shape. Callers translate.
 *   - Core never throws for "expected" failures (e.g. unknown familyId in
 *     update path) — it returns `{ ok: false, error }`. Unexpected errors
 *     bubble up and the caller wraps them.
 */

import { randomUUID } from "node:crypto";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
import { WalletSetup } from "../wallet/setup.js";
import { FamilyKeyManager } from "../keys/family-keys.js";
import { MemberIndex } from "../identity/member-index.js";
import { SetupCodeStore } from "../identity/setup-codes.js";
import { ROLES, USDC } from "../constants.js";
import type { FamilyConfig, ChildConfig, Member } from "../schemas.js";
import { mergeLearningGoals } from "../engine/learning-goals.js";
import type { CallerContext } from "../middleware/access-control.js";

export interface ConfigureFamilyInput {
  familyName: string;
  children: ChildConfig[]; // already normalized to 6-decimal USDC units
  chainId: string;
  usdcAddress: string;
  useTestnet: boolean;
  /**
   * Sprint 3.0 v4: when onboarding through the verify page, the
   * SIWE-verified wallet address is threaded onto the new Manager Member
   * record. Undefined for legacy MCP-bootstrap callers (sprint ≤2.9.1).
   */
  managerWalletAddress?: string;
  /**
   * Sprint 3.0 v4: label the freshly-created Manager Member. The verify
   * page can supply the SIWE-verified account's display name; MCP callers
   * fall back to "{familyName} Manager".
   */
  managerName?: string;
}

export interface ConfigureFamilyBootstrapResult {
  ok: true;
  bootstrap: true;
  familyId: string;
  memberId: string;
  setupCode: string;
  mcpUrl: string;
  familyName: string;
  children: ChildConfigSummary[];
}

export interface ConfigureFamilyUpdateResult {
  ok: true;
  bootstrap: false;
  familyId: string;
  familyName: string;
  children: ChildConfigSummary[];
}

export interface ConfigureFamilyFailure {
  ok: false;
  error: string;
}

export type ConfigureFamilyResult =
  | ConfigureFamilyBootstrapResult
  | ConfigureFamilyUpdateResult
  | ConfigureFamilyFailure;

export interface ChildConfigSummary {
  name: string;
  weeklyBudgetUsd: string; // "15.00"
  categories: string; // "reading: $6.00, movement: $5.25"
  savingsPercent: number;
  wallet: string;
}

/**
 * Core entry point. If `caller === null` → bootstrap path (creates a new
 * family + Manager Member). Otherwise → update path on the caller's family.
 */
export async function configureFamilyCore(
  input: ConfigureFamilyInput,
  caller: CallerContext | null
): Promise<ConfigureFamilyResult> {
  if (caller === null) {
    return bootstrapFamily(input);
  }
  return updateExistingFamily(input, caller);
}

async function bootstrapFamily(
  input: ConfigureFamilyInput
): Promise<ConfigureFamilyResult> {
  const state = new StateManager();
  const index = new MemberIndex();
  const setupCodes = new SetupCodeStore();

  const familyId = randomUUID();
  const memberId = randomUUID();
  const now = new Date().toISOString();

  const familyConfig: FamilyConfig = {
    familyId,
    familyName: input.familyName,
    children: input.children,
    createdAt: now,
    updatedAt: now,
    chainId: input.chainId,
    usdcAddress: input.usdcAddress,
  };

  const keyManager = new FamilyKeyManager();
  const familyKey = keyManager.getOrGenerateFamilyKey(familyId);

  await state.createFamilyDir(familyId);
  const setup = new WalletSetup(getFamilyVaultPath(familyId));
  await setup.initializeFamily(familyConfig, familyKey);

  await state.saveFamilyConfig(familyId, familyConfig);
  for (const child of input.children) {
    await state.initializeStreak(familyId, child.name);
  }

  const manager: Member = {
    id: memberId,
    name: input.managerName ?? `${input.familyName} Manager`,
    role: ROLES.MANAGER,
    walletAddress: input.managerWalletAddress?.toLowerCase(),
    joinedAt: now,
    active: true,
  };
  await state.addMember(familyId, manager);
  await index.set(memberId, familyId, ROLES.MANAGER);

  await state.addAuditEntry(familyId, {
    id: randomUUID(),
    timestamp: now,
    action: "configure",
    actor: memberId,
    details: {
      bootstrap: true,
      familyName: input.familyName,
      childCount: input.children.length,
      ...(input.managerWalletAddress
        ? { walletAddress: input.managerWalletAddress.toLowerCase() }
        : {}),
    },
  });

  const setupCode = await setupCodes.issue(memberId);
  const baseUrl = process.env.ALLOWANCE_AGENT_URL || "https://allowme.dev";
  const mcpUrl = `${baseUrl}/mcp?setup=${setupCode}`;

  return {
    ok: true,
    bootstrap: true,
    familyId,
    memberId,
    setupCode,
    mcpUrl,
    familyName: input.familyName,
    children: buildChildrenSummary(input.children),
  };
}

async function updateExistingFamily(
  input: ConfigureFamilyInput,
  caller: CallerContext
): Promise<ConfigureFamilyResult> {
  const state = new StateManager();
  const familyId = caller.familyId;

  const existingConfig = await state.loadFamilyConfig(familyId);

  // Sprint 3.0.1: preserve already-completed learning-goal progress across
  // reconfigures. See `mergeLearningGoals` for the fuzzy-match semantics.
  const mergedChildren: ChildConfig[] = input.children.map((newChild) => {
    if (!newChild.learningGoals || newChild.learningGoals.length === 0) {
      return newChild;
    }
    const oldChild = existingConfig?.children.find(
      (c) => c.name.toLowerCase() === newChild.name.toLowerCase()
    );
    return {
      ...newChild,
      learningGoals: mergeLearningGoals(
        oldChild?.learningGoals,
        newChild.learningGoals
      ),
    };
  });

  const now = new Date().toISOString();
  const familyConfig: FamilyConfig = {
    familyId,
    familyName: input.familyName,
    children: mergedChildren,
    createdAt: existingConfig?.createdAt || now,
    updatedAt: now,
    chainId: input.chainId,
    usdcAddress: input.usdcAddress,
  };

  const keyManager = new FamilyKeyManager();
  const familyKey = keyManager.getOrGenerateFamilyKey(familyId);

  const setup = new WalletSetup(getFamilyVaultPath(familyId));
  await setup.initializeFamily(familyConfig, familyKey);

  await state.saveFamilyConfig(familyId, familyConfig);
  for (const child of input.children) {
    await state.initializeStreak(familyId, child.name);
  }

  await state.addAuditEntry(familyId, {
    id: randomUUID(),
    timestamp: now,
    action: "configure",
    actor: caller.memberId,
    details: {
      bootstrap: false,
      familyName: input.familyName,
      childCount: input.children.length,
    },
  });

  return {
    ok: true,
    bootstrap: false,
    familyId,
    familyName: input.familyName,
    children: buildChildrenSummary(input.children),
  };
}

function buildChildrenSummary(children: ChildConfig[]): ChildConfigSummary[] {
  return children.map((c) => {
    const catSummary = (c.categories ?? [])
      .map(
        (cat) => `${cat.name}: $${(cat.budget / 10 ** USDC.DECIMALS).toFixed(2)}`
      )
      .join(", ");
    return {
      name: c.name,
      weeklyBudgetUsd: (c.weeklyBudget / 10 ** USDC.DECIMALS).toFixed(2),
      categories: catSummary,
      savingsPercent: c.savingsPercent,
      wallet: c.walletAddress || "OWS-managed",
    };
  });
}

/**
 * Validate category-percent sums and learning-goal category references.
 * Returns the first error encountered, or null if all children validate.
 * Shared between MCP and HTTP callers — keeps validation semantics identical.
 */
export function validateChildren(
  children: Array<{
    name: string;
    categories: Array<{ name: string; pct: number }>;
    learningGoals?: Array<{ topic: string; category: string }>;
  }>
): string | null {
  for (const child of children) {
    const totalPct = child.categories.reduce((s, c) => s + c.pct, 0);
    if (totalPct > 100) {
      return `Category percentages for ${child.name} sum to ${totalPct}% — must be ≤ 100%.`;
    }
    if (child.learningGoals && child.learningGoals.length > 0) {
      const validCatNames = child.categories.map((c) => c.name.toLowerCase());
      for (const goal of child.learningGoals) {
        if (!validCatNames.includes(goal.category.toLowerCase())) {
          return `Goal category '${goal.category}' not configured for ${child.name}. Available: ${child.categories
            .map((c) => c.name)
            .join(", ")}`;
        }
      }
    }
  }
  return null;
}

/**
 * Convert USD-denominated child input into 6-decimal USDC `ChildConfig`.
 * Exposed so HTTP form-submission path and MCP tool path share identical
 * rounding semantics.
 */
export function normalizeChildren(
  children: Array<{
    name: string;
    walletAddress?: string;
    weeklyBudgetUsd: number;
    categories: Array<{ name: string; pct: number }>;
    savingsPercent: number;
    learningGoals?: Array<{ topic: string; category: string }>;
  }>
): ChildConfig[] {
  return children.map((child) => {
    const weeklyBudget = Math.round(child.weeklyBudgetUsd * 10 ** USDC.DECIMALS);
    return {
      name: child.name,
      walletName: `child-${child.name.toLowerCase()}`,
      walletAddress: child.walletAddress,
      weeklyBudget,
      categories: child.categories.map((cat) => ({
        name: cat.name,
        pct: cat.pct,
        budget: Math.round(weeklyBudget * (cat.pct / 100)),
      })),
      savingsPercent: child.savingsPercent,
      savingsLockDays: 90,
      learningGoals: child.learningGoals?.map((g) => ({
        topic: g.topic,
        category: g.category,
        completed: false,
      })),
    };
  });
}
