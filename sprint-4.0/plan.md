# Sprint 4.0 — Learning Mode Foundation (Math)

## What this sprint ships

An LLM-led tutoring loop for one subject (math), with a seven-layer cheating defense (L1-L5 + L7), structured session state, fresh adaptive assessments, engagement-quality-based USDC settlement, and per-session parent receipts.

Five things change in the product after Sprint 4.0:

1. Parents configure `studyPlan` on a math learning goal: duration in days, minutes per session
2. Kid's MCP connector exposes new tools: `start-learning-session`, `get-session-state`, `complete-learning-session`, `view-session-receipt`
3. When the kid asks Claude or ChatGPT for help with their assigned math topic, the LLM (via prompt fragments returned from the tools) runs a baseline assessment on first session, then Socratic tutoring with engagement scoring on every session, then fresh adaptive end-of-session assessment with grading
4. USDC settlement per session = `(weeklyBudget / sessionsPlanned) × (avgEngagement / 5) × completionRatio`
5. Parent receives a structured session receipt after every session: engagement avg, topics covered, assessment result, USDC settled, confidence flag

## Why this cut is right

Three alternatives considered and rejected:

**Multi-subject Sprint 4.0 (math + reading + programming together).** Rejected because: (1) pedagogy varies meaningfully by subject and writing 3 high-quality fragment libraries triples scope, (2) math validation is unambiguous (right/wrong) making cheating-defense testable; reading and programming validation are essay-shaped and harder to grade, (3) Sprint 4.1 expansion is cheap after 4.0 proves the loop — better to prove first.

**Voice/video sessions in Sprint 4.0.** Rejected because: (1) MCP audio transport doesn't exist in standard form; would require custom architecture, (2) latency and quality requirements eat into the sprint's other deliverables, (3) text-based loop with engagement scoring is sufficient to prove the product thesis. Voice is Sprint 4.5+ for high-stakes scenarios.

**Skip Sprint 4.0 and go directly to Sprint 5.0 (Coinbase Smart Wallet treasury, originally planned Sprint 4.0).** Rejected because: (1) the wallet migration is architecturally meaningful but doesn't differentiate the product to pilot families, (2) Learning Mode is what makes AllowMe pitchable as an education tool rather than an allowance app, (3) Sprint 5.0 (renamed) follows 4.x naturally once Learning Mode foundation is real.

The chosen cut — single-subject Learning Mode with full cheating defense, text-based — is the minimum that proves the product thesis and unblocks Sprint 4.1+ expansion.

## Feature summary

Sprint 4.0 ships:

- **Schema extension** — `LearningGoal.studyPlan?: StudyPlan` field. `StudyPlan` includes `durationDays`, `minutesPerSession`, `startedAt`, `sessionsCompleted`, `sessionsPlanned`, `currentPhase`, `baselineAssessment?`, `sessions: SessionRecord[]`. Backward-compatible (optional field).
- **Four new MCP tools** — `start-learning-session`, `get-session-state`, `complete-learning-session`, `view-session-receipt`. Wired into RBAC: learner can call all four; manager + co-parent can view receipts but not start/complete sessions.
- **Math curriculum prompt fragments** — pedagogy library covering: place value, fractions, decimals, ratios, pre-algebra. Each fragment specifies Socratic patterns, common misconceptions to probe, assessment generation templates, scaffolding for struggle states.
- **Engagement scoring infrastructure** — the tutor LLM, prompted by fragment, returns engagement score (1-5) for each kid turn. AllowMe stores in session state turn-by-turn. Final session avg drives payout.
- **Baseline assessment generation** — on first session of a math study plan, tutor LLM runs a 5-10 question adaptive assessment to calibrate starting level (`novice` / `intermediate` / `advanced`) and identify gaps.
- **Adaptive end-of-session assessments** — each session ends with 3-5 fresh questions generated from session content, with required self-reference to the session's specific framing. Grading done by tutor LLM with access to session transcript.
- **Cool-down statistical flagging** — session state tracks median turn interval. Sessions with `medianTurnIntervalSeconds < 5s` are flagged `confidence: "low"` and the receipt surfaces this to the parent.
- **Daily session limits** — `studyPlan.lastSessionDate` prevents starting a new session on the same calendar day, unless `allowMakeupSessions` is explicitly set.
- **Parent session receipts** — `generate-session-receipt` produces a ~200-word summary after every session. Stored in audit log; parent retrieves via `view-session-receipt` or sees in `check-progress` digest.
- **Payout formula change** — session payout = `(weeklyBudget / sessionsPlanned) × (avgEngagement / 5) × completionRatio`. Settles via existing `distribute-allowance` path; allowlist enforcement from Sprint 3.0.2 unchanged.

