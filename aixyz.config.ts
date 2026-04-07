import type { AixyzConfig } from "aixyz/config";

const config: AixyzConfig = {
  name: "AllowanceAgent",
  description:
    "OWS-native family allowance manager. Parents configure rules, verify achievements, " +
    "and distribute USDC allowances. Children track progress and savings. " +
    "Supports multi-user roles (manager, co-parent, family, advisor, learner) " +
    "with child-scoped data access and achievement source tracking.",
  version: "0.2.0",
  url: process.env.ALLOWANCE_AGENT_URL || undefined,
  x402: {
    // Disabled for V1 onboarding - zero address disables x402 middleware
    payTo: "0x0000000000000000000000000000000000000000",
    network: "eip155:8453",
  },
  skills: [
    {
      id: "configure-allowance",
      name: "Configure Allowance",
      description: "Set up family allowance rules, budgets, and savings percentages",
      tags: ["allowance", "configuration", "family"],
      examples: ["Set up allowance for my family"],
    },
    {
      id: "verify-achievement",
      name: "Verify Achievement",
      description: "Verify a child's achievement and queue it for allowance distribution",
      tags: ["achievement", "education", "health"],
      examples: ["Maya finished her math homework, score 95"],
    },
    {
      id: "check-progress",
      name: "Check Progress",
      description: "View weekly progress, achievements, streaks, and savings for children",
      tags: ["progress", "report", "dashboard"],
      examples: ["How is Maya doing this week?"],
    },
    {
      id: "distribute-allowance",
      name: "Distribute Allowance",
      description: "Send earned USDC to child wallets and savings vault",
      tags: ["payment", "distribution", "USDC"],
      examples: ["Distribute Maya's allowance"],
    },
    {
      id: "manage-family",
      name: "Manage Family",
      description: "Invite members, manage roles, and connect children as learners",
      tags: ["family", "invite", "roles"],
      examples: ["Invite grandma as a family member"],
    },
    {
      id: "connect-fitbit",
      name: "Connect Fitbit",
      description: "Link a child's Fitbit account for automated health achievement tracking via OAuth",
      tags: ["fitbit", "health", "oauth", "tracking"],
      examples: ["Connect Maya's Fitbit"],
    },
  ],
};

export default config;
