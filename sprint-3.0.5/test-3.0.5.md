# Sprint 3.0.5 — Test Specifications

## Test inventory

| Suite | Count | Location | Purpose |
|-------|-------|----------|---------|
| FB1 | 1 (LOAD-BEARING) | `tests/verify-form-backcompat.test.ts` (NEW) or extend `tests/verify-routes.test.ts` | Old payload shape (no `walletAddress`, no `learningGoals`) still creates valid family |
| FB2-FB6 | 5 | same file | Payload serialization correctness for new fields |
| FB7-FB10 | 4 | same file | Round-trip from form payload → `loadFamilyConfig` → `check-goals` tool |
| FB11-FB12 | 2 | same file | Edge cases (empty goals filtered, deadline ISO conversion) |
| (manual) Mobile smoke | — | n/a | Real iOS device + Coinbase Wallet checklist |

**Total automated tests added: 12.** Test count goes from 363 → 375.

The mobile smoke checklist isn't automated — it's a manual run that the Definition of Done depends on. Captured at the end of this document.

---

## Why only 12 tests for a sprint this size

Sprint 3.0.5 is UI-only. Most "tests" for a form are either:
- Backend behavior tests, which already exist (Sprint 3.0.2-3.0.4 covers schema validation, allowlist auto-populate, `check-goals` output)
- End-to-end browser tests, which would need a real browser harness this codebase doesn't have

The 12 tests focus on the **payload contract** at the `/api/configure-family` HTTP boundary. That's the layer where Sprint 3.0.5 introduces meaningful behavior change. If the payload that the new form posts is correctly handled by the backend and produces correctly-structured family data, the form is doing its job — the rest is visual/interaction work that mobile smoke validates.

If end-to-end browser tests become necessary later (Sprint 3.5+ pilot deployment), Playwright or similar can be added then. Not for this sprint.

---

## FB1 — Backward-compat regression (LOAD-BEARING)

This is the safety net. Write it BEFORE any form modifications. Run it after every step.

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer } from "./helpers/server.js";
import { siweSessionToken } from "./helpers/auth.js";
import { StateManager } from "../src/engine/state.js";

let baseUrl: string;
let state: StateManager;

beforeAll(async () => {
  baseUrl = await startTestServer();
  state = new StateManager();
});

afterAll(async () => {
  await stopTestServer();
});

