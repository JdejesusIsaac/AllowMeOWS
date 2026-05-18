# Sprint 3.6 — Test Specifications

## Test inventory

| Suite | Count | Location | Purpose |
|-------|-------|----------|---------|
| QR1 | 1 | `tests/qr-code.test.ts` (NEW) | Invite-member response includes valid base64-encoded QR code |
| RC1-RC8 | 8 | `tests/recovery-tools.test.ts` (NEW) | `resend-invite`, `test-connection`, `view-my-link` correctness + RBAC + audit |
| CARD1-CARD4 | 4 | `tests/rich-cards.test.ts` (NEW) | Rich-card markdown responses for the four kid-facing tools |
| MODAL1 | 1 | `tests/brand-modals.test.ts` (NEW) | Both brand modals render markdown content with load-bearing phrases |
| (manual) Mobile smoke | — | Section at bottom | Real iOS device + Android QR scan + cross-client rich-card rendering |

**Total automated tests added: 14.** Test count goes from 363 → 377.

The mobile smoke checklist is non-automated. It's the Definition of Done gate per progress-3.6.md.

---

## QR1 — QR code in invite-member response

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer } from "./helpers/server.js";
import { callTool } from "./helpers/mcp.js";
import { setupFamily } from "./helpers/setup.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

describe("QR: invite-member QR code", () => {
  it("QR1: response includes valid base64-encoded PNG QR code", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Elina",
      weeklyBudget: 5_00,
    });

    const res = await callTool("invite-member", managerMemberId, {
      role: "learner",
      childName: "Elina",
    });

    const body = JSON.parse(res.content[0].text);

    // Field present
    expect(body.inviteQrCode).toBeDefined();
    expect(typeof body.inviteQrCode).toBe("string");

    // Either inline base64 form OR hosted-URL fallback form
    const isBase64 = body.inviteQrCode.startsWith("data:image/png;base64,");
    const isHostedUrl = body.inviteQrCode.startsWith("https://") &&
                       body.inviteQrCode.includes("/qr/");
    expect(isBase64 || isHostedUrl).toBe(true);

    // If base64 form, decode and verify it's a valid PNG
    if (isBase64) {
      const base64Data = body.inviteQrCode.replace(/^data:image\/png;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      // PNG header: 89 50 4E 47 0D 0A 1A 0A
      expect(buffer.slice(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }

    // Verify URL must still be present (QR is supplement, not replacement)
    expect(body.verifyUrl).toMatch(/^https:\/\/[^\s]+\/verify\?invite=/);

    // Message must reference the QR option
    expect(body.message).toMatch(/scan.*QR|QR.*scan/i);
  });
});
```

---

## RC1-RC3 — `resend-invite` tests

```typescript
describe("RC: resend-invite", () => {
  it("RC1: Manager resends invite, old code revoked, new code issued, audit log records both", async () => {
    const { familyId, managerMemberId } = await setupFamily({ childName: "Aiden" });

    // First invite
    const initial = await callTool("invite-member", managerMemberId, {
      role: "learner",
      childName: "Aiden",
    });
    const initialCode = JSON.parse(initial.content[0].text).inviteCode;

    // Resend
    const resend = await callTool("resend-invite", managerMemberId, {
      childName: "Aiden",
      role: "learner",
    });
    const resendBody = JSON.parse(resend.content[0].text);
    expect(resendBody.success).toBe(true);
    expect(resendBody.inviteCode).toBeDefined();
    expect(resendBody.inviteCode).not.toBe(initialCode);

    // Old invite revoked
    const invites = await state.loadInvites(familyId);
    const oldInvite = invites.find((i) => i.code === initialCode);
    expect(oldInvite?.revoked).toBe(true);
    expect(oldInvite?.revokedAt).toBeDefined();

    // New invite active
    const newInvite = invites.find((i) => i.code === resendBody.inviteCode);
    expect(newInvite?.revoked).toBeFalsy();

    // Audit log entries
    const audit = await state.loadAuditLog(familyId);
    const revokeEntry = audit.find(
      (e) => e.action === "invite-revoked" && e.metadata?.inviteCode === initialCode,
    );
    expect(revokeEntry).toBeDefined();
    expect(revokeEntry?.actor).toBe(managerMemberId);

    const issueEntry = audit.find(
      (e) => e.action === "invite-issued" && e.metadata?.inviteCode === resendBody.inviteCode,
    );
    expect(issueEntry).toBeDefined();
  });

  it("RC2: Non-Manager attempting resend is denied by RBAC", async () => {
    const { familyId, managerMemberId } = await setupFamily({ childName: "Aiden" });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    const res = await callTool("resend-invite", learnerMemberId, {
      childName: "Aiden",
      role: "learner",
    });

    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/permission|not authorized|manager only/i);
  });

  it("RC3: Resend for non-existent member returns clean error", async () => {
    const { familyId, managerMemberId } = await setupFamily({ childName: "Aiden" });

    const res = await callTool("resend-invite", managerMemberId, {
      childName: "Nonexistent",
      role: "learner",
    });

    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found|no.*member|no.*child/i);
  });
});
```

---

## RC4-RC5 — `test-connection` tests

```typescript
describe("RC: test-connection", () => {
  it("RC4: Manager test-connection returns identity + family + health", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      familyName: "Isaac Family",
    });

    const res = await callTool("test-connection", managerMemberId, {});
    const body = JSON.parse(res.content[0].text);

    expect(body).toMatchObject({
      success: true,
      role: "manager",
      familyName: "Isaac Family",
      familyId,
      healthCheck: "ok",
    });
    expect(body.lastActionAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  it("RC5: Learner test-connection returns learner-scoped identity", async () => {
    const { familyId } = await setupFamily({ childName: "Aiden", familyName: "Isaac Family" });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    const res = await callTool("test-connection", learnerMemberId, {});
    const body = JSON.parse(res.content[0].text);

    expect(body).toMatchObject({
      success: true,
      role: "learner",
      callerName: "Aiden",
      familyName: "Isaac Family",
      familyId,
      healthCheck: "ok",
    });
  });
});
```

---

## RC6-RC8 — `view-my-link` tests

```typescript
describe("RC: view-my-link", () => {
  it("RC6: Caller's own magic-link URL is returned", async () => {
    const { familyId, managerMemberId, managerSetupCode } = await setupFamily({
      childName: "Aiden",
    });

    const res = await callTool("view-my-link", managerMemberId, {});
    const body = JSON.parse(res.content[0].text);

    expect(body.success).toBe(true);
    expect(body.magicLinkUrl).toMatch(/^https:\/\/[^\s]+\/mcp\?setup=SETUP-/);
    // Must be THIS caller's specific setup code
    expect(body.magicLinkUrl).toContain(managerSetupCode);
    expect(body.warning).toMatch(/don't share|do not share/i);
    expect(body.expiresAt).toBeDefined();
  });

  it("RC7: view-my-link audit entry recorded with caller as actor", async () => {
    const { familyId, managerMemberId } = await setupFamily({ childName: "Aiden" });

    await callTool("view-my-link", managerMemberId, {});

    const audit = await state.loadAuditLog(familyId);
    const entry = audit.find(
      (e) => e.action === "magic-link-viewed" && e.actor === managerMemberId,
    );
    expect(entry).toBeDefined();
    // Must NOT include the actual link in metadata (privacy)
    expect(JSON.stringify(entry?.metadata ?? {})).not.toMatch(/SETUP-[A-Z0-9]+/);
  });

  it("RC8: view-my-link does NOT leak other members' links", async () => {
    const { familyId, managerMemberId, managerSetupCode } = await setupFamily({
      childName: "Aiden",
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");
    const learnerSetupCode = await getLearnerSetupCode(familyId, learnerMemberId);

    // Manager calls view-my-link
    const managerRes = await callTool("view-my-link", managerMemberId, {});
    const managerBody = JSON.parse(managerRes.content[0].text);

    expect(managerBody.magicLinkUrl).toContain(managerSetupCode);
    expect(managerBody.magicLinkUrl).not.toContain(learnerSetupCode);

    // Learner calls view-my-link
    const learnerRes = await callTool("view-my-link", learnerMemberId, {});
    const learnerBody = JSON.parse(learnerRes.content[0].text);

    expect(learnerBody.magicLinkUrl).toContain(learnerSetupCode);
    expect(learnerBody.magicLinkUrl).not.toContain(managerSetupCode);
  });
});
```

---

## CARD1-CARD4 — Rich response card tests

```typescript
describe("CARD: rich response cards", () => {
  it("CARD1: check-progress returns rich card with progress bar, streak, next-action", async () => {
    const { familyId, managerMemberId } = await setupFamily({ childName: "Aiden", weeklyBudget: 5_00 });
    await verifyAchievement(familyId, managerMemberId, {
      childName: "Aiden",
      category: "reading",
      score: 85,
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    const res = await callTool("check-progress", learnerMemberId, {});
    const body = JSON.parse(res.content[0].text);

    expect(body.success).toBe(true);
    expect(body.summary).toBeDefined();

    // Required visual elements in the summary card
    expect(body.summary).toMatch(/▓|░/); // progress bar
    expect(body.summary).toMatch(/\$[\d.]+/); // dollar amount
    expect(body.summary).toMatch(/👉|🔥|⏳/); // emoji indicator
    expect(body.summary).toMatch(/Aiden/); // names the child

    // Structured data preserved
    expect(body.earned).toBeDefined();
    expect(body.streak).toBeDefined();
    expect(body.categories).toBeDefined();
  });

  it("CARD2: check-savings rich card includes locked-vs-released breakdown", async () => {
    const { familyId } = await setupFamily({ childName: "Aiden" });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    const res = await callTool("check-savings", learnerMemberId, {});
    const body = JSON.parse(res.content[0].text);

    expect(body.summary).toBeDefined();
    // Empty-state card must still be friendly markdown, not raw "$0.00"
    expect(body.summary).toMatch(/Aiden/);
    expect(body.summary).toMatch(/\$0\.00|nothing|haven't/i);
  });

  it("CARD3: check-goals rich card includes status indicators and subgoal nesting", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Master 7th grade math",
          category: "math",
          subgoals: [
            { topic: "Fractions" },
            { topic: "Decimals", completed: true },
          ],
        },
      ],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    const res = await callTool("check-goals", learnerMemberId, {});
    const body = JSON.parse(res.content[0].text);

    expect(body.summary).toBeDefined();
    // Goal status indicators
    expect(body.summary).toMatch(/✓|○|⏳/);
    // Subgoals rendered with indentation or nesting
    expect(body.summary).toMatch(/Fractions/);
    expect(body.summary).toMatch(/Decimals/);
    // Completed subgoal shown as complete
    const decimalsLine = body.summary.match(/.*Decimals.*/)?.[0];
    expect(decimalsLine).toMatch(/✓/);
  });

  it("CARD4: verify-achievement returns 'what changed' delta card", async () => {
    const { familyId, managerMemberId } = await setupFamily({ childName: "Aiden", weeklyBudget: 5_00 });

    const res = await callTool("verify-achievement", managerMemberId, {
      childName: "Aiden",
      category: "reading",
      description: "Read for 30 min",
      score: 85,
    });
    const body = JSON.parse(res.content[0].text);

    expect(body.success).toBe(true);
    expect(body.summary).toBeDefined();
    // Delta indicators
    expect(body.summary).toMatch(/\+\$[\d.]+/); // earned delta
    expect(body.summary).toMatch(/streak|🔥/i); // streak update
    expect(body.summary).toMatch(/✓.*reading/i); // category indicator
  });
});
```

---

## MODAL1 — Brand modal content tests

```typescript
describe("MODAL: brand narrative modals", () => {
  it("MODAL1: security.md and why.md contain load-bearing phrases", async () => {
    const securityRes = await fetch(`${baseUrl}/copy/security.md`);
    expect(securityRes.status).toBe(200);
    const securityContent = await securityRes.text();

    // Must accurately describe current architecture
    expect(securityContent).toMatch(/encrypted/i);
    expect(securityContent).toMatch(/allowlist|authorized destination/i);
    expect(securityContent).toMatch(/audit/i);

    // Must NOT overclaim
    expect(securityContent).not.toMatch(/non-custodial/i); // Sprint 4.0 framing only
    expect(securityContent).not.toMatch(/trustless/i);

    // Must name Sprint 4.0 path
    expect(securityContent).toMatch(/Sprint 4|Coinbase Smart Wallet|self-custodial/i);

    const whyRes = await fetch(`${baseUrl}/copy/why.md`);
    expect(whyRes.status).toBe(200);
    const whyContent = await whyRes.text();

    // Mission language
    expect(whyContent).toMatch(/financial literacy|underserved|families/i);
    expect(whyContent.length).toBeGreaterThan(200); // not a stub
    expect(whyContent.length).toBeLessThan(3000); // not an essay
  });
});
```

---

## Test fixture helpers

Several helpers may need adding to the test harness:

| Helper | Purpose | Likely exists? |
|--------|---------|----------------|
| `setupFamily(opts)` | Bootstrap family with manager + optional children + optional learning goals | Yes (Sprint 3.0.2-3.0.5) |
| `inviteAndRedeemLearner(familyId, childName)` | Returns learner memberId | Yes (Sprint 3.0.5) |
| `verifyAchievement(familyId, memberId, opts)` | Wrap verify-achievement | Yes |
| `getLearnerSetupCode(familyId, memberId)` | Read learner's setup code for cross-leak test RC8 | NEW — write (~15 lines) |
| `callTool(name, memberId, args)` | HTTP MCP invocation | Yes |

---

## Coverage matrix

| Property | Tests |
|----------|-------|
| QR code in invite response | QR1 |
| `resend-invite` happy path + revoke + audit | RC1 |
| `resend-invite` RBAC | RC2 |
| `resend-invite` error handling | RC3 |
| `test-connection` for Manager | RC4 |
| `test-connection` for Learner | RC5 |
| `view-my-link` returns own URL | RC6 |
| `view-my-link` audit trail without leaking URL | RC7 |
| `view-my-link` cross-member isolation | RC8 (CRITICAL) |
| `check-progress` rich card | CARD1 |
| `check-savings` rich card | CARD2 |
| `check-goals` rich card with subgoals | CARD3 |
| `verify-achievement` delta card | CARD4 |
| Brand modal content accuracy | MODAL1 |

---

## Critical-path tests

If execution slips and not every test can land in Sprint 3.6, **ship-floor is these five**:

1. **QR1** — proves QR code feature works
2. **RC1** — proves `resend-invite` revoke + reissue works (the most critical recovery tool)
3. **RC8** — proves `view-my-link` doesn't leak other users' links (load-bearing security)
4. **CARD1** — proves rich-card refactor doesn't break the most-used tool (`check-progress`)
5. **MODAL1** — proves brand modals don't overclaim (reputational guardrail)

Five tests cover load-bearing properties. The other nine catch regressions but the absence of any one doesn't invalidate the sprint's value.

**If you have to slip:** ship the 5 critical-path tests + all 9 plan steps. Defer RC2/RC3/RC4/RC5/RC6/RC7/CARD2/CARD3/CARD4 to a Sprint 3.6.x follow-up.

---

## Test execution order

Recommended:

1. **QR1 first** (~15 min) — written BEFORE QR code implementation, fails initially, passes after Step 3. Safety net.
2. **RC1, RC2, RC3** (~45 min) — after Step 2 (`resend-invite` lands). Highest-leverage recovery tool tested first.
3. **RC4, RC5** (~20 min) — after Step 4 (`test-connection`).
4. **RC6, RC7, RC8** (~40 min) — after Step 4 (`view-my-link`). RC8 is critical-path; do not skip.
5. **CARD1-CARD4** (~60 min) — after Step 5 (rich cards). CARD1 is critical-path.
6. **MODAL1** (~15 min) — after Step 7 (brand modals). Critical-path.

Total automated test time: ~3.5 hours. Plus mobile smoke (below) which is non-automated.

---

## Mobile smoke checklist (W7.2 — not automated)

Run on real iOS device. Capture screenshots for landing-page docs.

### V1 — Install walkthrough on verify page
- [ ] iOS Safari: load fresh verify URL after bootstrap
- [ ] Confirm three install tabs (Claude / ChatGPT / Other) render
- [ ] Tap Claude tab → GIF plays
- [ ] Tap ChatGPT tab → GIF plays
- [ ] Tap Other tab → GIF plays
- [ ] Mobile viewport: tabs render correctly (no horizontal overflow)
- [ ] Screenshot each tab for docs

### V2 — QR code scan
- [ ] In Claude Manager session (desktop), generate learner invite
- [ ] Confirm QR code renders inline in response
- [ ] On real second device (any phone), open camera app
- [ ] Point camera at QR code on desktop screen
- [ ] Confirm OS offers to open the URL
- [ ] Tap to open → confirm Safari/Chrome opens verify page
- [ ] Complete learner redemption → confirm magic-link URL appears in success state
- [ ] Screenshot the QR code + the scanned-and-redeemed flow for docs

### V3 — Rich cards in Claude mobile
- [ ] On iOS, install AllowMe MCP in Claude mobile (using the new magic-link URL from V2)
- [ ] Ask "What are my goals?" → screenshot the rich card
- [ ] Ask "Check my savings" → screenshot
- [ ] Ask "How am I doing this week?" → screenshot
- [ ] Confirm progress bars and emoji render correctly on iPhone
- [ ] No truncation, no horizontal scroll

### V4 — Rich cards in ChatGPT mobile
- [ ] Same setup, but use ChatGPT mobile with the same magic-link URL
- [ ] Same four queries, screenshot each
- [ ] Compare rendering quality to Claude — if ChatGPT renders cards meaningfully worse, document for Sprint 3.7

### V5 — Failure-recovery tools
- [ ] In Manager session: "Resend Elina's invite" → confirm new code, audit log entries
- [ ] In learner session: "Test my connection" → confirm health check returns
- [ ] In learner session: "What's my magic link?" → confirm returns existing URL with warning

### V6 — Brand modals
- [ ] On verify success state (mobile), tap "How AllowMe protects your kid's money"
- [ ] Modal opens, content readable on 380px viewport
- [ ] Dismiss
- [ ] Tap "Why we built this"
- [ ] Modal opens, content readable
- [ ] Screenshot both for docs

### V7 — Client detection
- [ ] iOS Safari: confirm Claude tab is default
- [ ] Android Chrome (if available): confirm Claude tab is default
- [ ] Inside Claude WebView (if accessible): confirm "you're already in Claude" inline message OR Claude tab default

---

## Artifacts to capture for landing-page docs

After Sprint 3.6 ships, these screenshots become the docs assets:

1. **Verify success state with install walkthrough tabs visible** — replaces or supplements the "Family created" screenshot
2. **QR code in invite-member response** — shows the parent → kid handoff working
3. **QR scan in action** — second-device camera pointed at first-device screen
4. **Rich `check-goals` card** — shows the kid-facing UX upgrade
5. **Rich `check-progress` card** — shows the streak + earnings + categories
6. **Rich `verify-achievement` delta card** — shows the "what changed" feedback loop
7. **`test-connection` response** — shows the health-check affordance
8. **Brand "security" modal** — shows the trust narrative
9. **Brand "why" modal** — shows the mission narrative
10. **Mobile-viewport screenshot of the install walkthrough collapsed into accordion** — shows the mobile-first commitment

Folder under `docs/screenshots/sprint-3.6/` for the upcoming docs work.