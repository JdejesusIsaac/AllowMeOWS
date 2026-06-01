import { z } from "zod";

// === Enums ===

export const RoleEnum = z.enum(["manager", "co-parent", "family", "advisor", "learner"]);
export type RoleType = z.infer<typeof RoleEnum>;

// Deprecated — kept for backward-compat migration only
export const CategoryEnum = z.enum(["education", "health", "personal"]);
export type CategoryType = z.infer<typeof CategoryEnum>;

export const CategoryEntrySchema = z.object({
  name: z.string().min(1).max(50),
  pct: z.number().min(0).max(100),
  budget: z.number().int().nonnegative(), // USDC in 6-decimal units
});
export type CategoryEntry = z.infer<typeof CategoryEntrySchema>;

// === Family Config ===

// Sprint 3.0.1: Parent-defined learning goals.
// Parent sets WHAT the child learns (curriculum). Claude Learning Mode handles
// HOW (Socratic dialogue). AllowanceAgent tracks WHETHER it happened by
// fuzzy-matching achievements against goals at verify-achievement time.
// Sprint 3.0.3: optional sub-steps for mastery-driven goal progressions.
// E.g. "Catch up to 7th grade math" decomposes into fractions → decimals →
// ratios → pre-algebra. Each subgoal completes independently; the parent
// goal completes when the parent marks it (via verify-achievement or a
// future explicit "mark-goal-complete" tool).
export const SubgoalSchema = z.object({
  topic: z.string().min(1).max(200),
  completed: z.boolean().default(false),
});
export type Subgoal = z.infer<typeof SubgoalSchema>;

// Sprint 4.0: Learning Mode foundation. A StudyPlan attaches structured
// pedagogy to a LearningGoal — duration in days, minutes per session,
// progressively-completed sessions, and optional baseline-assessment
// calibration. Optional on LearningGoal so pre-4.0 goals continue to
// behave as tracker-only. See sprint-4.0/plan.md Decision 5.
export const BaselineAssessmentSchema = z.object({
  completedAt: z.string().datetime(),
  // Score on the adaptive baseline (0-100). Optional for fallback paths
  // where the parent supplies a level without running an LLM assessment.
  score: z.number().min(0).max(100).optional(),
  level: z.enum(["novice", "intermediate", "advanced"]),
  gaps: z.array(z.string()).default([]),
});
export type BaselineAssessment = z.infer<typeof BaselineAssessmentSchema>;