The diff touches `src/schemas.ts` (real schema additions), four new tool files under `src/tools/`, prompt fragment library under `src/prompts/math/`, `src/core/configure-family.ts` (extend to accept studyPlan), `src/tools/configure-policy.ts` (extend MCP arg schema), `public/verify.html` (bootstrap form learns studyPlan), plus tests across multiple new files.

## Architecture decisions

### Decision 1 — Engagement scoring is the primary payout metric
**Decision:** Session payout = `base × avgEngagement/5 × completionRatio`. Time-on-task is necessary but not sufficient. Per research-4.0.md Decision 1.

### Decision 2 — Parent receipts ship in 4.0
**Decision:** Every completed session generates a parent-facing receipt. Manager + co-parent + advisor read access. Per research-4.0.md Decision 2.

### Decision 3 — Math only in 4.0
**Decision:** Only math has pedagogy fragments. Other subjects fall back to tracker-only mode with a clear configure-policy response note. Per research-4.0.md Decision 3.

### Decision 4 — Seven-layer cheating defense, layers 1-5 + 7
**Decision:** L1-L5 + L7 active in 4.0. L6 (voice/video) deferred. Per research-4.0.md Decision 4.

### Decision 5 — Schema changes are intentional
**Decision:** `LearningGoal.studyPlan` and `SessionRecord` are new schema types. Four new audit-log enum values: `learning-session-started`, `learning-session-completed`, `learning-session-flagged-low-confidence`, `baseline-assessment-completed`. Per research-4.0.md Decision 5.

### Decision 6 — Tutor LLM is the kid's existing AI client
**Decision:** No separate model deployment. Prompt-fragment-induced Learning Mode behavior. Per research-4.0.md Decision 6.

### Decision 7 — Sessions are atomic single-sittings
**Decision:** A session is one continuous conversation. If interrupted, the kid restarts. No mid-session pause/resume. Simpler state machine.

**Why:** session continuity within a single conversation is reliable; cross-conversation resume requires the LLM to fully restore tutoring context from state, which is more fragile. Atomic sessions accept the trade-off that interrupted sessions are wasted in exchange for robustness.

### Decision 8 — Receipt LLM call is separate from tutor LLM call
**Decision:** When a session completes, `complete-learning-session` triggers a separate LLM call to generate the parent receipt. The tutor's session transcript is the input; the receipt is the output.

**Receipt LLM provider:** the **same model family the kid's MCP client uses** for tutoring (Claude via Anthropic, or ChatGPT via OpenAI). The receipt call is issued server-side by AllowMe through its own API credential (not the kid's client) so the receipt prompt and output are not visible to the kid. Server-side API key lives in the existing env var pattern (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — pick one at deploy time; default Anthropic). If the env var is unset, receipt falls back to a deterministic template-fill from session metadata (engagement avg, topics, assessment result, USDC settled) — degraded quality but always-shippable.

**Why separate calls:** the tutor was advocating for the kid throughout the session. The receipt needs editorial distance — what the parent sees should be honest about both successes and struggles. Separating the calls is the simplest way to keep that distance.

**Why server-side:** if the receipt were generated by the kid's client, the kid would see the parent's receipt being composed in real time, defeating the editorial-distance goal.

---

## Implementation steps

### Workstream W1: Schema + state types (~2 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W1.1 | Define `StudyPlan` and `SessionRecord` Zod schemas in `src/schemas.ts` | Medium | 30m |
| W1.2 | Add optional `studyPlan` field to `LearningGoalSchema` | Low | 10m |
| W1.3 | Add 4 new audit-action enum values | Low | 10m |
| W1.4 | Extend `configureFamilyBodySchema` (HTTP boundary) to accept studyPlan | Low | 15m |
| W1.5 | Migration test — pre-4.0 family configs still parse and load | Medium | 30m |
| W1.6 | Unit tests for schema validity on new types | Low | 25m |

### Workstream W2: Math curriculum prompt fragments (~3 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W2.1 | Create `src/prompts/math/` directory structure with one fragment per topic | Low | 15m |
| W2.2 | Write `place-value.md` — Socratic patterns, common misconceptions, assessment templates | High | 30m |
| W2.3 | Write `fractions.md` — same structure | High | 30m |
| W2.4 | Write `decimals.md` — same structure | High | 30m |
| W2.5 | Write `ratios.md` — same structure | High | 30m |
| W2.6 | Write `pre-algebra.md` — same structure | High | 30m |
| W2.7 | Write `baseline-assessment.md` — adaptive starting calibration | High | 20m |
| W2.8 | Write `engagement-scoring.md` — instructions for tutor LLM to score each turn | Medium | 15m |

