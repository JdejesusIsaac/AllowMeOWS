import { z } from "zod";

// === Enums ===

export const RoleEnum = z.enum(["manager", "co-parent", "family", "advisor", "learner"]);
export type RoleType = z.infer<typeof RoleEnum>;

export const CategoryEnum = z.enum(["education", "health", "personal"]);
export type CategoryType = z.infer<typeof CategoryEnum>;

// === Family Config ===

export const ChildConfigSchema = z.object({
  name: z.string().min(1),
  walletName: z.string(),
  walletAddress: z.string().optional(), // External EVM address — skips OWS wallet creation if provided
  weeklyBudget: z.number().int().positive(), // USDC in 6-decimal units
  categoryBudgets: z.object({
    education: z.number().int().nonnegative(),
    health: z.number().int().nonnegative(),
    personal: z.number().int().nonnegative(),
  }),
  savingsPercent: z.number().min(0).max(100).default(20),
  savingsLockDays: z.number().int().nonnegative().default(90),
});
export type ChildConfig = z.infer<typeof ChildConfigSchema>;

export const FamilyConfigSchema = z.object({
  familyName: z.string().min(1),
  children: z.array(ChildConfigSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  chainId: z.string().default("eip155:84532"), // default to testnet
  usdcAddress: z.string(),
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
  category: CategoryEnum,
  description: z.string().min(1),
  score: z.number().min(0).max(100),
  source: AchievementSourceEnum.default("manual").optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type AchievementInput = z.infer<typeof AchievementInputSchema>;

export const AchievementRecordSchema = z.object({
  id: z.string().uuid(),
  childName: z.string(),
  category: CategoryEnum,
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

export const SavingsEntrySchema = z.object({
  id: z.string().uuid(),
  childName: z.string(),
  amount: z.number().int(), // USDC (6-decimal)
  depositedAt: z.string().datetime(),
  lockUntil: z.string().datetime(),
  released: z.boolean().default(false),
  releasedAt: z.string().datetime().optional(),
  multiplierAtDeposit: z.number().default(1.0),
});
export type SavingsEntry = z.infer<typeof SavingsEntrySchema>;

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
