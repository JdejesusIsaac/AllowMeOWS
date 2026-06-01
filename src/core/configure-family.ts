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
import { FamilyApiTokenManager } from "../keys/family-api-tokens.js";
import { MemberIndex } from "../identity/member-index.js";
import { SetupCodeStore } from "../identity/setup-codes.js";
import { ROLES, USDC } from "../constants.js";
import type { FamilyConfig, ChildConfig, Member } from "../schemas.js";
import { mergeLearningGoals } from "../engine/learning-goals.js";
import type { CallerContext } from "../middleware/access-control.js";
import { tryNormalizeWallet } from "../auth/wallet.js";
import { policyCache } from "../cache/policy-cache.js";
import {
  computeRemovedDestinations,
  findBlockedRemovals,
  type BlockedRemoval,
} from "./allowlist.js";

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
  /**
   * Sprint 3.0.2: optional explicit destination allowlist. If supplied,
   * each entry is validated; invalid entries cause a
   * `ConfigureValidationError`. If omitted: existing config's list is
   * preserved (update path) or empty (bootstrap). In both cases, the
   * caller's wallet and every child's wallet are force-added before
   * persistence.
   */
  authorizedDestinations?: string[];
}

/**
 * Sprint 3.0.2 — thrown by `configureFamilyCore` when destination-allowlist
 * validation fails. Caught at the MCP tool boundary so the conversational
 * surface can render a structured error (rather than a generic 500).
 */
export class ConfigureValidationError extends Error {
  readonly kind: "removal-blocked" | "invalid-address";
  readonly affected?: BlockedRemoval[];
  readonly invalidValue?: string;

  constructor(opts: {
    kind: "removal-blocked";
    affected: BlockedRemoval[];
    message: string;
  });
  constructor(opts: {
    kind: "invalid-address";
    invalidValue: string;
    message: string;
  });
  constructor(opts: {
    kind: "removal-blocked" | "invalid-address";
    affected?: BlockedRemoval[];
    invalidValue?: string;
    message: string;
  }) {
    super(opts.message);
    this.name = "ConfigureValidationError";
    this.kind = opts.kind;
    this.affected = opts.affected;
    this.invalidValue = opts.invalidValue;
  }
}

/**
 * Build the authorized-destinations list for a family configure call.
 *
 * Resolution order:
 *   1. If `inputAuthorizedDestinations` is supplied, validate each entry
 *      via `tryNormalizeWallet`. Invalid entries throw
 *      `ConfigureValidationError({kind: "invalid-address"})`.
 *   2. Otherwise: start from `existingAuthorizedDestinations` (lowercased
 *      via `tryNormalizeWallet`).
 *   3. Force-add each child's `walletAddress` (skip undefined and
 *      unnormalizable).
 *   4. Force-add `callerWalletAddress` (skip if missing/unnormalizable).
 *   5. Dedupe (case-insensitive). Persist lowercase.
 *
 * Returns the resolved list along with `added` and `removed` diff arrays
 * (vs `existingAuthorizedDestinations`), so the caller can: (a) emit the
 * `authorized-destinations-updated` audit entry with the diff details,
 * (b) decide whether to run Decision-3 block-on-removal scan.
 */
