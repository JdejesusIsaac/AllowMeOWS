# Sprint 3.0.5 — Progress

**Status:** Not Started
**Start date:** TBD
**Target ship date:** TBD (~5 hours focused, one half-day session)
**Test count entering sprint:** 363 passing + 1 skipped (post-3.0.2/3.0.3/3.0.4 baseline)
**Test count target:** +1 backward-compat regression test (FB1), plus updates to any HTML-structure-asserting tests (no count change)

---

## Pre-sprint checklist

- [ ] Sprint 3.0.3 + 3.0.4 confirmed shipped:
  - [ ] `grep -n "subgoals" src/schemas.ts` finds `LearningGoalSchema.subgoals` field
  - [ ] `grep -n "deadline" src/schemas.ts` finds `LearningGoalSchema.deadline` field
  - [ ] `grep -n "check-goals" src/tools/` finds the tool registration
- [ ] Sprint 3.0.2 production validation confirmed (re-run V1 from progress-3.0.2.md if doubts):
  - [ ] `authorizedDestinations` field present on a recent family-config.json
  - [ ] Audit log shows `authorized-destinations-updated` entries on bootstrap
- [ ] Backup of production `data/` taken: `railway ssh "tar -czf /tmp/data-backup-pre-3.0.5-$(date +%Y%m%d-%H%M%S).tar.gz /app/data"`
- [ ] Active verify-page file confirmed: `public/verify.html` (per Sprint 3.0 v4 W2.2)
- [ ] Tailwind CDN load confirmed via browser devtools on current production verify page
- [ ] Real iOS device with Coinbase Wallet ready for W6.1 mobile smoke
- [ ] Q1 confirmation: cap goals at 5/child, subgoals at 5/goal — confirmed by user
- [ ] Q2 confirmation: native `<input type="date">` — confirmed by user
- [ ] Q3 confirmation: ship allowlist transparency panel — confirmed by user
- [ ] Test wallet has Base Sepolia ETH (≥0.001) and USDC (≥1) for W6.1 round-trip
- [ ] Existing 363 tests green on the branch before any change

---

## Step-level execution tracker

### Step 0 — Pre-sprint validation ⏳

**Estimate:** 30 min
**Status:** Not Started

**Tasks:**
- [ ] Verify schema fields present (above grep checks)
- [ ] Verify `tryNormalizeWallet` helper exists in `src/auth/wallet.ts`
- [ ] Verify `/api/configure-family` HTTP endpoint accepts `walletAddress` and `learningGoals` as optional fields (read `src/core/configure-family.ts`)
- [ ] Confirm form file path and load it in browser to baseline current behavior
- [ ] Document what the current form actually posts in a payload sample (capture via browser devtools network tab)

**Why this matters:** if Sprint 3.0.3 or 3.0.4 schema work is incomplete, this sprint is blocked. Better to catch in 30 min than mid-W2.

---

### Step 1 — Backward-compat regression test (W5.2) ⏳

**Estimate:** 25 min
**Files:** `tests/verify-routes.test.ts` (extend) or new `tests/verify-form-backcompat.test.ts`
**Status:** Not Started

**Why first:** This is the safety net. Write it before touching the form. If it ever fails during the sprint, stop and fix.

**Tasks:**
- [ ] Add test FB1: POST `/api/configure-family` with the OLD payload shape (no `walletAddress`, no `learningGoals`)
- [ ] Assert: 200 response, family created with valid `familyId`, `magicLinkUrl` returned
- [ ] Assert: loaded family config has `learningGoals: []` (or omitted) per child
- [ ] Assert: loaded family config has `authorizedDestinations` populated with admin + auto-created child wallets per Sprint 3.0.2 auto-populate
- [ ] Run test — confirm PASSING against current code before any modification

**Notes:** This locks in the current behavior. Re-run after every W-step.

---

### Step 2 — Wallet address field (W1.1) ⏳

**Estimate:** 20 min
**Files:** `public/verify.html`
**Status:** Not Started