### Workstream W3: Four new tools (~3.5 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W3.1 | `src/tools/start-learning-session.ts` — checks daily limit, loads studyPlan state, returns prompt fragment + session ID + baseline-assessment-trigger if first session | High | 60m |
| W3.2 | `src/tools/get-session-state.ts` — returns current session state for tutor LLM to recover context mid-session | Medium | 30m |
| W3.3 | `src/tools/complete-learning-session.ts` — receives engagement scores per turn + assessment result, stores session record, triggers receipt LLM, settles USDC via distribute-allowance | High | 75m |
| W3.4 | `src/tools/view-session-receipt.ts` — returns latest receipt for caller (kid sees their own; parent sees all kids in family) | Medium | 30m |
| W3.5 | RBAC entries in `src/constants.ts` | Low | 10m |
| W3.6 | Register all four tools in stdio + HTTP transports | Low | 15m |

### Workstream W4: Engagement scoring + cheating defense layers (~2.5 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W4.1 | Engagement-score parsing from tutor LLM output (the tutor returns a structured "engagement: 4" tag per turn; W4.1 extracts and stores) | High | 45m |
| W4.2 | Daily session limit enforcement in `start-learning-session` (L4) | Low | 15m |
| W4.3 | Cool-down statistical flag — median turn interval calculated at session completion, low-confidence flag set if < 5s (L5) | Medium | 30m |
| W4.4 | Conversation-state binding — `knownGaps` field updated turn-by-turn by tutor LLM; included in subsequent session contexts (L3) | High | 45m |
| W4.5 | Adaptive fresh assessment — assessment questions generated by tutor LLM at session end using actual transcript (L2) | Medium | 30m |

### Workstream W5: Receipt generation (~1 hour)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W5.1 | `src/core/receipt-generator.ts` — calls receipt LLM with session transcript + study plan context, produces ~200-word summary | High | 45m |
| W5.2 | Receipt template prompt fragment — `src/prompts/receipt-generator.md` | Medium | 15m |

### Workstream W6: Payout formula + settlement (~1.5 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W6.1 | **New tool** `src/tools/settle-session-payout.ts` — takes `{sessionId, childName, amountUsdc, breakdown}`, applies savings-split + allowlist enforcement (same helpers as `distribute-allowance`), executes USDC transfer, writes audit entry. Distinct from `distribute-allowance` to preserve blast radius on the existing 389+ tests; reuses `WalletDistributor`, `FamilyKeyManager`, and `PolicyEngine.calculateSavingsSplit`. Invoked internally by `complete-learning-session`, not exposed as an MCP-callable tool. | High | 60m |
| W6.2 | Audit entry `learning-session-completed` includes payout breakdown for transparency (`baseRate`, `engagementMultiplier`, `completionRatio`, `payoutUsdc`, `txHash`) | Low | 15m |
| W6.3 | Unit tests for `settle-session-payout` invariants: payout ≥ 0, payout ≤ weeklyBudget/sessionsPlanned, allowlist enforcement matches `distribute-allowance` | Medium | 15m |

### Workstream W7: Bootstrap form + configure-policy extension (~1.25 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W7.1 | `public/verify.html` — per learning goal, add fields for `durationDays` and `minutesPerSession` (only shown for math-category goals; other categories stay tracker-only) | Medium | 45m |
| W7.2 | Form serialization includes the studyPlan payload | Low | 15m |
| W7.3 | `src/tools/configure-policy.ts` — when a manager adds a math-category goal via Claude without a studyPlan, the tool response includes a follow-up prompt: `"Want a daily study plan for this goal? Reply with: duration in days, minutes per session."` Parsed by Claude and round-tripped via the same tool call. Backward-compatible: parents who decline get the existing tracker-only behavior. | Medium | 15m |

### Workstream W8: Tests (~3 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W8.1 | Schema tests (S1-S4) — studyPlan validity, backward compat with pre-4.0 configs | Medium | 30m |
| W8.2 | Session lifecycle tests (LS1-LS5) — start, mid-session state, complete, receipt generation, payout settlement | High | 60m |
| W8.3 | Cheating defense tests (CD1-CD5) — engagement scoring, daily limit, cool-down flag, state binding, adaptive assessment | High | 60m |
| W8.4 | Receipt tests (R1-R3) — receipt content quality, privacy (no full transcript), parent-vs-kid visibility | Medium | 30m |

