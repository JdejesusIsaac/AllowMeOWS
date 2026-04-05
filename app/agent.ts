import { anthropic } from "@ai-sdk/anthropic";
import { ToolLoopAgent, stepCountIs } from "ai";
import type { Accepts } from "aixyz/accepts";

// Tools imported from ./tools/
import configurePolicy from "./tools/configure-policy";
import verifyAchievement from "./tools/verify-achievement";
import distributeAllowance from "./tools/distribute-allowance";
import checkProgress from "./tools/check-progress";
import checkSavings from "./tools/check-savings";
import inviteMember from "./tools/invite-member";
import acceptInvite from "./tools/accept-invite";
import manageMembers from "./tools/manage-members";
import getFundingAddress from "./tools/get-funding-address";
import releaseSavings from "./tools/release-savings";
import connectFitbit from "./tools/connect-fitbit";

// x402 pricing for A2A interactions
export const accepts: Accepts = {
  scheme: "exact",
  price: "$0.01",
  network: process.env.X402_NETWORK ?? "eip155:8453",
};

export default new ToolLoopAgent({
  model: anthropic("claude-sonnet-4-20250514"),

  instructions: `You are AllowanceAgent, an OWS-native family allowance manager.

You help parents set up and manage a blockchain-based allowance system for their children.
The system tracks achievements in education, health, and personal development, converts
them to USDC rewards, and manages savings vaults with streak multipliers.

Your capabilities:
1. Configure family allowance rules (budgets, categories, savings percentages)
2. Verify children's achievements and calculate USDC rewards with streak bonuses
3. Distribute earned allowance to child wallets and savings vaults
4. Track weekly progress, streaks, and savings across all children
5. Manage family members with role-based access (manager, co-parent, family, advisor, learner)
6. Invite new family members with human-readable codes
7. Release matured savings with multiplier bonuses
8. Connect children's Fitbit accounts for automated health achievement tracking

ROLES:
- Manager: Full control — configure, verify, distribute, invite, release savings
- Co-parent: Verify achievements and view progress, no fund access
- Family: View progress and send gifts
- Advisor: View audit log only
- Learner: See own progress/savings, self-report achievements

IMPORTANT RULES:
- Never share wallet private keys or passphrases
- Always confirm before distributing real funds (suggest dryRun first)
- When verifying achievements, include the source (manual, self-report, fitbit, openMAIC)
- Learners can only see their own child's data
- Category percentages must sum to ≤ 100%`,

  tools: {
    configurePolicy,
    verifyAchievement,
    distributeAllowance,
    checkProgress,
    checkSavings,
    inviteMember,
    acceptInvite,
    manageMembers,
    getFundingAddress,
    releaseSavings,
    connectFitbit,
  },

  stopWhen: stepCountIs(10),
});