export function buildAuthorizedDestinations(opts: {
  inputAuthorizedDestinations?: string[];
  existingAuthorizedDestinations?: string[];
  callerWalletAddress?: string;
  children: ChildConfig[];
}): {
  destinations: string[];
  added: string[];
  removed: string[];
} {
  const existing: string[] = [];
  const existingSet = new Set<string>();
  for (const e of opts.existingAuthorizedDestinations ?? []) {
    const n = tryNormalizeWallet(e);
    if (n && !existingSet.has(n)) {
      existing.push(n);
      existingSet.add(n);
    }
  }

  const start: string[] = [];
  const startSet = new Set<string>();

  if (opts.inputAuthorizedDestinations !== undefined) {
    for (const entry of opts.inputAuthorizedDestinations) {
      const n = tryNormalizeWallet(entry);
      if (!n) {
        throw new ConfigureValidationError({
          kind: "invalid-address",
          invalidValue: String(entry),
          message: `Invalid wallet address in authorizedDestinations: ${entry}`,
        });
      }
      if (!startSet.has(n)) {
        start.push(n);
        startSet.add(n);
      }
    }
  } else {
    for (const e of existing) {
      if (!startSet.has(e)) {
        start.push(e);
        startSet.add(e);
      }
    }
  }

  // Force-add each child's wallet (Q2 confirmed yes).
  for (const child of opts.children) {
    if (!child.walletAddress) continue;
    const n = tryNormalizeWallet(child.walletAddress);
    if (n && !startSet.has(n)) {
      start.push(n);
      startSet.add(n);
    }
  }

  // Force-add caller's wallet (Q2 confirmed yes).
  if (opts.callerWalletAddress) {
    const n = tryNormalizeWallet(opts.callerWalletAddress);
    if (n && !startSet.has(n)) {
      start.push(n);
      startSet.add(n);
    }
  }

  const removed = computeRemovedDestinations(existing, start);
  const added = start.filter((s) => !existingSet.has(s));

  return { destinations: start, added, removed };
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
  // Sprint 3.0.5 — surfaced for the verify-page transparency panel. Mirrors
  // `FamilyConfig.authorizedDestinations` after `buildAuthorizedDestinations`
  // has run. The HTTP boundary (app/verify-routes.ts) forwards this in the
  // JSON response so the bootstrap success state can render the allowlist
  // without an extra round-trip.
  authorizedDestinations: string[];
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

  // Sprint 3.0.2 — build the destination allowlist from input + caller +
  // child wallets. Invalid explicit input throws ConfigureValidationError,
  // which bubbles to the MCP tool boundary as a structured error.
  const allowlist = buildAuthorizedDestinations({
    inputAuthorizedDestinations: input.authorizedDestinations,
    existingAuthorizedDestinations: [],
    callerWalletAddress: input.managerWalletAddress,
    children: input.children,
  });

  const familyConfig: FamilyConfig = {
    familyId,
    familyName: input.familyName,
    children: input.children,
    createdAt: now,
    updatedAt: now,
    chainId: input.chainId,
    usdcAddress: input.usdcAddress,
    authorizedDestinations: allowlist.destinations,
    // Sprint 3.0.6 — bootstrap is the first write, so policyVersion starts
    // at 1. Pre-3.0.6 configs lazy-migrate to 0 (via Zod default in
    // FamilyConfigSchema); anything ≥ 1 means "has been through configure
    // since the counter shipped". W2 / CP-VER1.
    policyVersion: 1,
    // Sprint 4.0.3 W7 — opt-in weekly auto-settle. Default off (D4).
    autoSettleWeekly: false,
  };

  const keyManager = new FamilyKeyManager();
  const familyKey = keyManager.getOrGenerateFamilyKey(familyId);

  await state.createFamilyDir(familyId);
  const setup = new WalletSetup(getFamilyVaultPath(familyId));
  const setupResult = await setup.initializeFamily(familyConfig, familyKey);

  // Sprint 4.1 W4 — capture the bootstrap-minted OWS API token and persist
  // it under the master key. The same token is used on every subsequent
  // `distribute-allowance` / `release-savings` / `settle-session-payout`
  // call to engage the OWS policy engine (W6 callsites). Token lives in
  // `data/family-api-tokens.json`; the per-family OWS vault holds the
  // encrypted secret blob keyed by `managerKeyId`.
  const apiTokens = new FamilyApiTokenManager();
  apiTokens.saveToken(
    familyId,
    setupResult.managerToken,
    setupResult.managerKeyId
  );

  await state.saveFamilyConfig(familyId, familyConfig);
  // Sprint 3.0.6 — synchronous cache invalidation immediately after the
  // disk write rules out stale `view-policy` reads within the single-process
  // Railway window. PC4 integration test locks this end-to-end.
  policyCache.invalidate(familyId);
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

  // Sprint 3.0.2 — record the initial allowlist population. Bootstrap
  // always emits this entry (even if the resolved list is empty, e.g. a
  // family bootstrapped without any external child wallets and no
  // managerWalletAddress) so the audit trail records the state.
  await state.addAuditEntry(familyId, {
    id: randomUUID(),
    timestamp: now,
    action: "authorized-destinations-updated",
    actor: memberId,
    details: {
      tool: "configure-policy",
      bootstrap: true,
      added: allowlist.added,
      removed: allowlist.removed,
      destinations: allowlist.destinations,
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
    authorizedDestinations: allowlist.destinations,
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

  // Sprint 3.0.2 — resolve the caller's wallet from the Member record.
  // CallerContext doesn't carry walletAddress directly; we look it up
  // from the persisted Member so the force-add behaviour (Q2 confirmed)
  // works whether the caller authenticated via setup-code or via SIWE.
  const callerMember = await state.loadMember(familyId, caller.memberId);
  const callerWalletAddress = callerMember?.walletAddress;

  // Sprint 3.0.2 — build the new allowlist. Throws
  // ConfigureValidationError({kind:"invalid-address"}) on malformed input.
  const allowlist = buildAuthorizedDestinations({
    inputAuthorizedDestinations: input.authorizedDestinations,
    existingAuthorizedDestinations: existingConfig?.authorizedDestinations,
    callerWalletAddress,
    children: mergedChildren,
  });

  // Sprint 3.0.2 — Decision 3: block removals that would orphan unreleased,
  // unconverted savings entries. Scans only the addresses actually being
  // removed; emits one BlockedRemoval per affected (address, child) pair so
  // the error surface can list ALL affected children (AL14), not just the
  // first.
  if (allowlist.removed.length > 0) {
    const savings = await state.loadSavingsEntries(familyId);
    // Scan against EXISTING children (not mergedChildren). Decision 3 asks:
    // "Did a removed address belong to a child who has unreleased savings?"
    // The savings entries are bound to childName; the existing config tells
    // us which child historically owned each address. If a parent
    // simultaneously updates a child's wallet AND removes the old address
    // from the allowlist while unreleased savings exist, that is still a
    // block — the entries would orphan without a clear release path.
    const blocked = findBlockedRemovals(
      allowlist.removed,
      savings,
      existingConfig?.children ?? []
    );
    if (blocked.length > 0) {
      await state.addAuditEntry(familyId, {
        id: randomUUID(),
        timestamp: now,
        action: "authorized-destinations-removal-blocked",
        actor: caller.memberId,
        details: {
          tool: "configure-policy",
          attemptedRemoval: allowlist.removed,
          blocked,
        },
      });
      const summary = blocked
        .map(
          (b) =>
            `${b.childName} (${b.address}): ${b.entryIds.length} entries, ` +
            `${(b.totalUsdcLocked / 10 ** USDC.DECIMALS).toFixed(2)} USDC locked`
        )
        .join("; ");
      throw new ConfigureValidationError({
        kind: "removal-blocked",
        affected: blocked,
        message:
          `Cannot remove wallet(s) from authorizedDestinations while ` +
          `children have unreleased savings: ${summary}. ` +
          `Release or convert the savings first, then retry.`,
      });
    }
  }

  const familyConfig: FamilyConfig = {
    familyId,
    familyName: input.familyName,
    children: mergedChildren,
    createdAt: existingConfig?.createdAt || now,
    updatedAt: now,
    chainId: input.chainId,
    usdcAddress: input.usdcAddress,
    authorizedDestinations: allowlist.destinations,
    // Sprint 3.0.6 — increment by exactly 1 per update. Pre-3.0.6 configs
    // load with policyVersion: 0 (Zod default), so their first post-deploy
    // update bumps to 1 — matching the bootstrap semantics. W2 / CP-VER2.
    policyVersion: (existingConfig?.policyVersion ?? 0) + 1,
    // Sprint 4.0.3 W7 — preserve auto-settle preference across updates.
    // Default off for pre-4.0.3 configs (D4: opt-in).
    autoSettleWeekly: existingConfig?.autoSettleWeekly ?? false,
  };

  const keyManager = new FamilyKeyManager();
  const familyKey = keyManager.getOrGenerateFamilyKey(familyId);

  const setup = new WalletSetup(getFamilyVaultPath(familyId));
  await setup.initializeFamily(familyConfig, familyKey);

  await state.saveFamilyConfig(familyId, familyConfig);
  // Sprint 3.0.6 — synchronous cache invalidation on every update path
  // (same rationale as the bootstrap site above). PC4 integration test
  // locks "no stale read after write" end-to-end.
  policyCache.invalidate(familyId);
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

  // Sprint 3.0.2 — emit an `authorized-destinations-updated` entry whenever
  // the resolved list differs from the existing one. Force-add behaviour
  // (Q2) means a "no-op" update with a different caller wallet still
  // mutates the list — and that mutation belongs in the audit trail.
  if (allowlist.added.length > 0 || allowlist.removed.length > 0) {
    await state.addAuditEntry(familyId, {
      id: randomUUID(),
      timestamp: now,
      action: "authorized-destinations-updated",
      actor: caller.memberId,
      details: {
        tool: "configure-policy",
        bootstrap: false,
        added: allowlist.added,
        removed: allowlist.removed,
        destinations: allowlist.destinations,
      },
    });
  }

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
    learningGoals?: Array<{
      topic: string;
      category: string;
      subgoals?: Array<{ topic: string }>;
      deadline?: string;
      // Sprint 4.0 — parent-supplied study plan subset. Validation of
      // bounds (1-60 days, 15-60 min) lives in the Zod schemas at both the
      // HTTP and MCP boundaries. Cross-field validation here is intentionally
      // minimal: math-only enforcement is a non-blocking note (criterion 12),
      // not a hard reject, so it lives in the configure-policy response layer.
      studyPlan?: {
        durationDays: number;
        minutesPerSession: number;
        allowMakeupSessions?: boolean;
      };
    }>;
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
    learningGoals?: Array<{
      topic: string;
      category: string;
      subgoals?: Array<{ topic: string }>;
      deadline?: string;
      studyPlan?: {
        durationDays: number;
        minutesPerSession: number;
        allowMakeupSessions?: boolean;
      };
    }>;
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
        // Sprint 3.0.3: pass through optional subgoals + deadline. Subgoals
        // start with completed=false; deadline is preserved as-is (ISO).
        subgoals: g.subgoals?.map((sg) => ({ topic: sg.topic, completed: false })),
        deadline: g.deadline,
        // Sprint 4.0: build the canonical StudyPlan shape from the parent's
        // subset (durationDays / minutesPerSession / allowMakeupSessions).
        // Server-side fields take defaults here; `sessionsPlanned` mirrors
        // `durationDays` (1 session/day; the L4 daily limit enforces that
        // pacing). Subsequent `start-learning-session` / `complete-learning-
        // session` calls evolve sessionsCompleted, currentPhase, sessions,
        // baselineAssessment, lastSessionDate, knownGaps. mergeLearningGoals
        // preserves those server-side mutations across configure-policy
        // updates (see src/engine/learning-goals.ts).
        studyPlan: g.studyPlan
          ? {
              durationDays: g.studyPlan.durationDays,
              minutesPerSession: g.studyPlan.minutesPerSession,
              sessionsCompleted: 0,
              sessionsPlanned: g.studyPlan.durationDays,
              currentPhase: "",
              sessions: [],
              allowMakeupSessions: g.studyPlan.allowMakeupSessions ?? false,
              knownGaps: [],
            }
          : undefined,
      })),
    };
  });
}
