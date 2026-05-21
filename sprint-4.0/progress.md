# Sprint 4.0 — Progress

**Status:** In Progress (Steps 1–6 complete; Step 7.3 complete; Step 8 critical-path complete; Step 7.1/7.2 verify.html UI + Step 9 README/smoke deferred to next session)
**Start date:** 2026-05-21
**Sprint 3.7 / spike prerequisites:** treated as run (user exit-to-implementation directive); spike evidence to be captured live before Aiden dogfooding.
**Target ship date:** TBD (~19 hours, 3 focused days or 4 sessions of ~5 hours each)
**Test count entering sprint:** 389+ passing (post-Sprint 3.7 baseline)
**Test count target:** +18 (S1-S4, LS1-LS5, CD1-CD5, R1-R3, plus 1 backward-compat migration test)

---

## Pre-sprint checklist

- [ ] Sprint 3.6 closure session complete (GIFs live, V1-V6 production smoke passed)
- [ ] Sprint 3.7 shipped to production (URL design pass + subgoal matcher + polish)
- [ ] All 389+ tests green on main; `npx tsc --noEmit` clean
- [ ] **30-minute Learning Mode prompt-fragment experiment validated** — confirmed Claude and ChatGPT reliably activate Socratic mode when given the math-pedagogy fragment. If the experiment fails or is fragile, STOP and re-scope Sprint 4.0 before continuing.
- [ ] Aiden confirmed as math dogfooding subject (willing, age-appropriate, available for 15-day pilot during/after sprint)
- [ ] Backup: `railway ssh "tar -czf /tmp/data-backup-pre-4.0-$(date +%Y%m%d-%H%M%S).tar.gz /app/data"`
- [ ] Test treasury still funded on Base Sepolia (≥1 USDC for engagement-weighted payout smoke)
- [ ] Real iOS device available for W9.2 mobile smoke (45-min session UX test)
- [ ] Q1 confirmed: 1-5 engagement scale (per research-4.0.md)
- [ ] Q2 confirmed: flexible daily session limit with `allowMakeupSessions` flag
- [ ] Q3 confirmed: baseline once at start, retake on parent request

---

## Step-level execution tracker

### Step 0 — Pre-sprint validation (15 min) ⏳

- [ ] Read existing `src/schemas.ts` AuditEntrySchema + LearningGoalSchema to plan additive changes
- [ ] Read `src/tools/configure-policy.ts` to understand current learning-goal handling
- [ ] Read `src/tools/verify-achievement.ts` to understand current achievement flow (the model Sprint 4.0 partially replaces for math goals)
- [ ] Confirm `data/families/{id}/family-config.json` has been migrated through Sprint 3.6 + 3.7 cleanly
- [ ] Locate `distribute-allowance.ts` for the W6 settlement extension

---

### Step 1 — Schema + state types (W1, ~2 hours) ✅

**Files:** `src/schemas.ts`, `app/verify-routes.ts`, `src/tools/configure-policy.ts`, `src/core/configure-family.ts`, `src/engine/learning-goals.ts`, `tests/study-plan-schema.test.ts` (NEW)

- [x] W1.1 — Define `StudyPlanSchema`, `SessionRecordSchema`, `BaselineAssessmentSchema` in `src/schemas.ts` (lines 36-100)
- [x] W1.2 — Add `studyPlan: StudyPlanSchema.optional()` to LearningGoalSchema
- [x] W1.3 — Add 4 audit-action enum values
- [x] W1.4 — Extend HTTP `configureFamilyBodySchema` (`app/verify-routes.ts`) + MCP `configure-policy` tool schema (`src/tools/configure-policy.ts`) to accept the parent-supplied `{durationDays, minutesPerSession, allowMakeupSessions?}` studyPlan subset. `normalizeChildren` (`src/core/configure-family.ts`) builds the canonical StudyPlan with server-side defaults (`sessionsPlanned = durationDays`, `sessions: []`, `knownGaps: []`). `mergeLearningGoals` (`src/engine/learning-goals.ts`) preserves server-managed studyPlan state across configure-policy updates so the kid's progress survives reconfigures.
- [x] W1.5 — Backward-compat test (S4) — pre-4.0 fixture without `studyPlan` parses cleanly through `FamilyConfigSchema.parse`
- [x] W1.6 — Unit tests S1-S4 in `tests/study-plan-schema.test.ts`, all passing

