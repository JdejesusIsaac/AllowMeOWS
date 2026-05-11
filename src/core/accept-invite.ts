/**
 * Sprint 3.0 v4 — W1.12: extracted `accept-invite` / `redeem-invite` core.
 *
 * Both the MCP tool wrapper (`src/tools/accept-invite.ts`) and the HTTP
 * endpoint (`POST /api/redeem-invite`, W1.9) call into this module.
 *
 * Design contract: see `src/core/configure-family.ts` — same pattern. Core
 * owns state mutation + audit; callers translate domain results to their
 * own response formats.
 *
 * SIWE integration: when the caller path is the verify page (HTTP), the
 * SIWE-verified wallet address is threaded through as `acceptorWalletAddress`
 * and stored on the new Member record. Inline MCP invite acceptance (sprint
 * ≤2.9.1 behavior) passes `undefined`.
 */

import { randomUUID } from "node:crypto";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
import { InviteSystem } from "../invites/system.js";
import { RoleManager } from "../roles/manager.js";
import { MemberIndex } from "../identity/member-index.js";
import { SetupCodeStore } from "../identity/setup-codes.js";
import type { Invite, Member, RoleType } from "../schemas.js";

export interface AcceptInviteInput {
  code: string;
  name: string;
  /**
   * Sprint 3.0 v4: threaded onto the new Member record when the invite is
   * redeemed via the verify page. `undefined` for Learner/Advisor paths and
   * for legacy inline MCP acceptance.
   */
  acceptorWalletAddress?: string;
}

export interface AcceptInviteSuccess {
  ok: true;
  name: string;
  role: RoleType;
  childName?: string;
  familyId: string;
  /**
   * Sprint 3.0.4: surfaced from FamilyConfig so wrappers can build
   * role-flavored welcome copy that names the family ("the Asencio family
   * economy") rather than abstract "your family".
   */
  familyName: string;
  memberId: string;
  setupCode: string;
  mcpUrl: string;
  /**
   * Sprint 3.0.4: pre-built role-flavored welcome message. Both the MCP
   * inline tool response and the verify-page `/api/redeem-invite` HTTP
   * response can surface this to the user without each wrapper rebuilding
   * its own copy. See {@link buildWelcomeMessage}.
   */
  welcomeMessage: string;
}

export interface AcceptInviteFailure {
  ok: false;
  error: string;
  reason?:
    | "invite-not-found"
    | "child-not-found"
    | "invite-expired"
    | "invite-already-used";
}

export type AcceptInviteResult = AcceptInviteSuccess | AcceptInviteFailure;

/**
 * Core entry point for invite redemption. Scans all families' invite lists
 * for the provided code (codes are globally unique), validates the target
 * family's child config if the invite is Learner-scoped, creates the
 * Member record, registers in MemberIndex, marks the invite used, and
 * issues a setup code.
 */