// One completed Learning Mode session. Persisted in studyPlan.sessions.
// Sprint Contract criterion 7: receipt is stored as `receiptSummary` AND
// surfaced via the `learning-session-completed` audit entry. Criterion 9:
// `confidenceFlag` is the L5 cool-down statistical signal — "low" means
// medianTurnIntervalSeconds < 5, surfaced to parent in the receipt.
export const SessionRecordSchema = z.object({
  sessionId: z.string().min(1),
  date: z.string().datetime(),
  durationMinutes: z.number().nonnegative(),
  topic: z.string().min(1),
  assessmentPassed: z.boolean(),
  // Raw assessment score (0-100). Optional because a session can complete
  // without a graded assessment if the kid bails mid-quiz.
  assessmentScore: z.number().min(0).max(100).optional(),
  conceptsCovered: z.array(z.string()).default([]),
  knownGaps: z.array(z.string()).default([]),
  // 1-5 engagement scale, averaged across kid turns. Q1 from research.
  avgEngagement: z.number().min(1).max(5),
  medianTurnIntervalSeconds: z.number().nonnegative(),
  confidenceFlag: z.enum(["ok", "low"]).default("ok"),
  // 6-decimal USDC micros. Stays z.number().int() to match the rest of
  // the codebase ($5/wk = 5_000_000 micros, well under MAX_SAFE_INTEGER).
  usdcSettled: z.number().int().nonnegative().default(0),
  receiptSummary: z.string().default(""),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

export const StudyPlanSchema = z.object({
  // Bounded 1-60 days. Anything longer is a curriculum, not a study plan.
  durationDays: z.number().int().min(1).max(60),
  // Bounded 15-60 min/session. Shorter sessions don't sustain pedagogy;
  // longer sessions are exhausting on a kid's device (research risk 4).
  minutesPerSession: z.number().int().min(15).max(60),
  startedAt: z.string().datetime().optional(),
  sessionsCompleted: z.number().int().nonnegative().default(0),
  sessionsPlanned: z.number().int().positive(),
  currentPhase: z.string().default(""),
  baselineAssessment: BaselineAssessmentSchema.optional(),
  sessions: z.array(SessionRecordSchema).default([]),
  // Q2 from research: flexible daily limit. Default false (one-per-day).
  // Manager flips true via configure-policy for sick-day / weekend catchup.
  allowMakeupSessions: z.boolean().default(false),
  // YYYY-MM-DD UTC. Updated on each start-learning-session; the L4 daily
  // limit compares against today's UTC date.
  lastSessionDate: z.string().optional(),
  // Aggregate of knownGaps across sessions; tutor LLM probes these on
  // subsequent sessions (L3 conversation-state binding).
  knownGaps: z.array(z.string()).default([]),
});
export type StudyPlan = z.infer<typeof StudyPlanSchema>;

export const LearningGoalSchema = z.object({
  topic: z.string().min(1).max(200),
  category: z.string().min(1), // must match a configured category name on the child
  completed: z.boolean().default(false),
  completedAt: z.string().datetime().optional(),
  achievementId: z.string().optional(),
  // Sprint 3.0.3: optional sub-steps. 20-cap is intentional — more than that
  // looks like a curriculum, which is a different product.
  subgoals: z.array(SubgoalSchema).max(20).optional(),
  // Sprint 3.0.3: optional deadline for time-bounded goals
  // (e.g., "catch up to grade level before school starts").
  // ISO-8601 datetime — Claude formats parent's natural-language dates on input.
  deadline: z.string().datetime().optional(),
  // Sprint 4.0: optional Learning Mode study plan. Backward-compat — pre-4.0
  // goals without this field continue to behave as tracker-only goals.
  // Math-only enforcement is handled at the configure-policy boundary
  // (plan.md success criterion 12), not in the schema, so non-math goals
  // can still persist a studyPlan and run as tracker-only with a note.
  studyPlan: StudyPlanSchema.optional(),
});
export type LearningGoal = z.infer<typeof LearningGoalSchema>;

export const ChildConfigSchema = z.object({
  name: z.string().min(1),
  walletName: z.string(),
  walletAddress: z.string().optional(), // External EVM address — skips OWS wallet creation if provided
  weeklyBudget: z.number().int().positive(), // USDC in 6-decimal units
  categories: z.array(CategoryEntrySchema).min(1).max(10).optional(),
  // Deprecated — legacy format, auto-migrated to categories[] on load
  categoryBudgets: z.object({
    education: z.number().int().nonnegative(),
    health: z.number().int().nonnegative(),
    personal: z.number().int().nonnegative(),
  }).optional(),
  savingsPercent: z.number().min(0).max(100).default(20),
  savingsLockDays: z.number().int().nonnegative().default(90),
  // Sprint 3.0.1: optional curriculum. Backward-compat — existing configs
  // without this field load with no goals.
  learningGoals: z.array(LearningGoalSchema).max(20).optional(),
});
export type ChildConfig = z.infer<typeof ChildConfigSchema>;

export const FamilyConfigSchema = z.object({
  familyId: z.string().uuid().optional(), // auto-generated per-family key identifier (Sprint 2.75)
  familyName: z.string().min(1),
  children: z.array(ChildConfigSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  chainId: z.string().default("eip155:84532"), // default to testnet
  usdcAddress: z.string(),
  // Sprint 3.0.2 — destination allowlist enforced by distribute-allowance /
  // release-savings on the child-wallet leg only. Internal vaults
  // (savings-vault, gift-fund) are exempt. Addresses stored lowercased.
  authorizedDestinations: z.array(z.string()).default([]),
  // Sprint 3.0.6 — monotonic write counter incremented on every
  // configureFamilyCore save (bootstrap → 1, each subsequent update → +1).
  // Default 0 means "predates the counter": pre-3.0.6 family configs hydrate
  // here via lazy Zod migration. Used by view-policy as a cache-correctness
  // discriminator and a foothold for a future optimistic-concurrency guard
  // on configure-policy.
  policyVersion: z.number().int().nonnegative().default(0),
  // Sprint 4.0.3 W7 — opt-in weekly auto-settle. Default off (D4: informed
  // consent — a misconfigured allowlist would silently fail under opt-out
  // defaults). When true, the Sunday 00:00 UTC auto-settle job runs
  // settle-balance on this family's ledger.
  autoSettleWeekly: z.boolean().default(false),
});
export type FamilyConfig = z.infer<typeof FamilyConfigSchema>;

// === Ledger (Sprint 4.0.3) ===
//
// A LedgerEntry is the unit of "money owed but not yet on-chain". Earning
// recognition (verify-achievement → ledger write) is decoupled from
// settlement (settle-balance → on-chain transfer). The savings split is
// computed and persisted at earn time so retroactive savingsPercent edits
// do not reshape past entries (research §3.1 / plan D2).

export const LedgerEntryKindEnum = z.enum([
  "achievement-credit", // verify-achievement → child wallet portion
  "savings-deposit",    // verify-achievement → savings vault portion
  "savings-release",    // release-savings → child wallet (matured savings)
  "session-payout",     // settle-session-payout → child wallet (Learning Mode)
]);
export type LedgerEntryKind = z.infer<typeof LedgerEntryKindEnum>;

export const LedgerEntryDestinationEnum = z.enum(["child-wallet", "savings-vault"]);
export type LedgerEntryDestination = z.infer<typeof LedgerEntryDestinationEnum>;

export const LedgerEntryStatusEnum = z.enum([
  "pending",
  "settled",
  "failed",
  // Sprint 4.0.3 W8 — terminal state after 3 failed retries. Not re-picked
  // by subsequent settle-balance calls; requires operator review.
  "abandoned",
]);
export type LedgerEntryStatus = z.infer<typeof LedgerEntryStatusEnum>;

export const LedgerEntrySchema = z.object({
  id: z.string().uuid(),
  familyId: z.string(),
  childName: z.string(),
  kind: LedgerEntryKindEnum,
  destination: LedgerEntryDestinationEnum,
  // 6-decimal USDC micros. Matches Achievement.amount conventions.
  amountUsdcMicros: z.number().int().nonnegative(),
  status: LedgerEntryStatusEnum,
  createdAt: z.string().datetime(),
  settledAt: z.string().datetime().optional(),
  txHash: z.string().optional(),
  // UUID grouping entries that landed in the same settle-balance call.
  // Set by markSettled on success; never cleared.
  settlementBatchId: z.string().optional(),
  // FK to Achievement.id | SavingsEntry.id | SessionRecord.sessionId.
  // Used by findBySourceId for idempotent dual-write + migration dedup.
  sourceId: z.string().min(1),
  // Sprint 4.0.3 W8 — failure classifier output:
  //   policy_denied: recipient_not_authorized | insufficient_gas |
  //   rpc_timeout | chain_reorg | raw error message (unknown class).
  failureReason: z.string().optional(),
  // Sprint 4.0.3 W8 — incremented on every markFailed; on the 3rd
  // failure with the same destination the entry transitions to
  // "abandoned" and a Sentry event fires.
  retryCount: z.number().int().nonnegative().default(0),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type LedgerEntryInput = z.input<typeof LedgerEntrySchema>;

// === Achievement ===

export const AchievementSourceEnum = z.enum([
  "manual",
  "openMAIC",
  "fitbit",
  "apple-health",
  "self-report",
  "parent-attested",
]);
export type AchievementSource = z.infer<typeof AchievementSourceEnum>;

export const AchievementInputSchema = z.object({
  childName: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  score: z.number().min(0).max(100),
  source: AchievementSourceEnum.default("manual").optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type AchievementInput = z.infer<typeof AchievementInputSchema>;

export const AchievementRecordSchema = z.object({
  id: z.string().uuid(),
  childName: z.string(),
  category: z.string().min(1),
  description: z.string(),
  score: z.number(),
  amount: z.number().int(), // USDC earned (6-decimal units)
  source: AchievementSourceEnum.default("manual"),
  verifiedBy: z.string(), // member ID
  verifiedAt: z.string().datetime(),
  distributed: z.boolean().default(false),
  distributedAt: z.string().datetime().optional(),
  txHash: z.string().optional(),
  // Sprint 4.0.3 W3 — set true once ledger entries exist for this
  // achievement (Phase C semantics: distribute-allowance no longer
  // broadcasts; it ledgerizes). Pre-4.0.3 records hydrate as undefined
  // and are treated as "not yet ledgerized".
  ledgerized: z.boolean().optional(),
  ledgerizedAt: z.string().datetime().optional(),
});
export type AchievementRecord = z.infer<typeof AchievementRecordSchema>;

// === Members ===

export const MemberSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: RoleEnum,
  childName: z.string().optional(), // populated when role is "learner" — scopes data access
  walletAddress: z.string().optional(), // x402 payer address — maps HTTP caller to member
  apiKeyId: z.string().optional(), // OWS API key ID
  joinedAt: z.string().datetime(),
  lastActivity: z.string().datetime().optional(),
  // Sprint 3.0 v4: timestamp of the most recent successful Sign-in-with-Base.
  // Undefined for pre-3.0 setup-code-only Members. Sprint 4.0 will use this
  // for freshness checks before Smart Wallet treasury signer registration.
  walletVerifiedAt: z.string().datetime().optional(),
  active: z.boolean().default(true),
});
export type Member = z.infer<typeof MemberSchema>;

// === Invites ===

export const InviteSchema = z.object({
  code: z.string(),
  role: RoleEnum,
  childName: z.string().optional(), // for child-scoped invites
  familyId: z.string(),
  createdBy: z.string(), // member ID
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  used: z.boolean().default(false),
  usedBy: z.string().optional(), // member ID of acceptor
  usedAt: z.string().datetime().optional(),
});
export type Invite = z.infer<typeof InviteSchema>;

// === Streaks ===

export const StreakDataSchema = z.object({
  childName: z.string(),
  currentStreak: z.number().int().nonnegative().default(0),
  longestStreak: z.number().int().nonnegative().default(0),
  lastActivityDate: z.string().optional(), // ISO date (YYYY-MM-DD)
  multiplier: z.number().min(1).max(2).default(1.0),
  weeklyAchievements: z.number().int().nonnegative().default(0),
});
export type StreakData = z.infer<typeof StreakDataSchema>;

// === Savings ===

export const SavingsAssetEnum = z.enum(["USDC", "PAXG"]);
export type SavingsAsset = z.infer<typeof SavingsAssetEnum>;

export const SavingsEntrySchema = z.object({
  id: z.string().uuid(),
  childName: z.string(),
  amount: z.number().int(), // USDC (6-decimal) or PAXG smallest unit
  asset: SavingsAssetEnum.default("USDC"),
  depositedAt: z.string().datetime(),
  lockUntil: z.string().datetime(),
  released: z.boolean().default(false),
  releasedAt: z.string().datetime().optional(),
  multiplierAtDeposit: z.number().default(1.0),
  converted: z.boolean().default(false),
  convertedFrom: z.string().optional(), // original entry ID if this is a conversion result
  conversionTxHash: z.string().optional(), // MoonPay swap tx hash
  priceAtConversion: z.number().optional(), // USD price per unit at conversion time
  receivedAmount: z.string().optional(), // PAXG amount as string (18-decimal, avoid overflow)
});
export type SavingsEntry = z.infer<typeof SavingsEntrySchema>;
export type SavingsEntryInput = z.input<typeof SavingsEntrySchema>;

// === Audit Log ===

export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  action: z.enum([
    "configure",
    "verify-achievement",
    "distribute",
    "savings-deposit",
    "savings-release",
    "gift-contribute",
    "invite-created",
    "invite-accepted",
    "member-added",
    "member-removed",
    "role-changed",
    "wallet-created",
    "policy-created",
    "external-wallet-registered",
    "savings-converted",
    // Sprint 3.0 v4 — Sign-in-with-Base audit actions
    "wallet-signed-in",
    "wallet-bound-to-member",
    "setup-code-rotated-via-wallet-reauth",
    "family-created-via-verify-page",
    "learner-invite-redeemed-via-verify-page",
    // Sprint 3.0.2 — destination allowlist
    "transfer-rejected-by-allowlist",
    "transfer-rejected-by-policy-enforcer",
    "authorized-destinations-updated",
    "authorized-destinations-removal-blocked",
    // Sprint 3.6 — recovery tools. C4: `resend-invite` revokes the prior
    // invite before issuing a fresh one. C6: `view-my-link` records each
    // read (audit `details` MUST NOT contain the setup code itself).
    "invite-revoked",
    "magic-link-viewed",
    // Sprint 3.7 — subgoal auto-matching on verify-achievement. Recorded
    // when the matcher finds a high-confidence (≥0.85) match between an
    // achievement description and an open subgoal topic and auto-flips
    // `subgoal.completed` to true. `details` includes
    // {subgoalTopic, goalTopic, achievementDescription, confidence, matchType}.
    "subgoal-auto-completed",
    // Sprint 4.0 — Learning Mode lifecycle. `learning-session-started`:
    // details include {childName, goalTopic, sessionId, sessionNumber,
    // isFirstSession, isMakeupSession}. `baseline-assessment-completed`:
    // details include {childName, goalTopic, level, gaps, score?}.
    // `learning-session-completed`: details include {childName, goalTopic,
    // sessionId, avgEngagement, medianTurnIntervalSeconds, assessmentPassed,
    // confidenceFlag, baseRate, engagementMultiplier, completionRatio,
    // payoutUsdc, txHash, receiptSummary}. `learning-session-flagged-low-
    // confidence`: details include {childName, sessionId,
    // medianTurnIntervalSeconds, reason}.
    "learning-session-started",
    "baseline-assessment-completed",
    "learning-session-completed",
    "learning-session-flagged-low-confidence",
  ]),
  actor: z.string(), // member ID or "system"
  details: z.record(z.unknown()),
  txHash: z.string().optional(),
  amount: z.number().int().optional(), // USDC if applicable
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// === Policy Config (OWS policy_config) ===

export const PolicyConfigSchema = z.object({
  role: RoleEnum,
  max_weekly_distribution: z.number().int().optional(),
  max_gift_amount: z.number().int().optional(),
  authorized_wallets: z.array(z.string()).optional(),
  allowed_actions: z.array(z.string()).optional(),
  denied_actions: z.array(z.string()).optional(),
  signing_allowed: z.boolean().optional(),
});
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
