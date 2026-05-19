# Sprint 4.0 — Progress

**Status:** Not Started
**Start date:** TBD (after Sprint 3.7 ships + 30-min Learning Mode prompt experiment passes)
**Target ship date:** TBD (~18 hours, 3 focused days or 4 sessions of 4.5 hours each)
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

### Step 1 — Schema + state types (W1, ~2 hours) ⏳

**Files:** `src/schemas.ts`, `tests/schema-migration.test.ts` (extend or NEW)

- [ ] W1.1 — Define `StudyPlanSchema` with fields: `durationDays`, `minutesPerSession`, `startedAt`, `sessionsCompleted`, `sessionsPlanned`, `currentPhase`, `baselineAssessment?`, `sessions: SessionRecord[]`, `allowMakeupSessions?: boolean`
- [ ] W1.1 — Define `SessionRecordSchema` with fields: `sessionId`, `date`, `durationMinutes`, `topic`, `assessmentPassed`, `assessmentScore?`, `conceptsCovered: string[]`, `knownGaps: string[]`, `avgEngagement`, `medianTurnIntervalSeconds`, `confidenceFlag: "ok" | "low"`, `usdcSettled`, `receiptSummary`
- [ ] W1.1 — Define `BaselineAssessmentSchema` with fields: `completedAt`, `score`, `level: "novice" | "intermediate" | "advanced"`, `gaps: string[]`
- [ ] W1.2 — Add `studyPlan: StudyPlanSchema.optional()` to LearningGoalSchema
- [ ] W1.3 — Add 4 audit-action enum values: `"learning-session-started"`, `"learning-session-completed"`, `"learning-session-flagged-low-confidence"`, `"baseline-assessment-completed"`
- [ ] W1.4 — Extend `configureFamilyBodySchema` (HTTP boundary) to accept `studyPlan` per learning goal as optional
- [ ] W1.5 — Backward-compat test: pre-4.0 family fixtures (no studyPlan field) load cleanly through `StateManager.loadFamilyConfig`
- [ ] W1.6 — Unit tests S1-S4 (per test-4.0.md) for new schema types

---

### Step 2 — Math curriculum prompt fragments (W2, ~3 hours) ⏳

**Files:** `src/prompts/math/*.md` (NEW directory)

- [ ] W2.1 — Create directory `src/prompts/math/` and add to repo
- [ ] W2.2 — Write `place-value.md` (~30 min):
  - Socratic patterns ("How many tens are in 47? How do you know?")
  - Common misconceptions ("Some kids think 102 has zero tens; probe with 'how many tens are in 100?'")
  - Assessment templates (3-5 question patterns referencing session content)
  - Scaffolding for struggle states
- [ ] W2.3 — Write `fractions.md` (same structure, 30 min)
- [ ] W2.4 — Write `decimals.md` (same structure, 30 min)
- [ ] W2.5 — Write `ratios.md` (same structure, 30 min)
- [ ] W2.6 — Write `pre-algebra.md` (same structure, 30 min)
- [ ] W2.7 — Write `baseline-assessment.md` (~20 min):
  - 5-10 question adaptive sequence
  - Starts at grade-level, branches up or down based on responses
  - Outputs structured assessment result (level + gaps)
- [ ] W2.8 — Write `engagement-scoring.md` (~15 min):
  - Instructions for tutor LLM to score each kid turn 1-5
  - Output format: `engagement: N` tag embedded in tutor response
  - Examples of low-score (1: "yes", "ok"; 2: "I don't know")
  - Examples of high-score (4: shows reasoning attempt; 5: references prior turn, asks follow-up)

---

### Step 3 — Four new tools (W3, ~3.5 hours) ⏳

**Files:** `src/tools/start-learning-session.ts` (NEW), `src/tools/get-session-state.ts` (NEW), `src/tools/complete-learning-session.ts` (NEW), `src/tools/view-session-receipt.ts` (NEW), `src/constants.ts`

- [ ] W3.1 — `start-learning-session.ts` (~60 min):
  - Input: `childName`, `goalTopic` (must match an existing LearningGoal with studyPlan)
  - Check daily session limit (L4): if `studyPlan.lastSessionDate === today` and `!allowMakeupSessions`, return error
  - Load current session state: which session # of N, current phase, knownGaps from prior sessions
  - If `sessionsCompleted === 0`: trigger baseline assessment path, return baseline prompt fragment
  - Else: return Socratic-tutoring prompt fragment for current phase
  - Output: `{success, sessionId, promptFragment, sessionState}`
  - Audit entry `learning-session-started`