**Tasks:**
- [ ] Add `<input type="text">` for kid wallet address in per-child block, placed after name input
- [ ] Label: "Kid's wallet address (optional)"
- [ ] Helper text: "Leave empty for AllowMe to create a wallet, or paste a MetaMask / Coinbase Wallet address"
- [ ] Placeholder: `0x...`
- [ ] Inline blur handler: regex check `/^0x[a-fA-F0-9]{40}$/`, display error if non-empty and invalid
- [ ] Run FB1 regression test — confirm still passing
- [ ] Manual: load form, type a malformed address, blur, see error; correct address, see error clear

---

### Step 3 — Learning goals section (W1.2 + W1.3) ⏳

**Estimate:** 60 min
**Files:** `public/verify.html`
**Status:** Not Started

**Tasks:**
- [ ] Add "Learning goals (optional)" section header after categories block, before "+ Add another child"
- [ ] Add "+ Add learning goal" button per child
- [ ] State: maintain `child.goals = []` array per child in form state
- [ ] On "+ Add learning goal" click: append new goal `{topic: "", category: "", subgoals: [], deadline: ""}` and re-render
- [ ] Render goal row template per goal:
  - [ ] Topic input (text, required if any other goal field filled)
  - [ ] Category dropdown populated from this child's categories (the parent just configured them in the same block)
  - [ ] "+ Add subgoal" button (Step 4 wires it up)
  - [ ] Deadline date input (Step 5)
  - [ ] "× Remove goal" button — removes from child.goals array
- [ ] Cap enforcement: hide/disable "+ Add learning goal" button when child has 5 goals
- [ ] Run FB1 — confirm still passing (form should still serialize empty-goals case identically)
- [ ] Manual: add 5 goals, confirm 6th button disabled; remove one, button re-enables

**Notes:** Use template-cloning pattern (`<template>` element or HTML string) consistent with the existing form's "Add another child" rendering. Keep state in plain JS objects; no framework.

---

### Step 4 — Subgoals (W1.4) ⏳

**Estimate:** 15 min
**Files:** `public/verify.html`
**Status:** Not Started

**Tasks:**
- [ ] On "+ Add subgoal" click within a goal: append new subgoal `{topic: ""}` to that goal's subgoals array
- [ ] Render subgoal sub-row: topic input + "× Remove subgoal" button
- [ ] Cap: hide/disable "+ Add subgoal" when 5 subgoals exist for that goal
- [ ] Run FB1 — still passing
- [ ] Manual: add a goal, add 5 subgoals, confirm 6th disabled

---

### Step 5 — Deadline field (W1.5) ⏳

**Estimate:** 10 min
**Files:** `public/verify.html`
**Status:** Not Started

**Tasks:**
- [ ] Add `<input type="date">` per goal, after subgoals section
- [ ] Label: "Deadline (optional)"
- [ ] Helper text: "When does this goal need to be done by?"
- [ ] No client-side validation beyond what the browser does natively (date format)
- [ ] Run FB1 — still passing
- [ ] Manual: pick a date, confirm value populates state correctly

---

### Step 6 — Cap enforcement audit (W1.6) ⏳

**Estimate:** 15 min
**Files:** `public/verify.html`
**Status:** Not Started

Most cap work is inline with Steps 3 and 4. This step is the audit pass.

**Tasks:**
- [ ] Confirm "+ Add learning goal" disabled at 5 goals (visual + functional)
- [ ] Confirm "+ Add subgoal" disabled at 5 subgoals per goal
- [ ] Confirm "+ Add another child" remains uncapped (existing behavior)
- [ ] Run FB1

---

### Step 7 — Submit payload construction (W2.1 + W2.2) ⏳

**Estimate:** 45 min
**Files:** `public/verify.html`
**Status:** Not Started