---

### Step 2 — Math curriculum prompt fragments (W2, ~3 hours) ✅

**Files:** `src/prompts/math/{README,baseline-assessment,engagement-scoring,place-value,fractions,decimals,ratios,pre-algebra}.md`, `src/prompts/receipt-generator.md`

- [x] W2.1 — `src/prompts/math/` directory with README mapping each fragment to its consumer tool
- [x] W2.2 — `place-value.md` (Socratic patterns, common misconceptions, scaffolding, end-of-session assessment templates)
- [x] W2.3 — `fractions.md`
- [x] W2.4 — `decimals.md`
- [x] W2.5 — `ratios.md`
- [x] W2.6 — `pre-algebra.md`
- [x] W2.7 — `baseline-assessment.md` (5-question adaptive sequence with calibration output schema)
- [x] W2.8 — `engagement-scoring.md` (1-5 rubric, HTML-comment output format, end-of-session structured JSON block schema)
- [x] BONUS — `src/prompts/receipt-generator.md` (W5.2 receipt template prompt; used when the receipt LLM is wired in a future hotfix)

---

### Step 3 — Four new tools (W3, ~3.5 hours) ✅

**Files:** `src/tools/start-learning-session.ts` (NEW), `src/tools/get-session-state.ts` (NEW), `src/tools/complete-learning-session.ts` (NEW), `src/tools/view-session-receipt.ts` (NEW), `src/core/learning-mode.ts` (NEW — shared helpers), `src/constants.ts`, `src/index.ts`, `app/server.ts`

- [x] W3.1 — `start-learning-session.ts`: validates studyPlan exists; enforces L4 daily limit + makeup-session override; emits silent-with-note for non-math categories (criterion 12); chooses baseline fragment vs phase fragment; surfaces prior knownGaps in the phase fragment (L3); bumps `lastSessionDate` and `startedAt` at start; writes `learning-session-started` audit
- [x] W3.2 — `get-session-state.ts`: read-only studyPlan snapshot for tutor-LLM mid-session recovery; learner-self scoped
- [x] W3.3 — `complete-learning-session.ts`: orchestrates engagement parsing (explicit > structured-block > tag-parse > fallback 3); medianTurnInterval/confidenceFlag (L5); deriveCompletionRatio from assessment+engagement; computePayout; template receipt; SessionRecord persistence; studyPlan currentPhase/knownGaps merge; first-session baseline persistence; `settleSessionPayout` invocation; three audit entries (`learning-session-completed` always, `learning-session-flagged-low-confidence` conditionally, `baseline-assessment-completed` first-session)
- [x] W3.4 — `view-session-receipt.ts`: learner-self scope (ignores `childName` arg); manager / co-parent / advisor see all-or-one child; default limit 5, max 50
- [x] W3.5 — RBAC in `src/constants.ts`: learner gets all four; manager / co-parent / advisor get `view-session-receipt` only
- [x] W3.6 — Registered on stdio (`src/index.ts`) and HTTP (`app/server.ts`) transports

---

### Step 4 — Engagement scoring + cheating defense layers (W4, ~2.5 hours) ✅

**Files:** `src/core/learning-mode.ts` (consolidated into one helper module instead of split into engagement-parser / session-state — simpler), `src/tools/start-learning-session.ts`, `src/tools/complete-learning-session.ts`