### Workstream W9: Documentation + smoke (~1 hour)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W9.1 | README.md — add Sprint 4.0 to roadmap | Low | 15m |
| W9.2 | Production smoke per progress-4.0.md V1-V6 | High | 45m |

---

## Time allocation

| Phase | Hours | Cumulative |
|-------|-------|-----------|
| W1 — Schema + types | 2.0 | 2.0 |
| W2 — Math curriculum fragments | 3.0 | 5.0 |
| W3 — Four new tools | 3.5 | 8.5 |
| W4 — Engagement scoring + defense | 2.5 | 11.0 |
| W5 — Receipt generation | 1.0 | 12.0 |
| W6 — Payout settlement (new tool) | 1.5 | 13.5 |
| W7 — Bootstrap form + configure-policy | 1.25 | 14.75 |
| W8 — Tests | 3.0 | 17.75 |
| W9 — Docs + smoke | 1.0 | 18.75 |

**Total: ~19 hours.** Three focused days, or four 5-hour sessions. The +1h vs prior estimate covers the explicit `settle-session-payout` tool (W6) and the configure-policy follow-up (W7.3).

The math curriculum fragments (W2) and the engagement-scoring infrastructure (W4) are the time bombs. If pedagogy or prompt engineering surface unexpected complexity, those workstreams can grow. Receipt generation (W5) and payout (W6) are relatively bounded.

## Dependencies and risks

| Dependency | Risk | Mitigation |
|-----------|------|------------|
| 30-min prompt-fragment experiment validated Learning Mode behavior | High if not done | Run the experiment BEFORE Sprint 4.0 starts. If fragments don't reliably induce Socratic mode in Claude or ChatGPT, scope changes. |
| Sprint 3.6 closure complete + Sprint 3.7 shipped | Medium | Both must land first. Sprint 4.0 builds on the design-completeness baseline. |
| Schema migration is forward-compat | Low | W1.5 backward-compat test gates the schema work. Pre-4.0 configs must continue to parse. |
| Engagement-scoring LLM consistency | Medium | The tutor LLM must reliably emit "engagement: N" tags per turn. Prompt engineering iteration may be needed. If unreliable, fall back to "ask the LLM at end of session to score the whole session" — coarser but more reliable. |
| Math curriculum quality | Medium | Pedagogy is the load-bearing IP. If fragments are weak, the sprint ships a working loop with poor educational content. Mitigation: write fragments carefully, test with Aiden as dogfooding subject before declaring sprint done. |
| Cheating defense holds against real kid behavior | Medium | Layers 1-5 are designed for typical motivation, not adversarial sophistication. Aiden dogfooding will surface real gaming attempts; tune thresholds in Sprint 4.0.1 hotfix if needed. |
| USDC payout formula edge cases | Low | Existing distribute-allowance handles small amounts; engagement-weighted is just a multiplier. Allowlist enforcement (Sprint 3.0.2) unchanged. |
| Existing test suite stays green | Medium | All changes additive at the canonical schema layer. Run full suite after each W. |
| Mobile UX on the kid's device for long sessions | Medium | A 45-min tutoring session on a phone keyboard is fatiguing. Worth surfacing to the parent. Sprint 4.5+ may explore voice for this reason. |

## Fallback approaches

- **W2 math fragments don't induce reliable Socratic behavior:** rewrite fragments with more explicit step-by-step instructions to the LLM ("First ask X. Wait for response. Then ask Y. If response shows misconception Z, do W."). More verbose but more reliable.
- **W4.1 engagement-score parsing is fragile (tutor LLM forgets to emit the tag):** add post-hoc scoring — at session end, ask the receipt LLM to score each turn retroactively. Slower but more reliable.
- **W4.4 `knownGaps` not emitted reliably by tutor LLM at session end:** receipt LLM extracts `knownGaps` from session transcript as part of receipt generation (same call, additional structured output field). Slower but covers the failure mode without a second LLM round-trip.
- **W3.3 USDC settlement complexity:** if engagement-weighted payouts surface bugs in distribute-allowance, ship session-completion-only payouts (no engagement multiplier) as a stopgap. Engagement scoring still happens and is visible in the receipt; just doesn't affect the dollar amount in 4.0. Activate the multiplier in 4.0.1.
- **W7 bootstrap form complexity:** if studyPlan UI in the form gets unwieldy, defer to parent configuring via Claude `configure-policy` post-bootstrap. Less smooth but ships.
- **Aiden dogfooding surfaces unfixable issues:** ship with documented limitations rather than hold the sprint. The pilot has to be real before all the polish lands.