**Tasks:**
- [ ] Locate the existing form-submit handler (the function that constructs the `/api/configure-family` payload)
- [ ] Extend per-child serialization:
  - [ ] If `walletAddress` non-empty after trim, include in payload; else omit
  - [ ] Filter `child.goals` to drop goals with empty topics
  - [ ] For each retained goal:
    - [ ] Append `completed: false`
    - [ ] Filter subgoals to drop empty topics
    - [ ] For each retained subgoal: append `completed: false`
    - [ ] If deadline non-empty: convert `YYYY-MM-DD` → `${value}T00:00:00.000Z`; else omit deadline field
  - [ ] If filtered goals array is empty: omit `learningGoals` from payload (don't post `learningGoals: []` — match the old shape exactly when there's nothing to add)
- [ ] Run FB1 — still passing (the omit-when-empty rule is what keeps this green)
- [ ] Manual: bootstrap a family with 2 goals (one with subgoals, one without), one with deadline; check Railway state to confirm correct persistence

---

### Step 8 — Inline validation feedback (W4.1 + W4.2) ⏳

**Estimate:** 30 min
**Files:** `public/verify.html`
**Status:** Not Started

**Tasks:**
- [ ] Wallet address validation already inline from Step 2; verify it still fires on blur
- [ ] Goal validation on submit:
  - [ ] If a goal has a category, subgoal, or deadline but no topic → show inline error "Topic is required when other fields are filled"
  - [ ] Block submit until resolved
- [ ] Run FB1
- [ ] Manual: try submitting with a malformed wallet → blocked with error; try submitting with a goal that has subgoals but empty topic → blocked

---

### Step 9 — Allowlist transparency panel (W3.1) ⏳

**Estimate:** 30 min
**Files:** `public/verify.html`
**Status:** Not Started

**Tasks:**
- [ ] After successful `/api/configure-family` response, BEFORE rendering the magic-link URL state, render allowlist panel:
  - [ ] Section header: "Your treasury's authorized destinations"
  - [ ] List entries: admin wallet (label "You (admin)"), each child's wallet (label child name + "(self-managed)" or "(AllowMe-managed)" depending on whether parent supplied)
  - [ ] One-line explanation: "These are the only addresses your treasury can send to. Update via 'configure-policy' in Claude."
- [ ] Pull data from the API response body (not from form state — the response is authoritative, especially for auto-created kid wallets)
- [ ] Run FB1
- [ ] Manual: bootstrap, see panel render with correct addresses, confirm continue-button reveals magic-link URL

---

### Step 10 — Existing test updates (W5.1) ⏳

**Estimate:** 20 min
**Files:** any test file that asserts on form HTML structure
**Status:** Not Started

**Tasks:**
- [ ] `grep -r "verify.html" tests/` to find tests referencing the form
- [ ] For any test that asserts on HTML field count or specific selectors that changed: update to assert on the new structure
- [ ] For any test that asserts on payload shape: update to allow new optional fields, do not require them
- [ ] Run full test suite — all 363+ passing, FB1 still green

**Notes:** Expectation is that very few tests assert on form HTML — most assertions are against API contract per the W4 (tests) workstream in Sprint 3.0 v4. If many tests break, audit them: they may have been asserting on the wrong layer.

---

### Step 11 — Railway smoke test (W6.1) ⏳

**Estimate:** 20 min
**Files:** none (manual)
**Status:** Not Started

**Tasks:**
- [ ] Deploy Sprint 3.0.5 to Railway
- [ ] On a real iOS device, open verify page
- [ ] Sign in with Coinbase Wallet
- [ ] Create a family with at least: 1 child with wallet, 2 learning goals (one with subgoals, one with deadline)
- [ ] Confirm date input renders mobile-native picker on iOS
- [ ] Confirm category dropdown is populated from configured categories
- [ ] Confirm caps work (try to add 6 goals)
- [ ] Submit form
- [ ] Confirm allowlist panel renders before magic-link URL
- [ ] Copy magic-link URL, configure as Claude connector
- [ ] In Claude: "What are my goals?" → confirm goals + subgoals + deadline all returned correctly
- [ ] In Claude: "What's the allowlist for my family?" or check `family-config.json` via SSH → confirm kid wallet on list
- [ ] If kid wallet is the parent's own test wallet: fund treasury, distribute, confirm transfer to kid wallet succeeds (implicit Sprint 3.0.2 happy path)