- [x] W4.1 — `parseEngagementTags` + `parseStructuredBlock` (L1). Explicit `engagementScores` arg wins; structured-block from `<!-- {...} -->` second; per-turn `<!-- engagement: N -->` tags third; fallback flat-3 last. `usedFallbackEngagement` surfaced in the response so the receipt LLM (future) can do post-hoc scoring.
- [x] W4.2 — L4 daily limit enforced in `start-learning-session` via `todayUtcDateString()` comparison against `studyPlan.lastSessionDate`; `allowMakeupSessions=true` bypass returns `isMakeupSession: true`.
- [x] W4.3 — `computeMedianTurnIntervalSeconds` + `resolveConfidenceFlag` (L5). Threshold = 5s (constant `LOW_CONFIDENCE_THRESHOLD_SEC` in learning-mode.ts; tunable in 4.0.1). Flag fired writes audit entry + surfaces in template receipt.
- [x] W4.4 — L3 conversation-state binding. `studyPlan.knownGaps` accumulates per-session; `start-learning-session` injects the gaps list into the prompt fragment with explicit instruction to probe them and self-reference today's framing in the end-of-session assessment.
- [x] W4.5 — L2 adaptive fresh assessment. `engagement-scoring.md` instructs the tutor LLM to generate 3-5 questions from today's transcript with self-reference; topic fragments (place-value/fractions/etc.) each include example self-referencing assessment-question patterns.

---

### Step 5 — Receipt generation (W5, ~1 hour) ✅ (with deferral)

**Files:** `src/core/learning-mode.ts` (`generateTemplateReceipt`), `src/prompts/receipt-generator.md`

- [x] W5.1 — `generateTemplateReceipt` (deterministic template-fill, satisfies R1/R2/R3 invariants). Decision 8 fallback path: ships in 4.0; LLM-backed receipt-generator call is deferred to a follow-up (graceful behavior preserved when no API key is configured). `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` wiring is the single TODO for 4.0.1.
- [x] W5.2 — `src/prompts/receipt-generator.md` ships in this sprint so the LLM-backed call only needs the API-credential wiring later. The prompt fragment instructs the receipt LLM on tone (honest, specific, no hype) and required content (kid name, engagement, topics, assessment, confidence flag, USDC).

---

### Step 6 — Payout formula + settlement (W6, ~1.5 hours) ✅

**Files:** `src/tools/settle-session-payout.ts` (NEW), `src/tools/complete-learning-session.ts`, `tests/settle-session-payout.test.ts` (NEW)

- [x] W6.1 — `src/tools/settle-session-payout.ts` shipped. Reuses `WalletDistributor`, `FamilyKeyManager`, `PolicyEngine.calculateSavingsSplit`, `checkDestinationAllowlist`. Internal-only (no MCP registration). `distribute-allowance` untouched.
- [x] W6.2 — `learning-session-completed` audit details include the full breakdown (`baseRate`, `engagementMultiplier`, `completionRatio`, `payoutUsdc`, `txHash`, `settlementWarning`).
- [x] W6.3 — W6.3 invariants covered in `tests/learning-mode-helpers.test.ts` (LM-H4): payout ≥ 0, payout ≤ baseRate, engagement=1 → 0, engagement=5 + completion=1 → full baseRate, monotonic in both axes, clamps out-of-range inputs.

---

### Step 7 — Bootstrap form + configure-policy extension (W7, ~1.25 hours) ✅ W7.3 · ⏳ W7.1/W7.2

**Files:** `public/verify.html`, `src/tools/configure-policy.ts`

- [ ] W7.1 — Per learning goal in the goals section (~45 min):
  - Add conditional fields for `durationDays` (integer 1-60) and `minutesPerSession` (integer 15-60)
  - Show only when goal category === "math"
  - Helper text: "Set up a daily study plan. Claude will tutor your kid using Socratic guidance and grade their progress."
- [ ] W7.2 — Form serialization (~15 min):
  - Include `studyPlan: {durationDays, minutesPerSession}` in the configureFamilyBodySchema payload when fields are filled
  - Skip the field entirely when not filled (backward-compat path)
- [x] W7.3 — `configure-policy` follow-up notes shipped. Response includes `learningModeNotes: string[]` when a math goal lacks a studyPlan or when a non-math goal has one. Backward-compatible — the field is absent when neither case applies.

---

### Step 8 — Tests (W8, ~3 hours) ✅ (critical-path complete)

