// Chain identifiers (CAIP-2)
export const CHAIN_IDS = {
  BASE_MAINNET: "eip155:8453",
  BASE_SEPOLIA: "eip155:84532",
} as const;

// Public RPC endpoints
export const RPC_URLS: Record<string, string> = {
  [CHAIN_IDS.BASE_MAINNET]: "https://mainnet.base.org",
  [CHAIN_IDS.BASE_SEPOLIA]: "https://base-sepolia.g.alchemy.com/v2/mUW76i8JLoH9yrkqC3aIb",
} as const;

// USDC contract addresses
export const USDC = {
  BASE_MAINNET: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  BASE_SEPOLIA: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  DECIMALS: 6,
} as const;

// Wallet naming convention
export const WALLET_NAMES = {
  TREASURY: "treasury",
  SAVINGS_VAULT: "savings-vault",
  GIFT_FUND: "gift-fund",
  ESTATE_VAULT: "estate-vault",
  childWallet: (name: string) => `child-${name.toLowerCase()}`,
} as const;

// Role definitions
export const ROLES = {
  MANAGER: "manager",
  CO_PARENT: "co-parent",
  FAMILY: "family",
  ADVISOR: "advisor",
  LEARNER: "learner",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// Policy bundle IDs
export const POLICY_IDS = {
  ALLOWANCE_FULL_ACCESS: "allowance-full-access",
  APPROVE_AND_READ_ONLY: "approve-and-read-only",
  GIFT_CONTRIBUTE_ONLY: "gift-contribute-only",
  AUDIT_READ_ONLY: "audit-read-only",
  LEARNER_READ_ONLY: "learner-read-only",
} as const;

// Role → Policy mapping
export const ROLE_POLICY_MAP: Record<Role, string> = {
  [ROLES.MANAGER]: POLICY_IDS.ALLOWANCE_FULL_ACCESS,
  [ROLES.CO_PARENT]: POLICY_IDS.APPROVE_AND_READ_ONLY,
  [ROLES.FAMILY]: POLICY_IDS.GIFT_CONTRIBUTE_ONLY,
  [ROLES.ADVISOR]: POLICY_IDS.AUDIT_READ_ONLY,
  [ROLES.LEARNER]: POLICY_IDS.LEARNER_READ_ONLY,
};

// Role → Tool access (which MCP tools each role can call)
export const ROLE_TOOL_ACCESS: Record<Role, string[]> = {
  [ROLES.MANAGER]: [
    "configure-policy",
    "verify-achievement",
    "distribute-allowance",
    "check-progress",
    "check-savings",
    "check-goals",
    "invite-member",
    "accept-invite",
    "manage-members",
    "get-funding-address",
    "release-savings",
    "connect-fitbit",
    "convert-savings",
  ],
  [ROLES.CO_PARENT]: [
    "verify-achievement",
    "check-progress",
    "check-savings",
    "check-goals",
    "accept-invite",
  ],
  [ROLES.FAMILY]: [
    "check-progress",
    "check-goals",
    // Sprint 3.0.2: `contribute-gift` removed — the tool is not registered
    // in this codebase (deferred per Decision 5). Leaving the stale RBAC
    // entry confused security review.
    "accept-invite",
  ],
  [ROLES.ADVISOR]: [
    "query-audit-log",
    "accept-invite",
  ],
  [ROLES.LEARNER]: [
    "check-progress",
    "check-savings",
    "check-goals",
    "verify-achievement",
    "accept-invite",
  ],
};

// Invite code config
export const INVITE = {
  EXPIRY_HOURS: 48,
  CODE_LENGTH: 4,
  ROLE_HINTS: {
    [ROLES.MANAGER]: "ADMIN",
    [ROLES.CO_PARENT]: "COPRT",
    [ROLES.FAMILY]: "GIFT",
    [ROLES.ADVISOR]: "ADVSR",
    [ROLES.LEARNER]: "LEARN",
  } as Record<Role, string>,
} as const;

// Data directory (relative to project root)
export const DATA_DIR = "data";

// Default savings split percentage
export const DEFAULT_SAVINGS_PERCENT = 20;

// Streak config
export const STREAK = {
  BONUS_THRESHOLD: 7, // days for streak bonus
  MULTIPLIER_INCREMENT: 0.1, // 10% bonus per streak level
  MAX_MULTIPLIER: 2.0,
} as const;