---

## Sprint Contract — Sprint 4.0

### Success criteria

1. **Parent can configure a math study plan.** Via Claude `configure-policy` or bootstrap form: subject (math), duration (e.g., 15 days), minutes per session (e.g., 30 min). Study plan persists in `LearningGoal.studyPlan`.
2. **Kid's first session triggers baseline assessment.** `start-learning-session` returns prompt fragment that instructs tutor LLM to run a baseline; tutor runs it; result stored in `studyPlan.baselineAssessment`.
3. **Subsequent sessions follow study-plan progression.** `start-learning-session` returns current-phase context and Socratic tutoring fragment. Tutor LLM picks up where prior session left off.
4. **Engagement scoring fires turn-by-turn.** Tutor LLM emits engagement score per kid turn; AllowMe parses and stores. Session state shows accurate per-turn scores.
5. **End-of-session assessment generated fresh.** Assessment questions reference session-specific content (transcripts include topic-of-the-day framing); copy-paste-to-other-LLM attacks fail integrity check.
6. **Session completion settles USDC via formula.** Payout = `(weeklyBudget / sessionsPlanned) × (avgEngagement / 5) × completionRatio`. Settles to learner's allowlisted wallet via existing distribute-allowance path.
7. **Receipt generated and stored.** Parent receives ~200-word summary via audit log entry `learning-session-completed`. Receipt includes engagement avg, topics, assessment result, USDC settled.
8. **Daily session limit enforced (L4).** Second session attempt on same calendar day returns clean error: "You've completed today's session — come back tomorrow for the next one."
9. **Cool-down flag fires when warranted (L5).** Session with median turn interval <5s gets `confidence: "low"`; receipt surfaces this to parent.
10. **Conversation-state binding works (L3).** Assessment questions reference earlier session moments. Grading checks for session-context engagement.
11. **Adaptive assessment regenerates each session (L2).** Different sessions produce different assessment question sets, not from a fixed bank.
12. **Math-only enforcement.** A configure-policy call setting studyPlan on a non-math goal **silently accepts the studyPlan but does not activate Learning Mode** for that goal. The configure-policy response includes a note: `"studyPlan accepted for tracking, but Learning Mode is math-only in Sprint 4.0 — this goal will continue as tracker-only."` Chosen over hard-reject because parents adding multi-subject goals shouldn't get blocking errors; the note teaches the boundary without breaking their flow.
13. **Backward compat preserved.** Pre-4.0 families' goals load without errors. Goals without studyPlan continue to behave as today's tracker.
14. **All Sprint 3.7 tests still pass.** No regression from the +18 new tests.
15. **Mobile smoke passes.** A learning session runs to completion on a real iOS device with Claude mobile, including engagement scoring, assessment grading, and receipt generation.

### Dynamic Rubric

**Note on rubric deviation from planner-skill presets:** the skill defines Security-critical / Frontend-UX / Infrastructure presets. Sprint 4.0 is a hybrid product-capability + behavioral-defense + economic-logic feature; no preset fits cleanly. The custom 7-category split below grades what's actually being built. Weights were revised from an earlier draft to (a) reduce the slice gated by N=1 dogfooding, (b) raise mobile to match its hard-gate status in success criterion 15, and (c) add an explicit audit-log slice since post-hoc evidence is the only operator-visible proof the system worked.

| Category | Weight | Justification |
|----------|--------|---------------|
| Pedagogical quality (math fragments + LLM behavior) | 20% | Load-bearing IP, but graded only by Aiden dogfooding (N=1). 20% acknowledges importance without over-weighting an unautomatable signal. |
| Cheating defense robustness | 30% | Layers 1-5 + 7. Mechanically testable via CD1-CD5. Tested with Aiden as adversary-simulator during smoke. Largest single slice because it's both critical and verifiable. |
| Engagement scoring + settlement correctness | 15% | The economic loop must compute correctly. Engagement-weighted payouts must arrive at the right wallet via existing allowlist enforcement. |
| Test coverage | 15% | +18 new tests must land; existing 389+ tests must stay green. |
| Mobile usability | 10% | Real iOS session completion is criterion 15's hard gate. Weight matches its blocking status. |
| Audit-log completeness | 5% | Four new action types + payout-breakdown metadata are the only post-hoc evidence the parent/operator has that the system worked. Easy to verify; cheap slice. |
| Backward compat | 5% | Pre-4.0 families' goals must continue to work. Gated by a single test (S4). Low effort, low slice. |

