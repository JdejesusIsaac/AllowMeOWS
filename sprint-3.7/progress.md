# Sprint 3.7 — Progress

**Status:** Implementation complete — awaiting evaluator + production smoke (V1–V4)
**Implementation date:** 2026-05-19
**Test count entering sprint:** 432 passing + 1 skipped (current main HEAD; Sprint 3.6 + closure baseline of 377 was stale relative to actual repo)
**Test count exiting sprint:** **443 passing + 1 skipped** — net **+11** (U1–U4 = 4, AM1–AM7 = 7, MODAL1 extension is inline within the existing test → no count delta)
**Typecheck:** `npx tsc --noEmit` clean

---

## Pre-sprint checklist

- [x] `npx vitest run` baseline green before Sprint 3.7 work began
- [x] `npx tsc --noEmit` clean baseline
- [x] `npm install string-similarity @types/string-similarity --save` succeeded (note: package marks itself deprecated but no CVE; deferred replacement to Sprint 4.0+)
- [x] Confirmed `findMatchingGoalIndex` lives at `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/engine/learning-goals.ts:31` — plan said `src/core/goal-matching.ts`; corrected during planner phase
- [x] Confirmed `/verify` page route lives in `app/server.ts:313` (not `app/verify-routes.ts`, which is API-only); `/join/:code` mounted alongside
- [x] Confirmed walkthrough placeholder text lives in `public/walkthroughs/{claude,chatgpt,other}.svg`
- [x] Q1 — `string-similarity` library
- [x] Q2 — 3-sentence founder bio
- [x] Q3 — 0.85 auto-complete threshold + 0.65 hint floor
- [ ] Real iOS device smoke (V1–V4) — deferred to deploy session
- [ ] Production data backup before Railway deploy

---

## Step-level execution tracker

### Step 0 — Pre-sprint validation ✅

**Estimate:** 15 min
**Status:** Done

**Tasks:**
- [ ] Read `app/verify-routes.ts` to confirm route handler structure
- [ ] Read `src/tools/invite-member.ts` to confirm response shape
- [ ] Read `src/tools/verify-achievement.ts` to confirm where achievement verification happens
- [ ] Locate `findMatchingGoalIndex` (or equivalent); note signature and current behavior
- [ ] Read `src/schemas.ts` AuditEntrySchema action enum (preparing for one-line extension)
- [ ] Read `public/copy/why.md` to understand current copy state (the founder bio gets appended/inserted)

---

### Step 1 — URL design pass route handler (W1.1) ✅

**Estimate:** 45 min / **Actual:** ~15 min
**Files:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/app/server.ts:319-329` (NOT `app/verify-routes.ts` — that file is API-only)
**Status:** Done. `/join/:code` serves the same SPA HTML as `/verify`. Backward-compat preserved by leaving `/verify` route intact.

**Tasks:**
- [ ] Add `/join/:code` route in verify-routes
- [ ] Handler logic:
  - [ ] Extract `code` from path params
  - [ ] Look up invite record by code in invite store
  - [ ] If not found: 404 with friendly "invite not found" copy
  - [ ] If found and not revoked: extract role from record, render verify-page success-or-redeem state with `role` and `code` passed to client
- [ ] Old `/verify` route handler unchanged (backward compat)
- [ ] Both routes call the same underlying redemption logic; only URL parsing differs
- [ ] Manual sanity check: hit `/join/EXISTING-INVITE-CODE` in browser, confirm verify page renders with correct family/role/name

---

### Step 2 — invite-member URL form update (W1.2 + W1.3) ✅

**Estimate:** 25 min / **Actual:** ~5 min
**Files:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/invite-member.ts:117`
**Status:** Done. `verifyUrl` now emits `${verifyBase}/join/${invite.code}`. The `joinMessage` SMS template inherits via string interpolation. QR code generation also picks up the new URL automatically (it uses `verifyUrl` as input). No separate `message-compose` tool exists in this codebase.