---

### Step 12 — README update (W6.2) ⏳

**Estimate:** 10 min
**Files:** `README.md`
**Status:** Not Started

**Tasks:**
- [ ] Add "Sprint 3.0.5 (Done)" section to README roadmap
- [ ] Bullet: bootstrap form now captures learning goals + subgoals + deadlines
- [ ] Bullet: per-child wallet address can be supplied at bootstrap
- [ ] Bullet: allowlist transparency panel post-submit
- [ ] Bullet: backward-compat preserved (existing test suite + FB1 green)

---

## Time tracking

| Phase | Estimate | Actual | Notes |
|-------|----------|--------|-------|
| Step 0 — Pre-sprint validation | 30 min | — | |
| Step 1 — FB1 regression test | 25 min | — | Safety net |
| Step 2 — Wallet field | 20 min | — | |
| Step 3 — Goals section | 60 min | — | |
| Step 4 — Subgoals | 15 min | — | |
| Step 5 — Deadline | 10 min | — | |
| Step 6 — Cap audit | 15 min | — | |
| Step 7 — Payload serializer | 45 min | — | |
| Step 8 — Inline validation | 30 min | — | |
| Step 9 — Allowlist panel | 30 min | — | |
| Step 10 — Existing test updates | 20 min | — | |
| Step 11 — Railway smoke | 20 min | — | |
| Step 12 — README | 10 min | — | |
| **Total** | **~5 hours** | — | |

---

## Session log

### Session 1 — TBD

**Goals:**
- Complete Steps 0–6 (pre-sprint + FB1 + form field additions)
- Re-run FB1 after every step

**Outcomes:**
- [TBD]

**Test count:** entering 363 / exiting TBD

**Blockers:**
- [TBD]

---

### Session 2 — TBD

**Goals:**
- Complete Steps 7–12 (serializer, validation, panel, smoke)
- Mobile real-device test
- Ship to Railway

**Outcomes:**
- [TBD]

**Test count:** entering TBD / exiting TBD

---

## Failed approaches

*(Empty until execution; populated during session log)*

Pattern from prior sprints: capture upstream fixes vs downstream workarounds explicitly. If a backend behavior turns out to differ from assumed, fix it upstream and update the plan; do not work around in the form.

---

## Production validation plan

After Step 12 completes and Sprint 3.0.5 is deployed:

### V1 — New family with goals
- [ ] Bootstrap a family with 1 child, 3 learning goals (1 with subgoals, 1 with deadline, 1 minimal)
- [ ] Confirm `data/families/{id}/family-config.json` shows correct shape
- [ ] In Claude: `check-goals` returns all 3 with subgoal + deadline details

### V2 — New family without goals (regression)
- [ ] Bootstrap a family without filling any goal fields
- [ ] Confirm config has empty/undefined `learningGoals`
- [ ] In Claude: `check-goals` returns the Sprint 3.0.3 friendly empty-state copy

### V3 — BYO-wallet path
- [ ] Bootstrap a family with a kid's external wallet (use parent's own test wallet for convenience)
- [ ] Confirm `ChildConfig.walletAddress` is the supplied address (lowercase normalized)
- [ ] Confirm `authorizedDestinations` includes the supplied address
- [ ] In Claude: verify achievement + distribute → USDC arrives at the external wallet on Base Sepolia explorer

### V4 — Allowlist transparency panel
- [ ] Bootstrap fresh family
- [ ] Observe post-submit panel listing admin + child wallet(s)
- [ ] Confirm the panel text accurately describes the security model

### V5 — Backward-compat for existing families
- [ ] Confirm a family bootstrapped pre-3.0.5 (e.g., Isaac/Elina from prior sessions) still loads correctly
- [ ] Confirm `configure-policy` updates from Claude still work for pre-3.0.5 families
- [ ] Confirm no schema-on-load errors in Railway logs