### Grading thresholds

- **Pass:** All success criteria 1–15 verified. No category below 70%. Aiden dogfooding produces at least one successful end-to-end session (baseline → tutoring → assessment → receipt → settlement) without manual intervention. Total weighted score ≥80%.
- **Fail:** Any of (1)–(15) fails. OR existing test suite regresses. OR Aiden's first session is unable to complete without manual intervention. OR total weighted score <70%.

### Success conditions beyond the rubric

- A pilot family running Sprint 4.0 for 7 days produces 5+ completed sessions, demonstrating habit formation potential
- The parent reading the receipts can articulate what the kid learned that week without needing to read transcripts
- The cheating defense flags at least one suspicious session during the dogfooding period (if it never flags anything, either the kid is honest or the thresholds are too lax — tune in 4.0.1)
- The product becomes demoable to a charter school administrator without needing to apologize for any visible gaps

---

## Scope guard — explicitly NOT in Sprint 4.0

1. Subjects beyond math (Sprint 4.1)
2. Voice or video sessions (Sprint 4.5+)
3. Coinbase Smart Wallet treasury migration (renamed to Sprint 5.0)
4. Paymaster sponsorship (Sprint 5.0)
5. Postgres migration (Sprint 5.0)
6. Spanish-language sessions (Sprint 4.5+)
7. Real-time parent monitoring or live observation (Sprint 5.0+)
8. Curriculum authoring tools for parents
9. Multi-kid parallel sessions (each kid runs their own sessions independently; sprint doesn't address coordination across siblings)
10. Cross-family curriculum sharing
11. Public leaderboards, badges, or social gamification
12. Adaptive subject selection (the LLM picks what to teach)
13. Parent-as-tutor mode (parents don't run sessions)
14. Session pause/resume across days
15. Goal modification mid-curriculum (kid can't change topic; parent can revoke + recreate)
16. Push notifications for session reminders
17. Calendar integration
18. Curriculum import from external sources
19. Multi-language (English only)
20. Under-8 age-appropriate framing (assumes ages 10-14)

## Sequencing

1. ✅ Sprint 3.6 closure complete
2. ✅ Sprint 3.7 shipped (URL design + matcher + polish)
3. ⏳ 30-min prompt-fragment experiment validates Learning Mode behavior (**not yet run** — pre-sprint gate, see progress.md checklist)
4. **→ Sprint 4.0 — Learning Mode Foundation (Math) (this sprint)**
5. Sprint 4.1 — Subject expansion (reading comprehension + programming fundamentals)
6. Sprint 4.5 — Voice/video for high-stakes sessions
7. Sprint 5.0 — Coinbase Smart Wallet treasury (originally planned 4.0)
8. Sprint 6.0+ — curriculum authoring, multi-language, dashboard UI

Sprint 4.0 unblocks:
- Honest "AI tutor with skin in the game" pitch to charter schools
- Pilot deployment with Success Academy or similar institutional partner
- Demoable Learning Mode for press / education conferences
- Sprint 4.1's subject expansion (cheap once 4.0 foundation is proven)

## Pre-sprint checklist

- [ ] Sprint 3.6 closure complete (GIFs live, V1-V6 smoke passed)
- [ ] Sprint 3.7 shipped (URL design, subgoal matcher, polish)
- [ ] All 389+ tests green
- [ ] **30-min Learning Mode prompt-fragment experiment passed** — Claude and ChatGPT reliably shift to Socratic mode when given a fragment
- [ ] Aiden ready and willing to be the math dogfooding subject (he is the load-bearing pilot user)
- [ ] Q1 confirmed: 1-5 engagement scale (per research)
- [ ] Q2 confirmed: flexible daily session limit with `allowMakeupSessions` flag (per research)
- [ ] Q3 confirmed: baseline once at start, retake on parent request (per research)
- [ ] Backup of production data taken
- [ ] Test treasury still funded on Base Sepolia for settlement smoke
- [x] Decision on receipt LLM provider — **resolved in Decision 8 above:** same model family as tutor LLM, called server-side via AllowMe's own API credential (`ANTHROPIC_API_KEY` default, `OPENAI_API_KEY` alternative). Deterministic template-fill fallback if env var unset.