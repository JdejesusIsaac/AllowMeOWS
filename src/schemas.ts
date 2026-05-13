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
});
export type FamilyConfig = z.infer<typeof FamilyConfigSchema>;

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