### V6 — Mobile flow on iOS
- [ ] iOS Safari + Coinbase Wallet
- [ ] Date picker is native iOS
- [ ] Dropdowns work
- [ ] Dynamic add/remove buttons respond to touch
- [ ] Form scrolls correctly with virtual keyboard up

---

## Risks and known issues

### Risk 1 — Backward-compat regression slips in

**Likelihood:** Medium (the central correctness concern of this sprint)
**Impact:** Existing pilot families' bootstrap flow breaks; new families bootstrapped with the minimal form fail
**Mitigation:** FB1 test written first (Step 1), re-run after every W-step. If it ever fails, stop and fix upstream.

### Risk 2 — Mobile date input behaves badly on iOS Safari

**Likelihood:** Low-Medium (HTML5 `<input type="date">` is well-supported but has known quirks)
**Impact:** Parents on iOS can't enter deadlines
**Mitigation:** Step 11 smoke test on real device. Fallback: text input with regex per Fallback Approaches in plan.

### Risk 3 — Form state management gets complex

**Likelihood:** Medium (nested per-child goals + subgoals is more complex than the existing form)
**Impact:** Slower implementation, possible bugs from manual state management
**Mitigation:** Vanilla JS with template cloning, same pattern as Sprint 3.0 v4 W2.2 "Add another child." If state hurts, ship goals-only (no subgoals) and defer subgoal UI to Sprint 3.5.

### Risk 4 — Allowlist panel discloses something it shouldn't

**Likelihood:** Low
**Impact:** Privacy leak — e.g., showing a wallet address the parent doesn't expect
**Mitigation:** Panel renders only what the API response returns. The API response is the family's own data; the parent is authorized to see it. Worst case: panel shows AllowMe-internal vault address by accident — verify in V4 that internal vaults are NOT included (Sprint 3.0.2 Decision 2 keeps them off the allowlist field by design).

### Risk 5 — Category dropdown desync

**Likelihood:** Low
**Impact:** Parent configures categories, then adds goals, then changes a category name — goal's category dropdown shows stale name
**Mitigation:** Re-populate dropdowns on category change. If complex, just clear the goal's category selection when categories change and prompt parent to re-pick.

### Risk 6 — Form load time grows past mobile-friendly

**Likelihood:** Low
**Impact:** Slow first paint on mobile
**Mitigation:** All additions are inline HTML+JS, no new dependencies. Should add <10KB to the page. Verify in Step 11.

---

## Definition of done

Sprint 3.0.5 is shippable when:

- [ ] All Sprint Contract success criteria 1–12 verifiably pass
- [ ] FB1 backward-compat regression test green
- [ ] All 363+ prior tests still green
- [ ] `npx tsc --noEmit` clean (no TS changes expected, but verify)
- [ ] V1–V6 production validation passes on Railway
- [ ] iOS mobile flow tested on real device
- [ ] README updated
- [ ] No new dependencies in `package.json`
- [ ] Decisions log captured in `research-3.0.5.md` (done)
- [ ] Plan captured in `plan-3.0.5.md` (done)
- [ ] Tests captured in `test-3.0.5.md` (done)
- [ ] This `progress-3.0.5.md` reflects actual completion state
- [ ] Section 1 learner-mode test (from prior turn) re-runnable end-to-end with goals populated

---

## What ships next (post-3.0.5)

**If 3.0.5 ships clean:**
- Run Section 1 learner-mode test with son using the new bootstrap form
- Sprint 3.5 — polish, Spanish form, OWS executable wiring stretch, dashboard
- Landing page docs (7 pages from prior turn)
- Sprint 4.0 — Coinbase Smart Wallet treasury, paymaster, Postgres

**If 3.0.5 surfaces a structural problem:**
- Hotfix scope to preserve backward-compat
- Defer the broken piece to Sprint 3.5 rather than blocking the rest

**Critical: do not start landing page docs until after Section 1 learner-mode test with the new form completes successfully.** The docs need to reflect what the verify-page actually delivers; until 3.0.5 + learner test prove that, docs are speculation.