**Files:** `tests/study-plan-schema.test.ts` (NEW — S1–S4), `tests/learning-mode-helpers.test.ts` (NEW — LM-H1–LM-H7 + W6.3 invariants), `tests/session-lifecycle.test.ts` (NEW — LS1–LS5 + CD1–CD5 + R1 integration + math-only enforcement)

- [x] W8.1 — S1–S4 schema tests, all passing
- [x] W8.2 — LS1, LS2, LS3, LS5 session lifecycle tests (LS4 covered by helper tests — payout formula has full edge-case coverage in `learning-mode-helpers.test.ts`); all passing
- [x] W8.3 — CD1–CD5 cheating-defense tests; all passing
- [x] W8.4 — R1 integration receipt invariants + R2 (low-confidence surfacing) + R3 (no-hype tone) in helpers test; all passing
- [x] BONUS — `tests/learning-mode-helpers.test.ts` adds 29 pure-helper unit tests for parser/payout/phase/template-receipt invariants (LM-H1–LM-H7)

**Net new tests: +44 (S1–S4 = 4, LM-H1–LM-H7 = 29, session-lifecycle = 11). Plan target was +18.**

**Adjusted tests:** `tests/http-transport.test.ts` H2 and H4 updated for the +1 Manager tool (`view-session-receipt`) and the 4 new learner-free tools.

---

### Step 9 — Docs + production smoke (W9, ~1 hour) ⏳

**Files:** `README.md`, manual smoke

- [ ] W9.1 — README update (~15 min):
  - Add Sprint 4.0 section to roadmap
  - List the six major capabilities + the four new tools
  - Note math-only scope for 4.0
  - Reference research-4.0.md for the seven-layer cheating defense
- [ ] W9.2 — Production smoke per V1-V6 below (~45 min)

---

## Time tracking

| Phase | Estimate | Actual | Notes |
|-------|----------|--------|-------|
| Step 0 — Pre-sprint validation | 15 min | done | |
| Step 1 — Schema + state types | 2 hr | done | |
| Step 2 — Math curriculum fragments | 3 hr | done | Pedagogy is load-bearing IP |
| Step 3 — Four new tools | 3.5 hr | done | |
| Step 4 — Engagement + defense | 2.5 hr | done | Consolidated into `learning-mode.ts` |
| Step 5 — Receipt generation | 1 hr | done* | LLM-backed call deferred to 4.0.1; template fallback ships and satisfies R1–R3 |
| Step 6 — Payout settlement (new tool) | 1.5 hr | done | New `settle-session-payout` tool, distribute-allowance unchanged |
| Step 7 — Bootstrap form + configure-policy | 1.25 hr | partial | W7.3 (configure-policy follow-up notes) done; W7.1/W7.2 (verify.html form fields) deferred — plan fallback says studyPlan can be configured via Claude `configure-policy` post-bootstrap |
| Step 8 — Tests | 3 hr | done | +44 net new (plan target +18) |
| Step 9 — Docs + smoke | 1 hr | pending | README + V1–V6 smoke for next session |
| **Total** | **~19 hours** | — | 3 focused days or 4 sessions of ~5 hours |

---

## Session log

### Session 1 — 2026-05-21

**Goals:**
- Steps 0–2 (validation + schema + math curriculum fragments)
- Schema migration test green; first math fragment ready

**Outcomes:**
- Step 0 (pre-sprint validation): codebase scan complete. Key references: `src/schemas.ts:36-100` (new schemas), `src/tools/configure-policy.ts:101-129` (parent-input studyPlan boundary), `src/core/configure-family.ts:631-660` (normalizeChildren build path), `src/engine/learning-goals.ts:165-208` (merge that preserves studyPlan progress), `src/tools/distribute-allowance.ts:21-289` (clone model for `settle-session-payout` in Step 6).
- Step 1 complete. All four schema schemas added; LearningGoalSchema extended; 4 audit actions registered; HTTP + MCP boundaries widened; normalizeChildren + mergeLearningGoals updated; `tests/study-plan-schema.test.ts` shipped with S1–S4 all green.
- Full vitest run: 447 passed | 1 skipped, 45 files. No regressions from prior baseline. `npx tsc --noEmit` clean.