export async function acceptInviteCore(
  input: AcceptInviteInput
): Promise<AcceptInviteResult> {
  const state = new StateManager();
  const inviteSystem = new InviteSystem();
  const index = new MemberIndex();

  const familyIds = await state.listFamilies();
  let matchingInvite: Invite | null = null;
  let matchingFamilyId: string | null = null;
  for (const fid of familyIds) {
    const invites = await state.loadInvites(fid);
    const candidate = inviteSystem.validateInvite(input.code, invites);
    if (candidate) {
      matchingInvite = candidate;
      matchingFamilyId = fid;
      break;
    }
  }

  if (!matchingInvite || !matchingFamilyId) {
    return {
      ok: false,
      error: "Invalid, expired, or already-used invite code.",
      reason: "invite-not-found",
    };
  }

  const invite = matchingInvite;
  const familyId = matchingFamilyId;

  // Load family config unconditionally — we need `familyName` for the
  // role-flavored welcome (Sprint 3.0.4). The learner-child-validation
  // block below reuses this same load.
  const config = await state.loadFamilyConfig(familyId);
  const familyName = config?.familyName ?? "your";

  if (invite.role === "learner" && invite.childName && config) {
    const childExists = config.children.some(
      (c) => c.name.toLowerCase() === invite.childName!.toLowerCase()
    );
    if (!childExists) {
      return {
        ok: false,
        error: "child not found in family config",
        reason: "child-not-found",
      };
    }
  }

  // Per-family OWS vault (Sprint 2.9.1) — the new member's API key is
  // scoped to the inviting family's vault, not a global one.
  const roleManager = new RoleManager(undefined, getFamilyVaultPath(familyId));
  const apiKeyResult = await roleManager.createRoleApiKey(input.name, invite.role);

  const memberId = randomUUID();
  const member: Member = {
    id: memberId,
    name: input.name,
    role: invite.role,
    childName: invite.role === "learner" ? invite.childName : undefined,
    walletAddress: input.acceptorWalletAddress?.toLowerCase(),
    apiKeyId: apiKeyResult?.id,
    joinedAt: new Date().toISOString(),
    active: true,
  };

  await state.addMember(familyId, member);
  await index.set(memberId, familyId, invite.role);

  const invites = await state.loadInvites(familyId);
  const toMark = invites.find((i) => i.code === invite.code);
  if (toMark) {
    toMark.used = true;
    toMark.usedBy = memberId;
    toMark.usedAt = new Date().toISOString();
    await state.saveInvites(familyId, invites);
  }

  await state.addAuditEntry(familyId, {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action: "invite-accepted",
    actor: memberId,
    details: {
      inviteCode: input.code,
      name: input.name,
      role: invite.role,
      ...(input.acceptorWalletAddress
        ? { walletAddress: input.acceptorWalletAddress.toLowerCase() }
        : {}),
    },
  });

  const setupCodes = new SetupCodeStore();
  const setupCode = await setupCodes.issue(memberId);
  const baseUrl = process.env.ALLOWANCE_AGENT_URL || "https://allowme.dev";
  const mcpUrl = `${baseUrl}/mcp?setup=${setupCode}`;

  const welcomeMessage = buildWelcomeMessage({
    name: input.name,
    role: invite.role,
    childName: member.childName,
    familyName,
    mcpUrl,
  });

  return {
    ok: true,
    name: input.name,
    role: invite.role,
    childName: member.childName,
    familyId,
    familyName,
    memberId,
    setupCode,
    mcpUrl,
    welcomeMessage,
  };
}

/**
 * Human-readable role descriptions. Sprint 3.0.4 deprecates this in favor
 * of {@link buildWelcomeMessage} which produces role-flavored copy with
 * concrete starter prompts. Kept exported for backward-compat — external
 * tooling that wants the one-liner can still grab it.
 */
export const ROLE_DESCRIPTIONS: Record<RoleType, string> = {
  manager: "full control over the family economy",
  "co-parent": "verify achievements and view progress",
  family: "view progress and send gifts",
  advisor: "view the audit log",
  learner: "see your progress and savings, report achievements",
};

// ===========================================================================
// Sprint 3.0.4 — role-flavored welcome message builder.
//
// Replaces the one-size-fits-all "Welcome, {name}! You're connected as a
// {role} member" template with per-role copy that:
//   - Greets a learner with "Hi {name}!" (softer register) and other roles
//     with "Welcome, {name}."
//   - Names the family by name ("the Asencio family economy") instead of
//     abstract "your family"
//   - Lists 3-4 concrete starter prompts the user can copy verbatim
//     ("'What are my goals?' — see what your parent set up for you")
//   - Surfaces the goal-discovery hint specifically — addresses the
//     pilot-observed gap where new learners didn't know to ask about goals
//   - Replaces the technical "update your MCP connector URL to..." with
//     step-by-step Claude → Settings → Connectors instructions
//   - Honest about the 48h-vs-30d setup-code split (Decision 6): MCP inline
//     redemption issues 48h codes; verify-page redemption issues 30d codes.
//     Either way, /verify is the rotation path.
// ===========================================================================

interface RoleWelcome {
  oneLineRole: string;
  starterPrompts: string[];
  goalsHint: string;
}

const SETUP_CODE_TTL_NOTE_INLINE =
  "This setup code is good for 48 hours. For a longer-lived 30-day code, " +
  "visit https://allowme.dev/verify and sign in with your Base wallet.";

