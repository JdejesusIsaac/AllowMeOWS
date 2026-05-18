/**
 * Sprint 3.6 — Recovery Tools test suite.
 *
 * Step 2 (this file): RC1, RC2, RC3 — `resend-invite` correctness, RBAC, and
 * the not-found error path.
 *
 * Step 4 (later): RC4–RC8 — `test-connection` and `view-my-link` tests will
 * be appended to this file once those tools land.
 *
 * Conventions mirror `tests/invite-member-copy.test.ts`:
 *   - Inner handlers called directly (no MCP transport).
 *   - `createTestFamily` + `makeChild` from `tests/helpers/family.ts`.
 *   - Deterministic `ALLOWANCE_AGENT_URL` so the verify URL is stable.
 *
 * Adaptation note: `evaluation/test.md`'s `setupFamily()` / `callTool()` API
 * doesn't exist in the codebase. The real helper is `createTestFamily()`
 * (Decision D1 in `implementation/progress.md`). Field name `details` (not
 * `metadata`) is the existing audit-entry shape per `AuditEntrySchema`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inviteMemberHandler } from "../src/tools/invite-member.js";
import { resendInviteHandler } from "../src/tools/resend-invite.js";
import { testConnectionHandler } from "../src/tools/test-connection.js";
import { viewMyLinkHandler } from "../src/tools/view-my-link.js";
import { acceptInviteCore } from "../src/core/accept-invite.js";
import { SetupCodeStore } from "../src/identity/setup-codes.js";
import { ROLES } from "../src/constants.js";
import type { CallerContext } from "../src/middleware/access-control.js";
import { createTestFamily, makeChild } from "./helpers/family.js";

const testDataDir = join(process.cwd(), "data");

describe("RC: resend-invite (Sprint 3.6 Deliverable 4)", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    process.env.ALLOWANCE_AGENT_URL = "https://allowme.dev";
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    delete process.env.ALLOWANCE_AGENT_URL;
  });

  it("RC1: Manager resend revokes the old invite, issues a new one, audit shows both events", async () => {
    const family = await createTestFamily({
      familyName: "Garcia",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 10,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    // Issue the initial invite so resend has something to revoke.
    const initial = await inviteMemberHandler(
      {
        name: "Aiden",
        role: "learner",
        childName: "Aiden",
        ...family.asManager(),
      },
      family.managerContext,
    );
    const initialBody = JSON.parse(initial.content[0]!.text);
    expect(initialBody.success).toBe(true);
    const initialCode: string = initialBody.inviteCode;

    // Resend.
    const resend = await resendInviteHandler(
      {
        role: "learner",
        childName: "Aiden",
        ...family.asManager(),
      },
      family.managerContext,
    );
    const resendBody = JSON.parse(resend.content[0]!.text);

    // RC1.a — success + new code differs from old code
    expect(resendBody.success).toBe(true);
    expect(typeof resendBody.inviteCode).toBe("string");
    expect(resendBody.inviteCode).not.toBe(initialCode);

    // RC1.b — response surfaces what was revoked
    expect(resendBody.revokedInviteCode).toBe(initialCode);

    // RC1.c — old invite is gone from the active invites list. Revocation
    //          is implemented as deletion (no `revoked` field on InviteSchema,
    //          per Decision D2 / C10 amendment).
    const invitesAfter = await family.state.loadInvites(family.familyId);
    const oldInvite = invitesAfter.find((inv) => inv.code === initialCode);
    expect(oldInvite).toBeUndefined();

    // RC1.d — new invite is present in the active list
    const newInvite = invitesAfter.find(
      (inv) => inv.code === resendBody.inviteCode,
    );
    expect(newInvite).toBeDefined();
    expect(newInvite?.used).toBe(false);

    // RC1.e — audit log shows both events with `details.inviteCode`
    //          matching the right code (existing audit shape — D1).
    const audit = await family.state.loadAuditLog(family.familyId);
    const revokeEntry = audit.find(
      (e) =>
        e.action === "invite-revoked" &&
        (e.details as { inviteCode?: string })?.inviteCode === initialCode,
    );
    expect(revokeEntry).toBeDefined();
    expect(revokeEntry?.actor).toBe(family.memberId);

    const issueEntry = audit.find(
      (e) =>
        e.action === "invite-created" &&
        (e.details as { inviteCode?: string })?.inviteCode ===
          resendBody.inviteCode,
    );
    expect(issueEntry).toBeDefined();
    expect(issueEntry?.actor).toBe(family.memberId);

    // RC1.f — verify URL on the new invite encodes the new code
    expect(resendBody.verifyUrl).toContain(resendBody.inviteCode);
  });

  it("RC2: Non-Manager (learner) resend attempt is denied by RBAC", async () => {
    const family = await createTestFamily({
      familyName: "Garcia",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 10,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    // Seed an active invite so the gate is the RBAC check, not the
    // "no active invite" branch.
    await inviteMemberHandler(
      {
        name: "Aiden",
        role: "learner",
        childName: "Aiden",
        ...family.asManager(),
      },
      family.managerContext,
    );

    // Add a learner to the family and try the resend through the
    // RBAC-wrapped registration path. We invoke the wrapped handler via
    // `withAccessControl` indirectly by importing the registration's
    // exported handler — but that bypasses RBAC. To test RBAC, use the
    // public `isToolAuthorized` check on the role list.
    const learner = await family.addMember("learner", {
      childName: "Aiden",
      name: "Aiden (learner)",
    });

    // Smoke-check the access control: `resend-invite` must NOT appear in
    // learner's allowed tool list. This is what `withAccessControl` enforces.
    const { ROLE_TOOL_ACCESS, ROLES } = await import("../src/constants.js");
    expect(ROLE_TOOL_ACCESS[ROLES.LEARNER]).not.toContain("resend-invite");
    expect(ROLE_TOOL_ACCESS[ROLES.CO_PARENT]).not.toContain("resend-invite");
    expect(ROLE_TOOL_ACCESS[ROLES.FAMILY]).not.toContain("resend-invite");
    expect(ROLE_TOOL_ACCESS[ROLES.ADVISOR]).not.toContain("resend-invite");
    expect(ROLE_TOOL_ACCESS[ROLES.MANAGER]).toContain("resend-invite");

    // End-to-end RBAC check via the wrapped tool handler. Sprint 2.9's
    // `withAccessControl` returns an access-denied response (success: false,
    // role + toolName surfaced) when the caller role is not in the allowlist.
    const { withAccessControl } = await import(
      "../src/middleware/access-control.js"
    );
    const wrapped = withAccessControl("resend-invite", resendInviteHandler);
    const denied = await wrapped({
      role: "learner",
      childName: "Aiden",
      ...learner.asArgs,
    });
    const deniedBody = JSON.parse(denied.content[0]!.text);
    expect(deniedBody.success).toBe(false);
    expect(deniedBody.role).toBe("learner");
    expect(deniedBody.toolName).toBe("resend-invite");
    expect(deniedBody.error).toMatch(/cannot use|access denied/i);

    // RC2.c — the seeded invite is still active (RBAC denied before any
    //          state mutation occurred).
    const invitesAfter = await family.state.loadInvites(family.familyId);
    expect(invitesAfter.length).toBe(1);
    expect(invitesAfter[0]?.used).toBe(false);
  });

  it("RC3: Manager resend for a non-existent child returns a clean error and does not mutate state", async () => {
    const family = await createTestFamily({
      familyName: "Garcia",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 10,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const auditBefore = await family.state.loadAuditLog(family.familyId);
    const auditCountBefore = auditBefore.length;

    const res = await resendInviteHandler(
      {
        role: "learner",
        childName: "Nonexistent-Kid",
        ...family.asManager(),
      },
      family.managerContext,
    );
    const body = JSON.parse(res.content[0]!.text);

    // RC3.a — clean failure, informative error
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found in family config/i);

    // RC3.b — no audit-log entry created (revoke never happened)
    const auditAfter = await family.state.loadAuditLog(family.familyId);
    expect(auditAfter.length).toBe(auditCountBefore);

    // RC3.c — separately, the "no active invite" branch also fails clean
    //          when the child IS valid but no invite exists yet.
    const res2 = await resendInviteHandler(
      {
        role: "learner",
        childName: "Aiden",
        ...family.asManager(),
      },
      family.managerContext,
    );
    const body2 = JSON.parse(res2.content[0]!.text);
    expect(body2.success).toBe(false);
    expect(body2.error).toMatch(/no active invite/i);
  });
});

describe("RC: test-connection (Sprint 3.6 Step 4)", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    process.env.ALLOWANCE_AGENT_URL = "https://allowme.dev";
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    delete process.env.ALLOWANCE_AGENT_URL;
  });

  it("RC4: Manager test-connection returns identity + family + health", async () => {
    const family = await createTestFamily({
      familyName: "Isaac Family",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 10,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    // Seed audit row as manager so `lastActionAt` is defined (narrow contract assertion).
    const seed = await inviteMemberHandler(
      {
        name: "Guest Learner",
        role: ROLES.LEARNER,
        childName: "Aiden",
        ...family.asManager(),
      },
      family.managerContext,
    );
    expect(JSON.parse(seed.content[0]!.text).success).toBe(true);

    const res = await testConnectionHandler({}, family.managerContext);
    const body = JSON.parse(res.content[0]!.text);

    expect(body).toMatchObject({
      success: true,
      role: ROLES.MANAGER,
      familyName: "Isaac Family",
      familyId: family.familyId,
      healthCheck: "ok",
    });
    expect(body.lastActionAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.callerName).toMatch(/manager/i);
  });

  it("RC5: Learner test-connection returns learner-scoped identity", async () => {
    const family = await createTestFamily({
      familyName: "Isaac Family",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 10,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const inv = await inviteMemberHandler(
      {
        name: "Aiden",
        role: ROLES.LEARNER,
        childName: "Aiden",
        ...family.asManager(),
      },
      family.managerContext,
    );
    const inviteCode = JSON.parse(inv.content[0]!.text).inviteCode;

    const redeemRaw = await acceptInviteCore({ code: inviteCode, name: "Aiden" });
    if (!redeemRaw.ok) throw new Error(redeemRaw.error);
    const redeem = redeemRaw;

    const learnerCtx: CallerContext = {
      role: ROLES.LEARNER,
      memberId: redeem.memberId,
      familyId: redeem.familyId,
      childName: redeem.childName,
    };

    const res = await testConnectionHandler({}, learnerCtx);
    const body = JSON.parse(res.content[0]!.text);

    expect(body).toMatchObject({
      success: true,
      role: ROLES.LEARNER,
      callerName: "Aiden",
      familyName: "Isaac Family",
      familyId: family.familyId,
      healthCheck: "ok",
    });
    expect(body.scopedChildName).toBe("Aiden");
    expect(body.lastActionAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("RC: view-my-link (Sprint 3.6 Step 4)", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    process.env.ALLOWANCE_AGENT_URL = "https://allowme.dev";
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    delete process.env.ALLOWANCE_AGENT_URL;
  });

  it("RC6: Caller's own magic-link URL is returned", async () => {
    const family = await createTestFamily({
      familyName: "Garcia",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 10,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const setupCodes = new SetupCodeStore();
    const managerSetupCode = await setupCodes.issue(family.memberId);

    const res = await viewMyLinkHandler({}, family.managerContext);
    const body = JSON.parse(res.content[0]!.text);

    expect(body.success).toBe(true);
    expect(body.magicLinkUrl).toMatch(/^https:\/\/[^\s]+\/mcp\?setup=/);
    expect(body.magicLinkUrl).toContain(managerSetupCode);
    expect(body.warning).toMatch(/don't share|do not share/i);
    expect(body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("RC7: view-my-link audit entry recorded; details lack plaintext SETUP code", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 10,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const setupCodes = new SetupCodeStore();
    const plaintext = await setupCodes.issue(family.memberId);

    await viewMyLinkHandler({}, family.managerContext);

    const audit = await family.state.loadAuditLog(family.familyId);
    const entry = audit.find(
      (e) => e.action === "magic-link-viewed" && e.actor === family.memberId,
    );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry?.details ?? {})).not.toContain(plaintext);
    expect(JSON.stringify(entry?.details ?? {})).not.toMatch(
      /SETUP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/,
    );
  });

  it("RC8: view-my-link does NOT leak other members' links", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 10,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const setupCodes = new SetupCodeStore();
    const managerSetupCode = await setupCodes.issue(family.memberId);

    const inv = await inviteMemberHandler(
      {
        name: "Aiden",
        role: ROLES.LEARNER,
        childName: "Aiden",
        ...family.asManager(),
      },
      family.managerContext,
    );
    const inviteCode = JSON.parse(inv.content[0]!.text).inviteCode;

    const redeemRaw = await acceptInviteCore({ code: inviteCode, name: "Aiden" });
    if (!redeemRaw.ok) throw new Error(redeemRaw.error);
    const redeem = redeemRaw;
    const learnerSetupCode = redeem.setupCode;

    const learnerCtx: CallerContext = {
      role: ROLES.LEARNER,
      memberId: redeem.memberId,
      familyId: redeem.familyId,
      childName: redeem.childName,
    };

    const managerRes = await viewMyLinkHandler({}, family.managerContext);
    const managerBody = JSON.parse(managerRes.content[0]!.text);
    expect(managerBody.magicLinkUrl).toContain(managerSetupCode);
    expect(managerBody.magicLinkUrl).not.toContain(learnerSetupCode);

    const learnerRes = await viewMyLinkHandler({}, learnerCtx);
    const learnerBody = JSON.parse(learnerRes.content[0]!.text);
    expect(learnerBody.magicLinkUrl).toContain(learnerSetupCode);
    expect(learnerBody.magicLinkUrl).not.toContain(managerSetupCode);
  });
});