**Test count:** entering ~443 / exiting 447 + 1 skipped (+4 new S1–S4).

**Blockers:** none.

---

### Session 2 — 2026-05-21 (continued)

**Goals:**
- Steps 2–8 (curriculum, tools, defenses, receipt, payout, configure-policy notes, tests)

**Outcomes:**
- Step 2: 8 prompt fragments shipped under `src/prompts/math/` + `src/prompts/receipt-generator.md`, plus a README mapping fragments to consumers.
- Step 3: 4 new MCP tools shipped, registered on stdio + HTTP transports. RBAC extended.
- Step 4: cheating defense layers L1–L5 + L7 wired in; consolidated into `src/core/learning-mode.ts` helpers.
- Step 5: template-fill receipt ships (Decision 8 fallback). LLM-backed receipt is the only piece deferred and is one env-var wiring task away in 4.0.1.
- Step 6: `settle-session-payout` shipped as a new internal-only module (W6 strategy revision), preserving the existing 389+ distribute-allowance tests.
- Step 7.3: configure-policy now emits Learning Mode follow-up notes (`learningModeNotes[]` in response) when a math goal is added without a studyPlan or a non-math goal is added with one.
- Step 8: +44 new tests pass (target was +18). `tests/study-plan-schema.test.ts` (S1–S4), `tests/learning-mode-helpers.test.ts` (LM-H1–LM-H7, 29 tests), `tests/session-lifecycle.test.ts` (LS1–LS5 minus LS4 [covered in helpers], CD1–CD5, R1, math-only enforcement, 11 tests). Critical-path tests all green: S4, LS3, CD1, CD2, R1.
- `tests/http-transport.test.ts` H2 (manager tool count 17→18) and H4 (learner-free-tool list +4) updated to reflect Sprint 4.0 RBAC additions.

**Test count:** entering 447 / exiting 487 passing + 1 skipped, 47 files. Full suite green. `npx tsc --noEmit` clean.

**Deferred to a future session:**
- W7.1/W7.2 — verify.html bootstrap form UI for studyPlan (Claude `configure-policy` path covers studyPlan input today via W7.3 follow-up notes).
- Receipt LLM wiring — add `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` server-side call in `complete-learning-session` and swap the template fallback for the LLM-generated receipt. Decision 8 already specifies the env-var pattern.
- W9 README + V1–V6 production smoke.
- 30-min prompt-fragment spike (hard pre-sprint gate per plan.md sequencing item 3 — still unrun; needs Aiden + a real Claude/ChatGPT chat to validate the fragments induce Socratic mode).

**Blockers:** none for the next session. Aiden dogfooding is the qualitative gate before sprint-ship.

---

### Session 3 — TBD

**Goals:**
- Steps 5–7 (receipt + payout + bootstrap form)

**Outcomes:** [TBD]

---

### Session 4 — TBD

**Goals:**
- Steps 8–9 (tests + docs + smoke)
- Aiden dogfooding: first end-to-end math session

**Outcomes:** [TBD]

---

## Failed approaches

*(Empty until execution; populated during session log)*

---

## Production validation plan

After Step 9 deploy:

### V1 — Parent configures math study plan
- [ ] In Manager Claude session: "Set up Aiden's allowance: $5/week, 100% math. Goal: master 7th grade math, 15 days, 30 min/day."
- [ ] Confirm `configure-policy` accepts the studyPlan payload
- [ ] Verify `data/families/{id}/family-config.json` shows `studyPlan` with correct fields
- [ ] Audit log shows the policy update

### V2 — Kid's first session triggers baseline assessment
- [ ] Aiden invites + redeems + connects MCP (existing 3.6 flow)
- [ ] Aiden in Claude: "I want to start my math study today"
- [ ] Confirm `start-learning-session` fires
- [ ] Confirm tutor LLM runs baseline assessment (5-10 questions)
- [ ] Confirm baseline result stored in `studyPlan.baselineAssessment`
- [ ] Confirm audit entry `baseline-assessment-completed`

