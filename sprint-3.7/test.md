# Sprint 3.7 — Test Specifications

## Test inventory

| Suite | Count | Location | Purpose |
|-------|-------|----------|---------|
| U1-U4 | 4 | `tests/url-design.test.ts` (NEW) | New `/join/:code` route + backward-compat |
| AM1-AM7 | 7 | `tests/subgoal-matcher.test.ts` (NEW) | Subgoal auto-completion logic + audit + RBAC |
| MODAL1-ext | 1 | `tests/brand-modals.test.ts` (extend) | Founder bio paragraph present in why.md |

**Total automated tests added: 12.** Test count goes from 377+ → 389+.

The mobile smoke (V1-V4 in progress-3.7.md) is non-automated and gates Definition of Done.

---

## U1-U4 — URL design tests

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer } from "./helpers/server.js";
import { setupFamily } from "./helpers/setup.js";
import { callTool } from "./helpers/mcp.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

describe("U: URL design", () => {
  it("U1: new /join/:code form resolves correctly with role from invite record", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      familyName: "Isaac Family",
    });

    // Generate a learner invite
    const inviteRes = await callTool("invite-member", managerMemberId, {
      role: "learner",
      childName: "Aiden",
    });
    const inviteBody = JSON.parse(inviteRes.content[0].text);
    const code = inviteBody.inviteCode;

    // Confirm the response URL is the new form
    expect(inviteBody.verifyUrl).toMatch(/\/join\/[A-Z]+-[A-Z]+-[A-Z0-9]+$/);
    expect(inviteBody.verifyUrl).not.toContain("?invite=");
    expect(inviteBody.verifyUrl).not.toContain("&role=");

    // Hit the new route
    const pageRes = await fetch(`${baseUrl}/join/${code}`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toMatch(/Isaac Family/);
    expect(html).toMatch(/Learner|learner/i);
    expect(html).toMatch(/Aiden/);
  });

  it("U2: old /verify?invite=...&role=... form still resolves (backward compat) — CRITICAL", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      familyName: "Isaac Family",
    });

    const inviteRes = await callTool("invite-member", managerMemberId, {
      role: "learner",
      childName: "Aiden",
    });
    const code = JSON.parse(inviteRes.content[0].text).inviteCode;

    // Hit the OLD route
    const pageRes = await fetch(`${baseUrl}/verify?invite=${code}&role=learner`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toMatch(/Isaac Family/);
    expect(html).toMatch(/Learner|learner/i);
    expect(html).toMatch(/Aiden/);
  });

  it("U3: invite record's role is source of truth (URL queryparam ignored if different)", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      familyName: "Isaac Family",
    });

    // Generate a LEARNER invite
    const inviteRes = await callTool("invite-member", managerMemberId, {
      role: "learner",
      childName: "Aiden",
    });
    const code = JSON.parse(inviteRes.content[0].text).inviteCode;

    // Hit old route with WRONG role queryparam (caller asserts co-parent, record says learner)
    const pageRes = await fetch(`${baseUrl}/verify?invite=${code}&role=co-parent`);
    const html = await pageRes.text();
    // Record wins: should still render as learner
    expect(html).toMatch(/Learner|learner/i);
    expect(html).not.toMatch(/Co-parent.*role: Co-parent/i);
  });

  it("U4: malformed code returns clean 404 (not stack trace)", async () => {
    const malformedCodes = [
      "MALFORMED",
      "../etc/passwd",
      "DROP%20TABLE",
      "",
    ];

    for (const malformed of malformedCodes) {
      const pageRes = await fetch(`${baseUrl}/join/${encodeURIComponent(malformed)}`);
      // Either 404 or 400 acceptable; 500 is not
      expect([400, 404]).toContain(pageRes.status);
      const html = await pageRes.text();
      expect(html).not.toMatch(/stack trace|TypeError|at \w+\.\w+/i);
      expect(html).toMatch(/invite not found|invalid|expired/i);
    }
  });
});
```

---

## AM1-AM7 — Subgoal matcher tests

```typescript
import { describe, it, expect } from "vitest";
import { setupFamily } from "./helpers/setup.js";
import { callTool } from "./helpers/mcp.js";
import { StateManager } from "../src/engine/state.js";