describe("FB: form backward compatibility", () => {
  it("FB1: pre-3.0.5 form payload still creates valid family", async () => {
    const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();

    // Construct the OLD form's payload exactly — no walletAddress, no learningGoals
    const oldPayload = {
      familyName: "Asencio Family",
      children: [
        {
          name: "Sofia",
          weeklyBudget: 10_00, // $10 in cents → 6-decimal USDC handled server-side
          savingsPercent: 20,
          categories: [
            { name: "reading", pct: 40, budget: 4_00 },
            { name: "movement", pct: 35, budget: 35_0 },
            { name: "creativity", pct: 25, budget: 25_0 },
          ],
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/configure-family`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
      },
      body: JSON.stringify(oldPayload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      familyId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      magicLinkUrl: expect.stringContaining("?setup=SETUP-"),
    });

    // Load the family config and assert structure
    const config = await state.loadFamilyConfig(body.familyId);
    expect(config).toBeDefined();
    expect(config?.familyName).toBe("Asencio Family");
    expect(config?.children).toHaveLength(1);

    const child = config!.children[0];
    expect(child.name).toBe("Sofia");
    // Old payload didn't supply walletAddress — AllowMe creates one
    expect(child.walletAddress).toBeDefined();
    expect(child.walletAddress).toMatch(/^0x[a-f0-9]{40}$/);
    // No goals supplied
    expect(child.learningGoals ?? []).toEqual([]);

    // Sprint 3.0.2 allowlist auto-populated
    expect(config?.authorizedDestinations).toContain(adminWallet);
    expect(config?.authorizedDestinations).toContain(child.walletAddress);
  });
});
```

**Critical:** if this test fails at any point during the sprint, halt and fix. Do not continue with UI changes.

---

## FB2-FB6 — Payload serialization correctness

These tests post the NEW form's payload shapes and verify each new field persists correctly.

### FB2 — `walletAddress` per child

```typescript
it("FB2: walletAddress in payload persists to ChildConfig", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();
  const sofiaWallet = "0x1111111111111111111111111111111111111111";

  const payload = {
    familyName: "Asencio Family",
    children: [
      {
        name: "Sofia",
        walletAddress: sofiaWallet,
        weeklyBudget: 10_00,
        savingsPercent: 20,
        categories: [{ name: "reading", pct: 100, budget: 10_00 }],
      },
    ],
  };

  const res = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify(payload),
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  const config = await state.loadFamilyConfig(body.familyId);
  expect(config?.children[0].walletAddress).toBe(sofiaWallet.toLowerCase());

  // Sprint 3.0.2 allowlist must include the supplied wallet
  expect(config?.authorizedDestinations).toContain(sofiaWallet.toLowerCase());
});
```

### FB3 — Single learning goal without subgoals or deadline

```typescript
it("FB3: minimal learning goal persists correctly", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();

  const payload = {
    familyName: "Isaac Family",
    children: [
      {
        name: "Aiden",
        weeklyBudget: 5_00,
        savingsPercent: 20,
        categories: [{ name: "reading", pct: 100, budget: 5_00 }],
        learningGoals: [
          {
            topic: "Read 10 books this quarter",
            category: "reading",
            completed: false,
          },
        ],
      },
    ],
  };

  const res = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify(payload),
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  const config = await state.loadFamilyConfig(body.familyId);
  const goals = config?.children[0].learningGoals;
  expect(goals).toHaveLength(1);
  expect(goals![0]).toMatchObject({
    topic: "Read 10 books this quarter",
    category: "reading",
    completed: false,
  });
  expect(goals![0].subgoals).toBeUndefined();
  expect(goals![0].deadline).toBeUndefined();
});
```

### FB4 — Learning goal with subgoals

```typescript
it("FB4: learning goal with subgoals persists with completed:false on each", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();

  const payload = {
    familyName: "Isaac Family",
    children: [
      {
        name: "Aiden",
        weeklyBudget: 5_00,
        savingsPercent: 20,
        categories: [{ name: "math", pct: 100, budget: 5_00 }],
        learningGoals: [
          {
            topic: "Catch up to 7th-grade math",
            category: "math",
            completed: false,
            subgoals: [
              { topic: "Master fractions", completed: false },
              { topic: "Master decimals", completed: false },
              { topic: "Master ratios", completed: false },
              { topic: "Pre-algebra basics", completed: false },
            ],
          },
        ],
      },
    ],
  };

  const res = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify(payload),
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  const config = await state.loadFamilyConfig(body.familyId);
  const goal = config?.children[0].learningGoals?.[0];
  expect(goal?.subgoals).toHaveLength(4);
  expect(goal?.subgoals?.[0]).toEqual({ topic: "Master fractions", completed: false });
  expect(goal?.subgoals?.[3]).toEqual({ topic: "Pre-algebra basics", completed: false });
});
```

### FB5 — Learning goal with deadline persists as ISO datetime

```typescript
it("FB5: deadline string persists in ISO datetime format", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();

  const payload = {
    familyName: "Isaac Family",
    children: [
      {
        name: "Aiden",
        weeklyBudget: 5_00,
        savingsPercent: 20,
        categories: [{ name: "math", pct: 100, budget: 5_00 }],
        learningGoals: [
          {
            topic: "Catch up by August 15",
            category: "math",
            completed: false,
            deadline: "2026-08-15T00:00:00.000Z", // form's date input → submit handler conversion
          },
        ],
      },
    ],
  };

  const res = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify(payload),
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  const config = await state.loadFamilyConfig(body.familyId);
  const goal = config?.children[0].learningGoals?.[0];
  expect(goal?.deadline).toBe("2026-08-15T00:00:00.000Z");

  // Parseable as a Date (sanity check)
  const parsed = new Date(goal!.deadline!);
  expect(parsed.getUTCFullYear()).toBe(2026);
  expect(parsed.getUTCMonth()).toBe(7); // August = 7 (0-indexed)
  expect(parsed.getUTCDate()).toBe(15);
});
```

### FB6 — Multiple children, mixed configurations

```typescript
it("FB6: two children with different configurations persist independently", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();
  const aidenWallet = "0x1111111111111111111111111111111111111111";

  const payload = {
    familyName: "Isaac Family",
    children: [
      {
        name: "Aiden",
        walletAddress: aidenWallet,
        weeklyBudget: 5_00,
        savingsPercent: 20,
        categories: [{ name: "math", pct: 100, budget: 5_00 }],
        learningGoals: [
          {
            topic: "Master algebra",
            category: "math",
            completed: false,
            subgoals: [{ topic: "Linear equations", completed: false }],
            deadline: "2026-08-15T00:00:00.000Z",
          },
        ],
      },
      {
        name: "Elina",
        // No walletAddress → AllowMe creates
        weeklyBudget: 3_00,
        savingsPercent: 20,
        categories: [{ name: "reading", pct: 100, budget: 3_00 }],
        // No goals
      },
    ],
  };

  const res = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify(payload),
  });

  expect(res.status).toBe(200);
  const body = await res.json();
  const config = await state.loadFamilyConfig(body.familyId);

  // Aiden has goals, supplied wallet
  const aiden = config?.children.find((c) => c.name === "Aiden");
  expect(aiden?.walletAddress).toBe(aidenWallet.toLowerCase());
  expect(aiden?.learningGoals).toHaveLength(1);
  expect(aiden?.learningGoals?.[0].subgoals).toHaveLength(1);
  expect(aiden?.learningGoals?.[0].deadline).toBe("2026-08-15T00:00:00.000Z");

  // Elina has no goals, auto-created wallet
  const elina = config?.children.find((c) => c.name === "Elina");
  expect(elina?.walletAddress).toMatch(/^0x[a-f0-9]{40}$/);
  expect(elina?.walletAddress).not.toBe(aidenWallet.toLowerCase());
  expect(elina?.learningGoals ?? []).toEqual([]);

  // Allowlist includes admin + both children's wallets
  expect(config?.authorizedDestinations).toContain(adminWallet);
  expect(config?.authorizedDestinations).toContain(aidenWallet.toLowerCase());
  expect(config?.authorizedDestinations).toContain(elina!.walletAddress);
  expect(config?.authorizedDestinations).toHaveLength(3);
});
```

---

## FB7-FB10 — Round-trip with `check-goals` tool

These confirm that what the form posts ends up being what `check-goals` returns to the kid.

### FB7 — `check-goals` returns goals configured at bootstrap

```typescript
it("FB7: check-goals returns goals configured via bootstrap form", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();

  // Bootstrap a family with goals
  const bootstrapRes = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify({
      familyName: "Isaac Family",
      children: [
        {
          name: "Aiden",
          weeklyBudget: 5_00,
          savingsPercent: 20,
          categories: [{ name: "math", pct: 100, budget: 5_00 }],
          learningGoals: [
            {
              topic: "Master algebra",
              category: "math",
              completed: false,
              subgoals: [{ topic: "Linear equations", completed: false }],
            },
          ],
        },
      ],
    }),
  });

  const { familyId } = await bootstrapRes.json();

  // Invite Aiden as learner, get his memberId via the invite-redemption flow
  const aidenMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

  // Call check-goals as Aiden (learner-scoped)
  const res = await callTool("check-goals", aidenMemberId, {});
  const result = JSON.parse(res.content[0].text);

  expect(result.success).toBe(true);
  expect(result.goals).toHaveLength(1);
  expect(result.goals[0].topic).toBe("Master algebra");
  expect(result.goals[0].category).toBe("math");
  expect(result.goals[0].subgoals).toHaveLength(1);
  expect(result.goals[0].subgoals[0].topic).toBe("Linear equations");
});
```

### FB8 — `check-goals` empty state when bootstrap omits goals

```typescript
it("FB8: check-goals returns empty-state copy when bootstrap had no goals", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();

  const bootstrapRes = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify({
      familyName: "Isaac Family",
      children: [
        {
          name: "Aiden",
          weeklyBudget: 5_00,
          savingsPercent: 20,
          categories: [{ name: "math", pct: 100, budget: 5_00 }],
          // No learningGoals
        },
      ],
    }),
  });

  const { familyId } = await bootstrapRes.json();
  const aidenMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

  const res = await callTool("check-goals", aidenMemberId, {});
  const result = JSON.parse(res.content[0].text);

  expect(result.success).toBe(true);
  // Sprint 3.0.3 empty-state copy for learner
  expect(result.message).toMatch(/parent hasn't set any learning goals/i);
});
```

### FB9 — Deadline urgency surfaced by `check-goals`

```typescript
it("FB9: check-goals daysUntilDeadline computed from form-supplied deadline", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();

  // Set a deadline 10 days from now
  const tenDaysFromNow = new Date(Date.now() + 10 * 86400_000)
    .toISOString()
    .split("T")[0] + "T00:00:00.000Z";

  const bootstrapRes = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify({
      familyName: "Isaac Family",
      children: [
        {
          name: "Aiden",
          weeklyBudget: 5_00,
          savingsPercent: 20,
          categories: [{ name: "math", pct: 100, budget: 5_00 }],
          learningGoals: [
            {
              topic: "Catch up to grade level",
              category: "math",
              completed: false,
              deadline: tenDaysFromNow,
            },
          ],
        },
      ],
    }),
  });

  const { familyId } = await bootstrapRes.json();
  const aidenMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

  const res = await callTool("check-goals", aidenMemberId, {});
  const result = JSON.parse(res.content[0].text);

  expect(result.goals[0].daysUntilDeadline).toBeGreaterThanOrEqual(9);
  expect(result.goals[0].daysUntilDeadline).toBeLessThanOrEqual(10);
});
```

### FB10 — BYO-wallet kid can receive distribution

```typescript
it("FB10: kid with parent-supplied wallet receives distribution successfully", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();
  const aidenWallet = "0x1111111111111111111111111111111111111111";

  const bootstrapRes = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify({
      familyName: "Isaac Family",
      children: [
        {
          name: "Aiden",
          walletAddress: aidenWallet,
          weeklyBudget: 5_00,
          savingsPercent: 20,
          categories: [{ name: "reading", pct: 100, budget: 5_00 }],
        },
      ],
    }),
  });

  const { familyId } = await bootstrapRes.json();
  const config = await state.loadFamilyConfig(familyId);
  const treasury = await getTreasuryAddress(familyId);

  await fundTreasury(treasury, 10_000_000n);

  // Verify achievement + distribute via Manager
  const managerMemberId = await getManagerMemberId(familyId);
  await callTool("verify-achievement", managerMemberId, {
    childName: "Aiden",
    category: "reading",
    score: 85,
  });

  const distributeRes = await callTool("distribute-allowance", managerMemberId, {
    childName: "Aiden",
  });
  const distributeResult = JSON.parse(distributeRes.content[0].text);

  expect(distributeResult.success).toBe(true);

  // Sprint 3.0.2 happy path — kid's parent-supplied wallet was on the
  // auto-populated allowlist, distribution succeeded
  const aidenBalance = await getUsdcBalance(aidenWallet);
  expect(aidenBalance).toBeGreaterThan(0n);
});
```

---

## FB11-FB12 — Edge cases

### FB11 — Empty-topic goals are filtered before persistence

This tests the form's serializer behavior (Step 7 in progress). A goal with an empty topic shouldn't make it to the backend at all — the form filters it out client-side.

Since this is browser behavior, the test approach is to assert that **a payload with empty-topic goals is treated as if those goals weren't there**. The form's filter is implementation; the backend's robustness to receiving (or not receiving) such goals is the contract.

```typescript
it("FB11: payload omitting empty-topic goals produces clean family config", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();

  // Form would filter these out client-side; assert the server-side equivalent
  const payload = {
    familyName: "Isaac Family",
    children: [
      {
        name: "Aiden",
        weeklyBudget: 5_00,
        savingsPercent: 20,
        categories: [{ name: "reading", pct: 100, budget: 5_00 }],
        learningGoals: [
          {
            topic: "Real goal",
            category: "reading",
            completed: false,
          },
        ],
      },
    ],
  };

  const res = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify(payload),
  });

  const { familyId } = await res.json();
  const config = await state.loadFamilyConfig(familyId);
  expect(config?.children[0].learningGoals).toHaveLength(1);
  expect(config?.children[0].learningGoals?.[0].topic).toBe("Real goal");
});
```

**Note:** the form's filter behavior should also be manually verified during Step 7 development. A unit test on the serializer function (if extracted) would be more thorough; for Sprint 3.0.5's scope, the contract test above suffices.

### FB12 — Wallet address lowercase normalization on persist

```typescript
it("FB12: checksummed wallet address from form is stored lowercase", async () => {
  const adminWallet = "0xAdminWallet0000000000000000000000000000000".toLowerCase();
  // Checksummed (uppercase hex) form — viem's isAddress accepts this
  const aidenWalletChecksummed = "0x1111111111111111111111111111111111111111".toUpperCase();
  const aidenWalletLower = aidenWalletChecksummed.toLowerCase();

  const res = await fetch(`${baseUrl}/api/configure-family`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${siweSessionToken(adminWallet)}`,
    },
    body: JSON.stringify({
      familyName: "Isaac Family",
      children: [
        {
          name: "Aiden",
          walletAddress: aidenWalletChecksummed,
          weeklyBudget: 5_00,
          savingsPercent: 20,
          categories: [{ name: "reading", pct: 100, budget: 5_00 }],
        },
      ],
    }),
  });

  expect(res.status).toBe(200);
  const { familyId } = await res.json();
  const config = await state.loadFamilyConfig(familyId);

  expect(config?.children[0].walletAddress).toBe(aidenWalletLower);
  expect(config?.authorizedDestinations).toContain(aidenWalletLower);
});
```

---

## Test fixture helpers

These may need to be added if not already present:

| Helper | Purpose | Likely exists? |
|--------|---------|----------------|
| `siweSessionToken(walletAddress)` | Mint fake SIWE session token | Should — used by FB tests in Sprint 3.0.2 (AL6-AL15) |
| `inviteAndRedeemLearner(familyId, childName)` | Bootstrap a learner Member, return memberId | Maybe — write if absent (~15 lines) |
| `getManagerMemberId(familyId)` | Look up manager memberId in MemberIndex | Should — used elsewhere |
| `getTreasuryAddress(familyId)` | Resolve via OWS wallet name `treasury` | Maybe |
| `fundTreasury(addr, amount)` | Send testnet USDC | Maybe |
| `getUsdcBalance(addr)` | Read Base Sepolia USDC balance | Maybe |
| `callTool(toolName, memberId, args)` | HTTP MCP tool invocation | Yes (HE tests) |

If `inviteAndRedeemLearner` doesn't exist, write it once at the top of the test file:

```typescript
async function inviteAndRedeemLearner(familyId: string, childName: string): Promise<string> {
  // Generate learner invite via the appropriate state-manipulation helper
  // (in production: invite-member tool; in tests: direct state mutation)
  const inviteCode = await generateInviteForTest(familyId, {
    role: "learner",
    childName,
  });

  const res = await fetch(`${baseUrl}/api/redeem-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inviteCode, name: childName }),
  });

  const body = await res.json();
  return body.memberId;
}
```

---

## Coverage matrix

| Property | Tests |
|----------|-------|
| Backward compat — old payload still works | FB1 (CRITICAL) |
| `walletAddress` field persists | FB2, FB6, FB12 |
| Single goal persists | FB3 |
| Goal with subgoals persists | FB4 |
| Goal with deadline persists as ISO | FB5 |
| Multiple children with mixed configs | FB6 |
| Round-trip: bootstrap → `check-goals` | FB7, FB8 |
| Deadline computation downstream | FB9 |
| Sprint 3.0.2 BYO-wallet end-to-end | FB10 |
| Form filter correctness (contract) | FB11 |
| Wallet case normalization | FB12 |

---

## Critical-path tests

If execution slips and not every test can land in Sprint 3.0.5, **ship-floor is these four**:

1. **FB1** — backward compat. The single most important test in the sprint.
2. **FB3** — single goal persistence. Proves the central feature works at all.
3. **FB7** — round-trip with `check-goals`. Proves the form actually enables what 3.0.3 shipped.
4. **FB10** — BYO-wallet → distribution. Proves the form actually enables what 3.0.2 shipped.

Four tests cover the load-bearing behavior. FB2/FB4/FB5/FB6/FB8/FB9/FB11/FB12 are all important but defensive — they catch regressions in details that the four critical-path tests would also fail if the central behavior were broken.

**If you have to slip:** ship the 4 critical-path tests + all 12 plan steps. Defer FB2/FB4/FB5/FB6/FB8/FB9/FB11/FB12 to a Sprint 3.0.5.x follow-up.

---

## Test execution order

Recommended sequence when writing:

1. **FB1 first** (~25 min). Safety net. Run it against the existing form before any modification. Confirm green. This is plan Step 1.
2. **FB3** (~15 min). After Step 3 (goals section) lands. Confirms single-goal persistence works end-to-end.
3. **FB4, FB5** (~20 min). After Steps 4 and 5 (subgoals, deadline) land.
4. **FB2** (~15 min). After Step 2 (wallet field) lands.
5. **FB6, FB12** (~25 min). Compound cases after Step 7 (serializer) lands.
6. **FB7, FB8, FB9** (~45 min). After Step 9 (allowlist panel) — these need the helper `inviteAndRedeemLearner` and exercise the full round-trip.
7. **FB10** (~20 min). End-to-end distribution; needs treasury funding setup.
8. **FB11** (~10 min). Contract test, cheap.

Total: ~3 hours for tests. Plus 5 hours of plan implementation = ~8 hours total sprint, slightly over the 5-hour estimate to account for test development.

---

## Mobile smoke checklist (W6.1 in plan — not automated)

Run on a real iOS device with Coinbase Wallet installed. Capture screenshots.

### Bootstrap with goals

- [ ] Open `https://allowme.dev/verify` on iOS Safari
- [ ] Sign in with Base button → Coinbase Wallet popup → approve signature
- [ ] Family-creation form renders with the new fields visible
- [ ] Type family name
- [ ] Type child name
- [ ] **NEW:** type kid's wallet address (use your test wallet for round-trip later) — confirm inline validation accepts a valid address
- [ ] **NEW:** try a malformed wallet (e.g., "0x123") — confirm inline error
- [ ] Type weekly budget, savings %
- [ ] Add categories (reading 40%, movement 35%, creativity 25%)
- [ ] **NEW:** tap "+ Add learning goal"
- [ ] **NEW:** type goal topic
- [ ] **NEW:** category dropdown — confirm it shows the three categories you just configured
- [ ] **NEW:** pick a category
- [ ] **NEW:** tap "+ Add subgoal" twice, type two subgoal topics
- [ ] **NEW:** tap deadline field — confirm iOS native date picker appears
- [ ] **NEW:** pick a date
- [ ] **NEW:** tap "+ Add learning goal" four more times to reach 5 — confirm button disables after 5
- [ ] Remove one goal — confirm button re-enables
- [ ] Submit form
- [ ] **NEW:** allowlist transparency panel renders before magic-link URL
- [ ] Panel shows admin wallet + kid wallet correctly labeled
- [ ] Continue button reveals magic-link URL
- [ ] Copy magic-link URL

### Round-trip validation

- [ ] Open Claude on iOS, add connector with the magic-link URL
- [ ] Send: "What are my goals?"
- [ ] **CONFIRM:** goals + subgoals + deadline all returned correctly
- [ ] Send: "What's the treasury address?"
- [ ] Get the treasury address, fund with Base Sepolia USDC + ETH
- [ ] Send: "Aiden read for 30 minutes today, score 85, reading"
- [ ] Send: "Send Aiden his allowance"
- [ ] Confirm transaction succeeds; check basescan.org for USDC transfer to the kid wallet address you supplied at bootstrap

### Bootstrap WITHOUT goals (backward-compat smoke)

- [ ] Different test family on a different test wallet
- [ ] Same form, but skip the goals section entirely
- [ ] Submit
- [ ] Confirm family created successfully
- [ ] In Claude: "What are my goals?" → expect Sprint 3.0.3 friendly empty-state copy

---

## Artifacts to capture

For the docs work that follows Sprint 3.0.5:

1. **Form screenshot — new fields visible.** Bootstrap form on mobile showing the goals section and the kid wallet field. Replaces the screenshot from the 2026-05-13 conversation that motivated this sprint.
2. **Allowlist transparency panel screenshot.** Post-submit state showing the addresses. Sprint 3.0.2 made legible.
3. **`check-goals` response in Claude after bootstrap.** Proves the round-trip works.
4. **basescan.org transaction for distribution to BYO-wallet.** Proves Sprint 3.0.2 + 3.0.5 together delivered the end-to-end story.

Four screenshots, all generated as part of the Step 11 smoke. Folder them in `docs/screenshots/sprint-3.0.5/` for the landing-page work.