### V3 — Subsequent session runs Socratic tutoring with engagement scoring
- [ ] Next calendar day: Aiden in Claude: "Continue my math study"
- [ ] Tutor LLM runs Socratic tutoring on next phase
- [ ] Engagement scores emitted per turn (visible in session state via `get-session-state` if checked)
- [ ] Session ends with fresh assessment generated from today's content
- [ ] Audit entry `learning-session-completed` recorded
- [ ] Receipt rendered to parent's audit log

### V4 — USDC settles with engagement-weighted payout
- [ ] Confirm distribute-allowance fired with `sessionPayout` shape
- [ ] Treasury balance decreased by computed amount
- [ ] Aiden's wallet (or allowlist destination) received USDC
- [ ] Audit metadata includes engagement multiplier breakdown

### V5 — Cheating defense fires in adversarial test
- [ ] Aiden deliberately spams "ok" "yes" responses for 5 minutes
- [ ] Session completes with low engagement scores
- [ ] Confidence flag set to "low" (median turn interval < 5s)
- [ ] Receipt surfaces the flag to parent: "This session looked fast-paced — review before next settlement"
- [ ] USDC payout is reduced commensurately (avgEngagement low → payout low)

### V6 — Backward compat for non-math goals
- [ ] Configure a learning goal with category "reading" (no studyPlan)
- [ ] Confirm goal persists as tracker-only (no Learning Mode triggered)
- [ ] Confirm `verify-achievement` on that goal still works as in pre-4.0
- [ ] Confirm no errors in audit log

---

## Risks and known issues

### Risk 1 — Engagement-scoring LLM consistency

**Likelihood:** Medium
**Impact:** Tutor LLM forgets to emit "engagement: N" tags reliably; session payouts become zero or undefined
**Mitigation:** Receipt LLM post-hoc scoring as fallback (W4.1 fallback path). If consistency is bad even after prompt-engineering iteration, defer engagement-multiplier to Sprint 4.0.1 and ship completion-only payouts in 4.0. Same fallback class covers W4.4 `knownGaps`: if tutor LLM doesn't emit `knownGaps` at session end, receipt LLM extracts it from the transcript as an additional structured output field.

### Risk 2 — Math curriculum quality is mediocre

**Likelihood:** Medium
**Impact:** Pedagogy fragments produce decent-but-not-great tutoring; Aiden dogfooding feels rough
**Mitigation:** Write fragments carefully; test with Aiden before declaring sprint done. Accept that Sprint 4.0 ships a functional MVP; pedagogy improvements iterate in 4.0.x.

### Risk 3 — Cheating defense surfaces real gaming behavior from Aiden