let state: StateManager;

describe("AM: Subgoal auto-matching", () => {
  beforeAll(() => {
    state = new StateManager();
  });

  it("AM1: exact substring match auto-completes subgoal with audit entry", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      weeklyBudget: 5_00,
      learningGoals: [
        {
          topic: "Read about history",
          category: "reading",
          subgoals: [
            { topic: "Ancient Greece reading", completed: false },
            { topic: "Roman empire history", completed: false },
          ],
        },
      ],
    });

    // Achievement description contains the subgoal topic as substring
    const achievementRes = await callTool("verify-achievement", managerMemberId, {
      childName: "Aiden",
      category: "reading",
      description: "Read 30 minutes about Ancient Greece reading",
      score: 85,
    });

    const body = JSON.parse(achievementRes.content[0].text);
    expect(body.success).toBe(true);

    // Subgoal flipped to completed in family config
    const config = await state.loadFamilyConfig(familyId);
    const goal = config?.children[0].learningGoals?.[0];
    const subgoal = goal?.subgoals?.find((s) => s.topic === "Ancient Greece reading");
    expect(subgoal?.completed).toBe(true);

    // Other subgoal still not completed
    const otherSubgoal = goal?.subgoals?.find((s) => s.topic === "Roman empire history");
    expect(otherSubgoal?.completed).toBe(false);

    // Audit entry
    const audit = await state.loadAuditLog(familyId);
    const entry = audit.find((e) => e.action === "subgoal-auto-completed");
    expect(entry).toBeDefined();
    expect(entry?.metadata).toMatchObject({
      subgoalTopic: "Ancient Greece reading",
      matchType: "substring",
    });
    expect(entry?.metadata?.confidence).toBeGreaterThanOrEqual(0.85);

    // Response card includes auto-completion announcement
    expect(body.summary).toMatch(/subgoal.*completed.*Ancient Greece reading/i);
  });

  it("AM2: high-confidence fuzzy match (≥0.85) auto-completes subgoal", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Read about history",
          category: "reading",
          subgoals: [
            { topic: "Ancient Greece reading", completed: false },
          ],
        },
      ],
    });

    // Achievement description is similar but not exact substring
    const achievementRes = await callTool("verify-achievement", managerMemberId, {
      childName: "Aiden",
      category: "reading",
      description: "I read about Ancient Greece for 30 min",
      score: 85,
    });

    const body = JSON.parse(achievementRes.content[0].text);
    expect(body.success).toBe(true);

    const config = await state.loadFamilyConfig(familyId);
    const subgoal = config?.children[0].learningGoals?.[0].subgoals?.[0];
    expect(subgoal?.completed).toBe(true);
  });

  it("AM3: ambiguous match (0.65-0.85) surfaces hint but does NOT auto-complete", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Read about history",
          category: "reading",
          subgoals: [
            { topic: "Ancient Greece reading", completed: false },
          ],
        },
      ],
    });

    // Achievement is in-domain but not specific to the subgoal
    const achievementRes = await callTool("verify-achievement", managerMemberId, {
      childName: "Aiden",
      category: "reading",
      description: "Read a chapter about ancient civilizations today",
      score: 80,
    });

    const body = JSON.parse(achievementRes.content[0].text);

    // Subgoal NOT auto-completed
    const config = await state.loadFamilyConfig(familyId);
    const subgoal = config?.children[0].learningGoals?.[0].subgoals?.[0];
    expect(subgoal?.completed).toBe(false);

    // BUT response surfaces possible match hint
    expect(body.summary).toMatch(/possible.*match|might be|ask.*parent/i);

    // No `subgoal-auto-completed` audit entry
    const audit = await state.loadAuditLog(familyId);
    const entry = audit.find((e) => e.action === "subgoal-auto-completed");
    expect(entry).toBeUndefined();
  });

  it("AM4: low-similarity match (<0.65) stays silent — no auto-completion, no hint", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Read about history",
          category: "reading",
          subgoals: [
            { topic: "Ancient Greece reading", completed: false },
          ],
        },
      ],
    });

    // Achievement totally unrelated to subgoal topic (but same category)
    const achievementRes = await callTool("verify-achievement", managerMemberId, {
      childName: "Aiden",
      category: "reading",
      description: "Read a comic book about robots",
      score: 75,
    });

    const body = JSON.parse(achievementRes.content[0].text);

    const config = await state.loadFamilyConfig(familyId);
    const subgoal = config?.children[0].learningGoals?.[0].subgoals?.[0];
    expect(subgoal?.completed).toBe(false);

    // No subgoal hint in response
    expect(body.summary).not.toMatch(/Ancient Greece reading/);
  });

  it("AM5: already-completed subgoal does not double-fire", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Read about history",
          category: "reading",
          subgoals: [
            { topic: "Ancient Greece reading", completed: true }, // pre-completed
          ],
        },
      ],
    });

    const achievementRes = await callTool("verify-achievement", managerMemberId, {
      childName: "Aiden",
      category: "reading",
      description: "Read more about Ancient Greece reading today",
      score: 85,
    });

    // No new subgoal-auto-completed audit entry (was already complete)
    const audit = await state.loadAuditLog(familyId);
    const entries = audit.filter((e) => e.action === "subgoal-auto-completed");
    expect(entries.length).toBe(0);

    // Response does NOT include subgoal completion announcement
    const body = JSON.parse(achievementRes.content[0].text);
    expect(body.summary).not.toMatch(/subgoal.*completed.*Ancient Greece/i);
  });

  it("AM6: false-positive prevention — unrelated achievement does NOT auto-complete subgoal (CRITICAL)", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Read about history",
          category: "reading",
          subgoals: [
            { topic: "Ancient Greece reading", completed: false },
          ],
        },
      ],
    });

    // Wrong category — should be filtered out before fuzzy match even runs
    const achievementResWrongCategory = await callTool("verify-achievement", managerMemberId, {
      childName: "Aiden",
      category: "math",
      description: "Did math homework about ancient Greek philosophers",
      score: 90,
    });

    let config = await state.loadFamilyConfig(familyId);
    let subgoal = config?.children[0].learningGoals?.[0].subgoals?.[0];
    expect(subgoal?.completed).toBe(false);

    // Right category but unrelated content — no match
    const achievementResUnrelated = await callTool("verify-achievement", managerMemberId, {
      childName: "Aiden",
      category: "reading",
      description: "Read a Goosebumps book",
      score: 80,
    });

    config = await state.loadFamilyConfig(familyId);
    subgoal = config?.children[0].learningGoals?.[0].subgoals?.[0];
    expect(subgoal?.completed).toBe(false);

    // No audit entries for subgoal completion
    const audit = await state.loadAuditLog(familyId);
    const entries = audit.filter((e) => e.action === "subgoal-auto-completed");
    expect(entries.length).toBe(0);
  });

  it("AM7: parent manual completion via configure-policy works after auto-completion (idempotency)", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Read about history",
          category: "reading",
          subgoals: [
            { topic: "Ancient Greece reading", completed: false },
            { topic: "Roman empire history", completed: false },
          ],
        },
      ],
    });

    // Auto-complete first subgoal via verify-achievement
    await callTool("verify-achievement", managerMemberId, {
      childName: "Aiden",
      category: "reading",
      description: "Read about Ancient Greece reading for 30 min",
      score: 85,
    });

    // Confirm first subgoal auto-completed
    let config = await state.loadFamilyConfig(familyId);
    expect(config?.children[0].learningGoals?.[0].subgoals?.[0].completed).toBe(true);
    expect(config?.children[0].learningGoals?.[0].subgoals?.[1].completed).toBe(false);

    // Manager manually completes second subgoal via configure-policy
    await callTool("configure-policy", managerMemberId, {
      familyName: "Isaac Family",
      children: [
        {
          name: "Aiden",
          weeklyBudget: 5_00,
          categories: [{ name: "reading", pct: 100, budget: 5_00 }],
          savingsPercent: 20,
          learningGoals: [
            {
              topic: "Read about history",
              category: "reading",
              subgoals: [
                { topic: "Ancient Greece reading", completed: true }, // already complete from AM auto
                { topic: "Roman empire history", completed: true },   // now manually complete
              ],
            },
          ],
        },
      ],
    });

    config = await state.loadFamilyConfig(familyId);
    expect(config?.children[0].learningGoals?.[0].subgoals?.[0].completed).toBe(true);
    expect(config?.children[0].learningGoals?.[0].subgoals?.[1].completed).toBe(true);

    // No errors thrown; idempotent path works
  });
});
```

---

## MODAL1 extension — Founder bio assertion

Update existing test in `tests/brand-modals.test.ts`:

```typescript
// In the existing MODAL1 test, add:
expect(whyContent).toMatch(/Juan Isaac|founder|built by/i);
expect(whyContent).toMatch(/security researcher|CDP Ambassador|Coinbase/i);
expect(whyContent).toMatch(/financial literacy|AI education|charter|families/i);
```

The extension keeps MODAL1 as one test but adds the founder-bio-specific assertions inline. Total test count delta: 0 (it's the same test, expanded).

---

## Coverage matrix

| Property | Tests |
|----------|-------|
| New `/join/:code` URL form works | U1 |
| Old `/verify?invite=...&role=...` backward compat | U2 (CRITICAL) |
| Role-from-record source of truth | U3 |
| Clean error on malformed code | U4 |
| Exact substring match auto-completes | AM1 |
| Fuzzy match ≥0.85 auto-completes | AM2 |
| Ambiguous match (0.65-0.85) surfaces hint but doesn't auto-complete | AM3 |
| Low-similarity stays silent | AM4 |
| Already-completed subgoals don't double-fire | AM5 |
| False-positive prevention (CRITICAL) | AM6 |
| Manual + auto coexistence (idempotency) | AM7 |
| Founder bio present in brand modal copy | MODAL1-ext |

---

## Critical-path tests

If execution slips and not every test can land in Sprint 3.7, **ship-floor is these four**:

1. **U2** — backward compat for old URL form. Reputation-critical.
2. **AM6** — false-positive prevention. The single most important matcher property.
3. **U1** — new URL form works end-to-end.
4. **AM1** — happy-path matcher confirmation.

Four tests cover the load-bearing behavior. The remaining eight catch regressions in detail but aren't load-bearing for the sprint's core value.

**If you have to slip:** ship the 4 critical-path tests + all 8 plan steps. Defer U3/U4/AM2/AM3/AM4/AM5/AM7/MODAL1-ext to a Sprint 3.7.x follow-up.

---

## Test execution order

Recommended:

1. **U2 first** (~15 min) — backward-compat regression. Write BEFORE changing the URL routes; should pass against current code. Run after new route lands; must still pass.
2. **U1** (~15 min) — after Step 2 (URL design pass).
3. **U3, U4** (~15 min) — after Step 1 (route handler).
4. **AM1 first among matcher tests** (~15 min) — after Step 4 (matcher core). Happy path proves the wiring.
5. **AM6** (~15 min) — false-positive prevention. CRITICAL. Don't skip even under time pressure.
6. **AM2, AM3, AM4, AM5, AM7** (~45 min) — after Step 5 (matcher wiring).
7. **MODAL1 extension** (~5 min) — after Step 7 (founder bio drafted).

Total automated test time: ~2 hours. Plus mobile smoke (V1-V4) which is non-automated.

---

## Artifacts to capture for docs

After Sprint 3.7 ships, these are the additional docs artifacts beyond Sprint 3.6:

- [ ] Screenshot of Manager invite-member response showing the new `/join/CODE` URL form (replaces / supplements the prior screenshot)
- [ ] Screenshot of `verify-achievement` response card showing "✨ Subgoal completed: ..." auto-completion announcement
- [ ] Screenshot of `check-goals` response showing a subgoal as ✓ after auto-completion (compare to pre-auto-completion state)
- [ ] Screenshot of brand modal showing the founder bio
- [ ] Audit log excerpt (terminal/SSH output) showing a `subgoal-auto-completed` entry

These five artifacts close out the design-completeness narrative for the landing-page docs.