**Tasks:**
- [ ] In `invite-member.ts`, change `verifyUrl` from `https://allowme.dev/verify?invite=${code}&role=${role}` to `https://allowme.dev/join/${code}`
- [ ] Confirm the tool response message body still references the new URL clearly with the "Setup link (open on their phone)" framing from Sprint 3.0.6
- [ ] Update message_compose SMS template to use the new URL form
- [ ] Update QR code generation (if it's reading the old URL form anywhere) to use the new URL

---

### Step 3 — URL tests U1-U4 (W1.5) ✅

**Estimate:** 45 min / **Actual:** ~20 min
**Files:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/url-design.test.ts` (NEW, 197 lines)
**Status:** Done. All four green:
- **U1:** invite-member emits `/join/CODE` (no queryparams), route serves SPA, preview API resolves family/role/childName from record.
- **U2 (CRITICAL):** legacy `/verify?invite=...&role=...` continues to serve the SPA — backward compat preserved.
- **U3:** preview API always returns role from record; queryparam-claimed role can never override.
- **U4:** malformed codes return 4xx (never 5xx), no stack traces, structured error JSON from preview API.

**Bonus:** existing assertions in `tests/qr-code.test.ts:88` and `tests/invite-delivery.test.ts:75,101` updated from `/verify\?invite=` to `/join/` shape with `not.toContain` guards on queryparams. `tests/invite-member-copy.test.ts:74-75` updated similarly.

**Tasks:**
- [ ] Test U1: new URL form `/join/CODE` resolves correctly with role from record
- [ ] Test U2: old URL form `/verify?invite=CODE&role=ROLE` still resolves correctly (backward compat — critical)
- [ ] Test U3: invite record's role is the source of truth; if URL has wrong role, record wins
- [ ] Test U4: malformed code in `/join/MALFORMED` returns 404 with clean error, not stack trace
- [ ] Run U1-U4, confirm all green

---

### Step 4 — Subgoal matcher core (W2.1 + W2.2) ✅

**Estimate:** 65 min / **Actual:** ~10 min
**Files:** `package.json`, `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/engine/learning-goals.ts:99-152`
**Status:** Done. `findMatchingSubgoal(achievement, child)` returns the highest-confidence open-subgoal match across the child's goals. Skips already-completed subgoals. Requires goal-level category equality before any text scoring. Returns `null` below `SUBGOAL_MATCH_HINT_FLOOR (0.65)`. Exports `SUBGOAL_MATCH_AUTO_COMPLETE (0.85)` and `SUBGOAL_MATCH_HINT_FLOOR (0.65)` as named constants for tunability.

**Tasks:**
- [ ] `npm install string-similarity @types/string-similarity --save`
- [ ] Verify clean install: `npx tsc --noEmit` clean
- [ ] In `goal-matching.ts`, add new function:
  ```typescript
  export function findMatchingSubgoal(
    achievement: { description: string; category: string },
    child: ChildConfig,
  ): {
    goalIndex: number;
    subgoalIndex: number;
    confidence: number;
    matchType: "substring" | "fuzzy";
  } | null
  ```
- [ ] For each goal in `child.learningGoals`, for each subgoal:
  - [ ] If subgoal already `completed: true`, skip
  - [ ] If `achievement.category !== goal.category`, skip (subgoals inherit goal category)
  - [ ] Substring check: `achievement.description.toLowerCase().includes(subgoal.topic.toLowerCase())` → return with confidence 1.0, matchType "substring"
  - [ ] Reverse substring check: `subgoal.topic.toLowerCase().includes(achievement.description.toLowerCase().split(' ').slice(0,3).join(' '))` for short achievement descriptions → confidence 0.95
  - [ ] Fuzzy: `string-similarity.compareTwoStrings(achievement.description.toLowerCase(), subgoal.topic.toLowerCase())` → if ≥0.65, return with that confidence, matchType "fuzzy"
- [ ] Return the highest-confidence match (or null if none ≥0.65)
- [ ] Manual sanity: write a quick scratch test with known inputs, confirm matcher returns sensible values

---

### Step 5 — Subgoal matcher wiring + audit (W2.3-2.5) ✅

**Estimate:** 55 min / **Actual:** ~10 min
**Files:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/verify-achievement.ts:207-253`, `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts:240-245`
**Status:** Done.
- Audit enum extended with `subgoal-auto-completed` (single-line non-breaking change).
- Matcher runs after `findMatchingGoalIndex`; auto-complete gate at 0.85, hint floor at 0.65.
- Audit entry on auto-complete includes `{childName, subgoalTopic, goalTopic, achievementId, achievementDescription, confidence, matchType}`.
- Rich card builder (`buildVerifyAchievementRichMarkdown`) takes optional `subgoalAutoCompleted` and `subgoalHint` params; renders `✨ Subgoal completed: **X**!` or `📎 Possible match for subgoal **'X'** — ask your parent...`.
- Tool JSON response surfaces `subgoalAutoCompleted`, `subgoalHint`, `subgoalMatchConfidence`, `subgoalMatchType` for downstream consumers.

**Tasks:**
- [ ] Extend AuditEntrySchema action enum: add `"subgoal-auto-completed"`
- [ ] In `verify-achievement.ts`, after the achievement is verified and persisted:
  - [ ] Call `findMatchingSubgoal(achievement, child)`
  - [ ] If result.confidence ≥ 0.85: set the subgoal's `completed: true` in family config; persist via state.updateFamilyConfig; emit audit entry `subgoal-auto-completed` with `actor`, `subgoalTopic`, `goalTopic`, `achievementDescription`, `confidence`, `matchType`
  - [ ] If 0.65 ≤ result.confidence < 0.85: do NOT auto-complete; include "possible subgoal match" line in the response card: `"📎 Possible match for subgoal '${result.subgoalTopic}' — ask your parent to mark it complete if you finished it."`
  - [ ] If null or confidence < 0.65: no action, no copy
- [ ] Update verify-achievement response card to surface the auto-completion line: `"✨ Subgoal completed: ${subgoalTopic}!"`

---

### Step 6 — Subgoal matcher tests AM1-AM7 (W2.6) ✅

**Estimate:** 60 min / **Actual:** ~25 min
**Files:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/subgoal-matcher.test.ts` (NEW, 429 lines)
**Status:** Done. All seven green:
- **AM1:** substring match auto-completes; audit entry recorded with all required fields; `subgoalAutoCompleted` set; sibling subgoal untouched.
- **AM2:** high-confidence fuzzy / substring (subgoal in description) auto-completes.
- **AM3:** ambiguous match (`ancient civilizations chapter` vs. `read a chapter about ancient civilizations today` — confidence in [0.65, 0.85)) surfaces hint, does NOT mutate state, no audit entry.
- **AM4:** unrelated description (`Read a Goosebumps book`) stays silent across the board.
- **AM5:** already-completed subgoal does not double-fire — zero new audit entries.
- **AM6 (CRITICAL):** false-positive prevention — cross-category (math achievement vs. reading subgoal) and unrelated-content (Goosebumps vs. Ancient Greece) both correctly skip.
- **AM7:** parent manual completion via state mutation (mirroring `mergeLearningGoals` semantics) is idempotent with prior auto-completion; no double-fire of the audit entry.

**Tasks:** see test-3.7.md AM1-AM7 specs. High level:
- [ ] AM1: exact substring match → auto-completes, audit recorded
- [ ] AM2: high-confidence fuzzy match (≥0.85) → auto-completes
- [ ] AM3: ambiguous match (0.65-0.85) → does NOT auto-complete, hint surfaced in response
- [ ] AM4: low-similarity (<0.65) → no action
- [ ] AM5: already-completed subgoal → no double-action
- [ ] AM6 (CRITICAL): false-positive prevention — "Did math homework" vs subgoal "Ancient Greece reading" → confidence below threshold, no auto-completion
- [ ] AM7: parent manual completion via configure-policy still works after auto-completion (idempotency)

---

### Step 7 — Polish W3 (founder bio + SVG placeholder) ✅

**Estimate:** 45 min / **Actual:** ~5 min
**Files:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/public/copy/why.md:11-13`, `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/public/walkthroughs/{claude,chatgpt,other}.svg:6`, `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/brand-modals.test.ts:33-43`
**Status:** Done.
- **W3.1:** `## Who built this` heading + 3-sentence bio (Juan Isaac, security researcher / CDP Ambassador, NYC + Yonkers AI-literacy workshops, AllowMe LLC). MODAL1 test extended with four founder-bio assertions.
- **W3.2:** SVG fallback text in all three walkthrough placeholders softened from `"Drop walkthroughs/X.gif here"` to `"Walkthrough video — coming soon"`. The `.mov` walkthroughs the user has on disk are NOT wired up in this sprint per planner option 4.

**Tasks:**

W3.1 (20 min):
- [ ] Draft founder bio paragraph for `why.md`:
  ```
  ## Who built this
  
  Built by Juan Isaac, a security researcher and Coinbase Developer
  Platform Ambassador focused on smart-contract audits and agent-native
  product architecture. AllowMe grew out of work teaching AI literacy
  workshops to families in NYC and Yonkers, and a conviction that
  financial-education tools should be as accessible to charter-school
  families as they are to early adopters. Built independently under
  AllowMe LLC, in active pilot with families now.
  ```
- [ ] Adjust copy as needed for tone; sleep on it if uncertain
- [ ] Extend MODAL1 test (in `tests/brand-modals.test.ts`) to assert the founder bio is present in why.md content

W3.2 (25 min):
- [ ] In `public/verify.html`, find the walkthrough GIF rendering section
- [ ] CSS: if the GIF file is missing (404 detected client-side via `onerror` handler), replace the visible "Drop walkthroughs/claude.gif here" text with a subtle skeleton placeholder: light gray background, italic "Walkthrough video — coming soon", optional icon
- [ ] Test manually: rename a GIF file temporarily, reload verify page, confirm skeleton renders gracefully

---

### Step 8 — Docs + smoke (W4) 🟡

**Estimate:** 30 min / **Actual:** ~5 min for docs; production smoke (V1–V4) deferred to deploy session.
**Files:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/README.md:605-612`
**Status:** W4.1 done (Sprint 3.7 roadmap entry added). W4.2 production V1–V4 smoke is gated on a Railway deploy and a real-device pass, which is out of band for the implementation phase.

**Tasks:**

W4.1 (10 min):
- [ ] Add Sprint 3.7 section to README roadmap:
  ```
  ## Sprint 3.7 (Done)
  Design completeness arc closeout:
  - URL design pass: cleaner `/join/CODE` form, old form backward-compat
  - Subgoal auto-matching on verify-achievement (conservative threshold)
  - Founder bio + walkthrough GIF placeholder polish
  ```

W4.2 (20 min):
- [ ] Deploy to Railway
- [ ] V1-V4 production validation per "Production validation plan" below

---

## Time tracking

| Phase | Estimate | Actual | Notes |
|-------|----------|--------|-------|
| Step 0 — Pre-sprint validation | 15 min | — | |
| Step 1 — URL route handler | 45 min | — | |
| Step 2 — invite-member + SMS URL update | 25 min | — | |
| Step 3 — URL tests U1-U4 | 45 min | — | |
| Step 4 — Subgoal matcher core | 65 min | — | |
| Step 5 — Matcher wiring + audit | 55 min | — | |
| Step 6 — Matcher tests AM1-AM7 | 60 min | — | |
| Step 7 — Polish (bio + placeholder) | 45 min | — | |
| Step 8 — Docs + smoke | 30 min | — | |
| **Total** | **~6.75 hours** | — | |

---

## Session log

### Session 1 — TBD

**Goals:**
- Steps 0–3 (validation + URL design pass + U1-U4 tests)

**Outcomes:**
- [TBD]

**Test count:** entering — / exiting —

---

### Session 2 — TBD

**Goals:**
- Steps 4–8 (subgoal matcher + polish + docs + smoke)

**Outcomes:**
- [TBD]

---

## Failed approaches

*(None during execution. One library-quality concern documented below.)*

### Library-quality finding (not a failure)

- `string-similarity@4.0.4` emits a deprecation warning on install. Functional, no CVE, no maintenance hazard for this sprint. Deferred replacement (e.g., hand-rolled Dice coefficient or `string-similarity-js`) to Sprint 4.0+. Documented here so future sprints don't re-debate the choice.

---

## Production validation plan

After Step 8 deploy:

### V1 — New URL form works end-to-end
- [ ] Generate fresh invite via Manager Claude session
- [ ] Confirm response URL is the new `/join/CODE` form
- [ ] Tap URL on iOS Safari
- [ ] Confirm verify page renders correctly
- [ ] Complete redemption, install magic-link URL in Claude, ask "what are my goals?"

### V2 — Old URL form still works (backward compat)
- [ ] Manually construct the old URL form: `https://allowme.dev/verify?invite=NEW-CODE&role=learner` (using a fresh invite)
- [ ] Tap on phone
- [ ] Confirm verify page renders correctly (same as V1)
- [ ] No "page not found" error

### V3 — Subgoal auto-matching fires in production
- [ ] In Manager Claude session: set up a learner with a learning goal that has 2+ subgoals (use specific topics like "Ancient Greece reading" and "Roman empire history")
- [ ] Invite learner, redeem
- [ ] In learner Claude/ChatGPT: log achievement "I read for 30 minutes about Ancient Greece, score 85, reading"
- [ ] Confirm response card includes "✨ Subgoal completed: Ancient Greece reading!"
- [ ] Ask "what are my goals?" → confirm subgoal shows ✓
- [ ] Check audit log on Railway: confirm `subgoal-auto-completed` entry with confidence ≥ 0.85

### V4 — Polish landed
- [ ] On verify success state, open brand modal "Why we built this"
- [ ] Confirm founder bio paragraph renders
- [ ] Confirm tone reads professionally (sleep-on-it check passes)
- [ ] If GIFs missing locally (rare), confirm placeholder skeleton renders gracefully

---

## Risks and known issues

### Risk 1 — Subgoal matcher false-positive rate higher than expected

**Likelihood:** Medium
**Impact:** Kids see ✓ flip incorrectly; trust erosion
**Mitigation:** Conservative 0.85 threshold. AM6 test specifically guards. If pilot data shows real false positives, raise threshold to 0.90 in Sprint 4.0 (or sooner if urgent).

### Risk 2 — Backward-compat for old URL form breaks silently

**Likelihood:** Low (test U2 specifically covers)
**Impact:** Any old invite URLs in user inboxes stop working
**Mitigation:** U2 is critical-path. Don't skip. Run in production smoke V2.

### Risk 3 — string-similarity package edge cases

**Likelihood:** Low
**Impact:** Specific input shapes return unexpected similarity scores
**Mitigation:** AM1-AM7 cover the expected ranges. If production reveals an edge case, document and tune threshold.

### Risk 4 — Founder bio reads as marketing

**Likelihood:** Medium
**Impact:** Brand-trust gap widens instead of closing
**Mitigation:** Sleep on the draft, edit once, ship. If still uncertain, defer to Sprint 3.8 and ship without.

### Risk 5 — GIF placeholder skeleton creates visual regression

**Likelihood:** Low
**Impact:** Verify success state looks worse than before
**Mitigation:** Manual visual check before deploy. If worse, revert and accept the existing placeholder until Sprint 3.6 closure ships real GIFs.

---

## Definition of done

Sprint 3.7 is shippable when:

- [ ] All Sprint Contract success criteria 1–13 verified
- [ ] All 377+ prior tests still green
- [ ] +12 new tests passing (U1-U4, AM1-AM7, MODAL1 extension)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` clean
- [ ] V1-V4 production smoke passes
- [ ] README updated
- [ ] One new audit enum value added (`subgoal-auto-completed`)
- [ ] One new npm dependency added (`string-similarity`)
- [ ] No other core schema changes
- [ ] Decisions log captured in `research-3.7.md` (done)
- [ ] Plan captured in `plan-3.7.md` (done)
- [ ] Tests captured in `test-3.7.md` (done)
- [ ] This `progress-3.7.md` reflects actual completion state

---

## What ships next

**If 3.7 ships clean:**
- Landing page docs (7 pages from prior turn) — now honestly demoable
- First real pilot family invite — bootstrap → invite → kid setup → achievement → distribution loop
- Sprint 4.0 planning: Coinbase Smart Wallet treasury, paymaster, Postgres migration

**If 3.7 surfaces a regression:**
- Hotfix to preserve the URL backward-compat at minimum (this is reputation-critical)
- Defer matcher tuning if false-positive rate is real
- Don't gate Sprint 4.0 on 3.7 polish — engineering correctness in the URL routes and matcher core is the must-ship; polish can slip

**Sprint 4.0 readiness checklist (after 3.7):**
- Design completeness rating at 8+ per design-lead critique
- All four-artifact sprint sets cleanly closed
- Production data has real pilot-family activity (or close to it)
- Architecture is stable enough to undergo the Coinbase Smart Wallet migration