- [ ] W3.2 — `get-session-state.ts` (~30 min):
  - Input: `sessionId`
  - Returns current session state for tutor LLM mid-session context recovery
  - Includes turn history, accumulating engagement scores, current phase
- [ ] W3.3 — `complete-learning-session.ts` (~75 min):
  - Input: `sessionId`, `engagementScores: number[]` (per kid turn), `assessmentResult: {questions, answers, score, passed}`, `transcript` (optional, used for receipt)
  - Compute `avgEngagement`, `medianTurnIntervalSeconds`, `confidenceFlag`
  - Persist as new `SessionRecord` in `studyPlan.sessions`
  - Update `studyPlan.sessionsCompleted`, `currentPhase`, `knownGaps`
  - Trigger `generate-session-receipt` (W5) and persist receipt to audit log
  - Compute USDC payout: `(weeklyBudget / sessionsPlanned) × (avgEngagement / 5) × completionRatio` (completionRatio = 1.0 if assessment passed, 0.5 if engagement ≥ 3 but assessment failed, 0.0 if engagement < 3)
  - Call existing `distribute-allowance` path to settle USDC (allowlist enforcement from Sprint 3.0.2 unchanged)
  - Audit entries: `learning-session-completed` (always), `learning-session-flagged-low-confidence` (if confidenceFlag === "low")