**Likelihood:** Medium (he's a real 12-year-old)
**Impact:** Sessions get flagged or low engagement scores trigger reduced payouts; Aiden gets frustrated and abandons the pilot
**Mitigation:** Threshold tuning. If 0.85 engagement-minimum is too strict, lower to 0.70 in 4.0.1 based on observed data. Parent can override via `allowMakeupSessions` or manual session approval.

### Risk 4 — Mobile UX for 45-min text sessions is exhausting

**Likelihood:** High for sessions ≥ 30 min on a phone keyboard
**Impact:** Aiden quits before session completes; sprint's primary validation loop never closes
**Mitigation:** Start with shorter sessions (15-20 min) for dogfooding. Tablet > phone for prolonged sessions. Sprint 4.5 voice/video addresses this structurally.

### Risk 5 — USDC payout formula has edge cases

**Likelihood:** Medium
**Impact:** Sessions complete but payouts are wrong (zero, negative, doubled)
**Mitigation:** W6.1 explicit unit tests for payout formula. Bound checks: payout ≥ 0, payout ≤ weeklyBudget. If formula breaks in production, fall back to flat-rate-per-session in 4.0.1 hotfix.

### Risk 6 — Schema migration breaks existing families

**Likelihood:** Low (studyPlan is optional)
**Impact:** Pre-4.0 family configs fail to load
**Mitigation:** W1.5 backward-compat test gates the schema work. Don't deploy until pre-4.0 fixtures load cleanly.

### Risk 7 — Aiden's dogfooding is the only test for pedagogy quality

**Likelihood:** Certain
**Impact:** N=1 sample size; what works for Aiden may not work for other 12-year-olds
**Mitigation:** Acknowledged. Sprint 4.1 expands to one more dogfooding family. Pilot scale will surface issues that Aiden alone can't.

### Risk 8 — Receipt LLM produces marketing-shaped summaries

**Likelihood:** Medium
**Impact:** Receipts feel like ads for the kid's performance; lose honesty
**Mitigation:** W5.2 receipt prompt fragment explicitly instructs honesty about struggles. Manual review of first 10 receipts during dogfooding; tune prompt if drift detected.

### Risk 9 — Tutor LLM rejects baseline assessment role

**Likelihood:** Low
**Impact:** First session never completes baseline; entire flow breaks
**Mitigation:** Tested in the 30-min pre-sprint experiment. If fragile, baseline becomes a parent-configured difficulty level (parent specifies "intermediate" at goal creation) and skips LLM assessment.

---

## Definition of done

Sprint 4.0 is shippable when:

- [ ] All Sprint Contract success criteria 1–15 verified
- [ ] All 389+ prior tests still green
- [ ] +18 new tests passing (S1-S4, LS1-LS5, CD1-CD5, R1-R3)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` clean
- [ ] V1-V6 production smoke passed
- [ ] Aiden completed at least one full end-to-end session (baseline → tutoring → assessment → receipt → settlement) without manual intervention
- [ ] Parent receipt for that session reads honestly and informatively
- [ ] README updated
- [ ] One audit-log enum addition (the four new actions per Decision 5)
- [ ] Schema migration verified (pre-4.0 configs still parse)
- [ ] Decisions log captured in `research-4.0.md` (done)
- [ ] Plan captured in `plan-4.0.md` (done)
- [ ] Tests captured in `test-4.0.md` (done)
- [ ] This `progress-4.0.md` reflects actual completion state

---

## What ships next

**If 4.0 ships clean:**
- Aiden runs the 15-day math pilot end-to-end; capture session-level data on engagement, completion, cheating defense triggers
- Sprint 4.0.1 hotfix for any tuning surfaced by the pilot (threshold adjustments, prompt fragment improvements, receipt copy tweaks)
- Sprint 4.1 — subject expansion (reading comprehension + programming fundamentals); reuses 4.0 foundation, adds only new prompt fragments
- Landing page docs updated with real Learning Mode screenshots + Aiden's pilot story (anonymized)
- Charter school pitch deck: "AI tutor with structured accountability and USDC settlement"

**If 4.0 surfaces a fundamental issue:**
- Engagement scoring unreliable → defer to flat-rate payouts, document as known limitation, ship 4.0 with that gap, hotfix in 4.0.1
- Cheating defense too easy to game → tighten thresholds in 4.0.1
- Math pedagogy too weak → rewrite fragments in 4.0.1; the foundation is fine, the content needs iteration

**Subsequent sprints:**
- Sprint 4.5 — voice/video sessions for high-stakes scenarios (architectural lift)
- Sprint 5.0 — Coinbase Smart Wallet treasury migration (originally planned 4.0)
- Sprint 6.0+ — curriculum authoring tools for parents/educators, multi-language, kid-side dashboard UI

---

## Critical path through the sprint

If timing slips, the ship-floor is:

1. Schema additions (W1) — without these, nothing else exists
2. At least one math curriculum fragment (W2.2 or W2.3, plus W2.7 baseline + W2.8 engagement-scoring) — sufficient for end-to-end demo
3. `start-learning-session` + `complete-learning-session` (W3.1 + W3.3) — the core loop
4. Engagement parsing + daily limit (W4.1 + W4.2)
5. Receipt generation (W5)
6. Settlement (W6)
7. At least LS1, CD1, R1 tests passing
8. Aiden's first session completes end-to-end

Other workstreams (full curriculum library, `get-session-state`, `view-session-receipt`, bootstrap form UI, cool-down flag, state binding, full test suite) can defer to Sprint 4.0.1 without invalidating the sprint's core thesis. But shipping without them creates real polish debt — they should be the priority before declaring 4.0 complete.