function welcomeFor(
  role: RoleType,
  childName: string | undefined,
  familyName: string
): RoleWelcome {
  switch (role) {
    case "learner":
      return {
        oneLineRole:
          `You're connected to the ${familyName} family economy${childName ? ` as ${childName}` : ""}. ` +
          `This is your private space to see what you're working on, log what you did, and watch your savings grow.`,
        starterPrompts: [
          `"What are my goals?" — see what your parent set up for you to learn`,
          `"How am I doing this week?" — your progress, streak, and earnings`,
          `"Check my savings" — what's in your savings vault and when it unlocks`,
          `"I read for 30 minutes today" or similar — log something you did and earn allowance`,
        ],
        goalsHint:
          `Your parent may have set goals for you in subjects like reading, programming, or math. ` +
          `Try asking "what are my goals?" first — that's the best place to start.`,
      };

    case "co-parent":
      return {
        oneLineRole:
          `You're a co-parent on the ${familyName} family economy. ` +
          `You can verify your kid's achievements and see how they're doing, ` +
          `but you can't move funds — that's the manager's role.`,
        starterPrompts: [
          `"How is [child name] doing this week?" — see their progress and pending allowance`,
          `"[Child name] read for 30 minutes today, score 85, reading" — verify an achievement`,
          `"Check [child name]'s savings" — see what's locked and when it releases`,
          `"What are [child name]'s goals?" — see what the family is working on`,
        ],
        goalsHint:
          `Goals are set by the manager via configure-policy. ` +
          `If you want to suggest changes, talk to the manager.`,
      };

    case "family":
      return {
        oneLineRole:
          `You're a family member on the ${familyName} family economy. ` +
          `You can see how the kids are doing and contribute gifts to their gift fund.`,
        starterPrompts: [
          `"How are the kids doing this week?" — overall family progress`,
          `"What is the gift fund address?" — get the address to send a contribution`,
          `"What are the kids' goals?" — see what they're working toward`,
        ],
        goalsHint:
          `Knowing what the kids are working on helps you have better conversations with them about their progress.`,
      };

    case "advisor":
      return {
        oneLineRole:
          `You're an advisor on the ${familyName} family economy. ` +
          `You have read-only access to the audit log for compliance and oversight.`,
        starterPrompts: [
          `"Show me the audit log" — full transaction and event history`,
          `"What happened in the last 7 days?" — recent activity summary`,
        ],
        goalsHint:
          `As an advisor, your role is oversight rather than active participation. ` +
          `Goals and economy decisions belong to the manager.`,
      };

    case "manager":
    default:
      return {
        oneLineRole:
          `You're a manager of the ${familyName} family economy. ` +
          `You have full access to set rules, verify achievements, and move funds.`,
        starterPrompts: [
          `"Set up allowance for [child name]" — configure budgets, categories, savings`,
          `"How is [child name] doing this week?" — check progress`,
          `"Invite my partner as a co-parent" — bring another adult into the family`,
          `"What is the treasury address?" — get the address to fund the family economy`,
        ],
        goalsHint:
          `As manager, you set the learning goals via configure-policy. ` +
          `Try "set up [child name]'s reading goal — read 10 books by August" to add one.`,
      };
  }
}

/**
 * Build the full welcome message string for a newly-accepted Member.
 * Exported so tests can exercise the per-role branches in isolation
 * (same pattern as `buildCheckGoalsSummary`).
 */
export function buildWelcomeMessage(input: {
  name: string;
  role: RoleType;
  childName?: string;
  familyName: string;
  mcpUrl: string;
}): string {
  const welcome = welcomeFor(input.role, input.childName, input.familyName);
  const starterPromptList = welcome.starterPrompts
    .map((p, i) => `${i + 1}. ${p}`)
    .join("\n");
  const greeting = input.role === "learner" ? `Hi ${input.name}! ` : `Welcome, ${input.name}. `;

  return (
    `${greeting}${welcome.oneLineRole}\n\n` +
    `Here's what to try first:\n${starterPromptList}\n\n` +
    `${welcome.goalsHint}\n\n` +
    `To connect this to your own Claude:\n` +
    `1. Open Claude → Settings → Connectors → Add custom connector\n` +
    `2. Paste this URL: ${input.mcpUrl}\n` +
    `3. Enable it in your conversation\n\n` +
    `${SETUP_CODE_TTL_NOTE_INLINE}`
  );
}