- [ ] W3.4 — `view-session-receipt.ts` (~30 min):
  - Input: `childName` (optional; defaults to caller's child if learner), `limit: number = 1`
  - RBAC: learner sees only own receipts; manager + co-parent + advisor see any child in family
  - Returns array of recent session receipts
- [ ] W3.5 — RBAC entries in `src/constants.ts`:
  - `start-learning-session` + `get-session-state` + `complete-learning-session` → learner only
  - `view-session-receipt` → all roles (with caller-scoping in the handler)
- [ ] W3.6 — Register all four tools in stdio + HTTP transport routes

---

### Step 4 — Engagement scoring + cheating defense layers (W4, ~2.5 hours) ⏳

**Files:** `src/core/engagement-parser.ts` (NEW), `src/core/session-state.ts` (NEW)

- [ ] W4.1 — Engagement-score parsing (~45 min):
  - Tutor LLM emits "engagement: N" tags in responses (per `src/prompts/math/engagement-scoring.md`)
  - Parser extracts the tag, stores score in session state alongside the turn
  - Fallback if tag missing: receipt LLM post-hoc scores the turn at session end
- [ ] W4.2 — Daily session limit (L4, ~15 min):
  - Check in `start-learning-session.ts`: if `studyPlan.lastSessionDate === todayUTC()` and `!allowMakeupSessions`, return clean error
- [ ] W4.3 — Cool-down statistical flag (L5, ~30 min):
  - Track per-turn timestamps in session state
  - At completion, compute `medianTurnIntervalSeconds`
  - If < 5 seconds, set `confidenceFlag: "low"`; audit `learning-session-flagged-low-confidence`
- [ ] W4.4 — Conversation-state binding (L3, ~45 min):
  - `knownGaps` field in studyPlan updated by tutor LLM each session via `complete-learning-session` input
  - Subsequent session prompts include knownGaps so assessment questions reference them
  - Grading LLM checks for self-reference: assessment answer must engage with session-specific framing or session is flagged
- [ ] W4.5 — Adaptive fresh assessment (L2, ~30 min):
  - Assessment generation in `engagement-scoring.md` instructs tutor to generate 3-5 questions from session transcript, with required self-reference to today's specific framing
  - Grading checks for substring/fuzzy match against session content; if generic ChatGPT answer detected, flag

---

### Step 5 — Receipt generation (W5, ~1 hour) ⏳

**Files:** `src/core/receipt-generator.ts` (NEW), `src/prompts/receipt-generator.md` (NEW)

- [ ] W5.1 — Receipt generator (~45 min):
  - Input: session transcript + studyPlan context + computed metadata (engagement avg, assessment result, USDC settled, confidence flag)
  - Output: ~200-word markdown summary for parent
  - Calls receipt LLM (same model family as tutor; separate call for editorial distance per Decision 8)
  - Summary structure: topic covered, what the kid did well, where they struggled, assessment outcome, confidence note if flagged, USDC settled
  - Stored as `receiptSummary` field on SessionRecord and as audit-log metadata on `learning-session-completed` entry
- [ ] W5.2 — Receipt template prompt fragment (~15 min):
  - `src/prompts/receipt-generator.md`
  - Instructs receipt LLM to write summary not transcript, honest about struggles, ~200 words
  - Tone: factual, not promotional; respects kid's learning privacy

---

### Step 6 — Payout formula + settlement (W6, ~1 hour) ⏳

**Files:** `src/tools/distribute-allowance.ts`, `src/tools/complete-learning-session.ts`

- [ ] W6.1 — Extend `distribute-allowance` (~45 min):
  - Accept a new optional input `sessionPayout: {sessionId, childName, amountUsdc, breakdown}` for engagement-weighted session-shaped payouts
  - Distinct path from the existing weekly-budget-distributed-by-category logic
  - Same allowlist enforcement (Sprint 3.0.2 unchanged)
  - Same savings-split rules (apply to session payouts too)
- [ ] W6.2 — Audit `learning-session-completed` metadata includes payout breakdown:
  - `baseRate`, `engagementMultiplier`, `completionRatio`, `payoutUsdc`, `txHash`

---

### Step 7 — Bootstrap form extension (W7, ~1 hour) ⏳

**Files:** `public/verify.html`

- [ ] W7.1 — Per learning goal in the goals section (~45 min):
  - Add conditional fields for `durationDays` (integer 1-60) and `minutesPerSession` (integer 15-60)
  - Show only when goal category === "math"
  - Helper text: "Set up a daily study plan. Claude will tutor your kid using Socratic guidance and grade their progress."
- [ ] W7.2 — Form serialization (~15 min):
  - Include `studyPlan: {durationDays, minutesPerSession}` in the configureFamilyBodySchema payload when fields are filled
  - Skip the field entirely when not filled (backward-compat path)

---

### Step 8 — Tests (W8, ~3 hours) ⏳

**Files:** `tests/study-plan-schema.test.ts` (NEW), `tests/session-lifecycle.test.ts` (NEW), `tests/cheating-defense.test.ts` (NEW), `tests/session-receipt.test.ts` (NEW)

- [ ] W8.1 — Schema tests S1-S4 (~30 min): per test-4.0.md
- [ ] W8.2 — Session lifecycle tests LS1-LS5 (~60 min): per test-4.0.md
- [ ] W8.3 — Cheating defense tests CD1-CD5 (~60 min): per test-4.0.md
- [ ] W8.4 — Receipt tests R1-R3 (~30 min): per test-4.0.md

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
| Step 0 — Pre-sprint validation | 15 min | — | |
| Step 1 — Schema + state types | 2 hr | — | |
| Step 2 — Math curriculum fragments | 3 hr | — | Pedagogy is load-bearing IP |
| Step 3 — Four new tools | 3.5 hr | — | |
| Step 4 — Engagement + defense | 2.5 hr | — | |
| Step 5 — Receipt generation | 1 hr | — | |
| Step 6 — Payout settlement | 1 hr | — | |
| Step 7 — Bootstrap form | 1 hr | — | |
| Step 8 — Tests | 3 hr | — | |
| Step 9 — Docs + smoke | 1 hr | — | |
| **Total** | **~18 hours** | — | 3 focused days or 4 sessions |

---

## Session log

### Session 1 — TBD

**Goals:**
- Steps 0–2 (validation + schema + math curriculum fragments)
- Schema migration test green; first math fragment manually tested in Claude

**Outcomes:** [TBD]

**Test count:** entering 389 / exiting —

**Blockers:** [TBD]

---

### Session 2 — TBD

**Goals:**
- Steps 3–4 (four new tools + engagement scoring + defense layers)

**Outcomes:** [TBD]

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
**Mitigation:** Receipt LLM post-hoc scoring as fallback (W4.1 fallback path). If consistency is bad even after prompt-engineering iteration, defer engagement-multiplier to Sprint 4.0.1 and ship completion-only payouts in 4.0.

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