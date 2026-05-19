# Sprint 4.0 — Research: Learning Mode Foundation

## Problem

AllowMe today is a reward-shaped allowance tracker. A parent sets goals, a kid self-reports achievements, a parent verifies, USDC settles. The system is honest about what it is: an agent-native version of "pay your kid when they read." That's a parenting tool.

What it isn't, yet, is an *education* tool. The kid does the learning alone, on their own terms, with no guidance. Whether the kid actually learned anything is on the honor system. Whether the topic was structured progressively is up to the kid. Whether the time spent was real learning or distracted scrolling is unknown to anyone, including the parent.

Sprint 4.0 reframes the product around a fundamentally different loop: **the LLM leads the learning, the parent sets the intent, AllowMe coordinates the validation and settlement.** When a parent assigns "master 7th grade math by August 15" or "learn about Hamlet in 15 sessions," Claude or ChatGPT becomes the kid's tutor — running baseline assessments, designing session arcs, conducting Socratic dialogue, generating fresh assessments per session, scoring engagement quality turn-by-turn, and validating that learning actually happened before USDC settles.

This is a real product shift. It moves AllowMe from "parenting app with crypto rewards" to "AI-led tutoring environment with structured accountability." The first version is a niche utility; the second is something demoable to Success Academy, presentable at education conferences, and competitive with Khan Academy on personalization while being competitive with consumer AI tutors on accountability.

## Why now

Three forcing functions:

**1. The 3.6/3.7 design-completeness arc is finishing.** Sprint 3.6 shipped the install walkthrough, rich cards, QR codes, brand modals, failure recovery. Sprint 3.6 closure ships the GIFs and production smoke. Sprint 3.7 ships the URL design pass + subgoal matcher + polish. After that, the *parenting app* version of AllowMe is at design completeness 8+. The marginal returns on more polish are low.

**2. The pilot family conversation requires a differentiated product.** "Allowance tracker with USDC" is interesting to crypto-native families and dismissible to everyone else. "AI tutor with structured accountability and skin in the game" is interesting to charter schools, education researchers, and any parent who's watched their kid use ChatGPT to do homework without learning anything. The second framing is the one that survives press scrutiny and pilot evaluation.

**3. The architecture is mature enough to handle it.** Sprint 3.0.5 ships bootstrap-form goal capture. Sprint 3.7 ships subgoal auto-matching. The data model for "what should this kid be learning" exists. Sprint 4.0 builds on it rather than rebuilding it.

## The product reframe, concretely

**Today's loop:**
```
Parent sets goal → Kid does work alone → Kid self-reports → Parent verifies → USDC settles
```

**Sprint 4.0 loop:**
```
Parent sets learning intent (subject + duration + session length)
  → LLM kicks off, runs baseline assessment, designs session arc
  → Per session: LLM runs Socratic tutoring, scores engagement turn-by-turn
  → End of session: LLM generates fresh assessment from session content, grades it
  → Session record stored: engagement avg, assessment score, concepts covered
  → Parent receives session receipt (summary, not transcript)
  → USDC settles based on engagement quality × completion ratio
```

Three things shift:

1. **The LLM leads, not the kid.** AllowMe knows what session this is in the sequence, what to teach today.
2. **Progress is structured.** "Day 8 of 15-day Hamlet study, on Act III analysis" with knowledge built progressively.
3. **Validation is LLM-generated and LLM-graded.** Not self-reported. Not parent-verified. The tutor LLM owns both pedagogy and verification.

## Locked decisions

### Decision 1 — Engagement quality is the primary payout metric (not time-on-task)

**Decision:** USDC payout per session = `base rate × average engagement score (1-5) × completion ratio`. Time-on-task is necessary but not sufficient; engagement quality is the multiplier.

**Why:**

1. **Kills the obvious gaming modes.** A kid who responds "yes" "OK" "I see" for 45 minutes earns near-zero. A kid who actively reasons through 5 problems in 20 minutes earns more. The incentive shape matches the behavior the product is trying to produce.

2. **Reframes the kid's mental model.** Today the kid is "surviving" the requirement to earn money. Tomorrow the kid is "engaging well enough" to earn money. Subtle but important — the second framing aligns the kid with their own learning rather than against it.

3. **Engagement is LLM-evaluable.** Claude and ChatGPT can reliably distinguish low-effort filler from substantive engagement. Score 1: spam, single-word, off-topic. Score 5: shows reasoning, makes attempts, asks follow-ups, references prior context. The middle scores naturally calibrate.

4. **Time-on-task remains a signal but not the signal.** Median turn interval, total session duration, and pacing are all tracked as confidence indicators that flag suspicious sessions for parent review. They're not the primary economic signal.

**Implementation:** every kid turn gets a 1-5 engagement score from the tutor LLM, computed inline as part of the tutor's response generation. Score is hidden from the kid in real-time but logged in session state. Final session payout = `(weeklyBudget / sessionsPlanned) × (avgEngagement / 5) × completionRatio`.

### Decision 2 — Parent receives a session receipt every session

**Decision:** After every learning session, the parent receives a structured summary: engagement average, topics covered, assessment result, struggles + breakthroughs, USDC settled. Summary, not transcript — kid retains conversational privacy with the LLM, parent receives outcome visibility.

**Why:**

1. **The receipt is the visible artifact that proves the system works.** Without it, the parent has no signal that engagement scoring actually fired, that assessments actually graded, that the cheating defense layers actually held. The parent's trust in the system requires visible evidence.

2. **Social cost is one of the strongest deterrents at this age.** A 12-year-old who sees that low-engagement sessions produce embarrassing receipts ("Aiden's session: engagement 1.2, flagged for fast-paced responses, no concepts demonstrated") behaves differently than one who only sees their own USDC balance. The parent receiving the receipt — and the kid knowing the parent receives it — is the accountability mechanism.

3. **Privacy balance is correct.** Full transcripts would create surveillance dynamics; bare USDC settlement would create opacity. The summary middle ground respects both ends: the kid has space to ask "dumb" questions without parental judgment; the parent gets enough signal to know if the system is working.

**Implementation:** new tool `generate-session-receipt` called server-side after `record-session-completion`. Receipt LLM call (separate from tutor LLM call to preserve neutrality) produces ~200-word summary. Receipt stored in audit log with new action `learning-session-completed`. Future surface: parent's daily/weekly digest, currently delivered as a structured field they can ask about via `check-progress`.

### Decision 3 — Math is the first and only Sprint 4.0 subject

**Decision:** Sprint 4.0 ships Learning Mode for math only. Other subjects (reading comprehension, programming, history, science) are explicitly out of scope until Sprint 4.1 dogfooding data on math is real.

**Why:**

1. **Math has the cleanest validation surface.** Answers are right or wrong. Assessments can be auto-graded with high confidence. The cheating defense layers are testable because the validation signal is unambiguous. Hamlet and 3D printing have meaningful pedagogy but their validation is essay-shaped and subjective — harder to make work for a first version.

2. **Math has well-defined pedagogical progression.** Place value → fractions → decimals → ratios → pre-algebra is a real curriculum that exists in textbooks, that aligned charter school standards already track, that Claude and ChatGPT both reason about competently. Sprint 4.0 doesn't have to invent the curriculum — it has to coordinate it.

3. **Math is the subject Aiden's example references most directly.** "Catch up to 7th grade math by August 15" is a real product-shaped goal with a deadline and measurable progress. The dogfooding loop is concrete.

4. **Sprint 4.1 expansion is cheaper after Sprint 4.0 proves the math loop.** Reading comprehension can borrow the engagement-scoring framework, the receipt structure, the cheating defenses — and only needs new pedagogy fragments. Programming fundamentals same. Avoiding the multi-subject scope creep in 4.0 means the foundation is real before it scales.

### Decision 4 — Seven-layer cheating defense, layers 1-5 in Sprint 4.0

**Decision:** Sprint 4.0 ships engagement-quality scoring (L1), adaptive fresh assessments (L2), conversation-state binding (L3), daily session limits (L4), and cool-down/turn-interval statistical flagging (L5). Layer 6 (voice/video) is deferred to Sprint 4.5+. Layer 7 (parent receipt) ships in 4.0 per Decision 2.

**Why each layer is necessary:**

- **L1 (Engagement quality):** primary economic signal; kills spam and walkaway gaming
- **L2 (Adaptive assessments):** prevents memorization attacks against fixed question banks
- **L3 (Conversation-state binding):** prevents parallel-LLM attacks — questions reference session-specific context that copy-paste-to-other-tab can't produce
- **L4 (Daily session limits):** prevents marathon-the-curriculum-in-one-weekend gaming
- **L5 (Cool-down statistical flag):** detects suspiciously fast turn intervals indicating copy-paste behavior
- **L7 (Parent receipt):** social accountability mechanism, system trust signal

**Why L6 is deferred:** voice/video MCP transport, real-time audio streaming, and latency budgets are a meaningful architectural lift. Worth doing eventually for high-stakes sessions, but not gating Sprint 4.0 on it. Text-based loop with L1-L5 + L7 is sufficient for dogfooding and pilot.

### Decision 5 — Schema extension is intentional and breaks the 3.6/3.7 "no schema change" pattern

**Decision:** Sprint 4.0 introduces real schema changes. New types: `StudyPlan`, `SessionRecord`. New audit-log actions: `learning-session-started`, `learning-session-completed`, `learning-session-flagged-low-confidence`, `baseline-assessment-completed`. Existing `LearningGoal` gets an optional `studyPlan` field.

**Why this is acceptable:**

Sprints 3.6 and 3.7 deliberately avoided schema changes because they were polish-shaped. Sprint 4.0 is capability-shaped — it introduces a fundamentally new product loop. Schema change is the honest cost of that.

The migration is forward-compatible: existing goals without `studyPlan` continue to work as today's tracker-only goals. The new field is opt-in per goal. Pre-4.0 families load cleanly.

### Decision 6 — Tutor LLM is the same Claude/ChatGPT the kid is already using

**Decision:** Sprint 4.0 does NOT introduce a separate "tutor model." The LLM running the tutoring session is whatever Claude or ChatGPT instance the kid's MCP connector is connected to. The "Learning mode" behavior is induced by prompt fragments returned from new MCP tools (`start-learning-session`, `get-session-state`), not by a separate model deployment.

**Why:**

1. **Architectural simplicity.** No separate model hosting, no API integration, no failover. The kid's existing AI client does the work.
2. **Cost shifts to the kid's existing AI subscription.** No new infrastructure cost for AllowMe per session.
3. **Cross-client portability.** The same prompt fragments work in Claude, ChatGPT, Cursor, or any other MCP-compatible client.
4. **It actually works (assumed; verified by 30-min experiment).** Prompt-fragment-induced behavior shifts in Claude and ChatGPT are robust enough for Socratic tutoring patterns. Worth re-running the experiment if not already done.

**Caveat:** the kid's AI client must have access to the AllowMe MCP connector and must actually call the relevant tools. If the kid asks a question in a fresh Claude tab without AllowMe loaded, no Learning mode activates. This is correct behavior — the system is opt-in by connector.

## Constraints

### Schema additions are additive at the canonical layer

`LearningGoal.studyPlan` is optional. `SessionRecord` is a new type referenced only by `studyPlan.sessions`. Pre-4.0 family configs continue to parse and load. No data migration script needed.

### Test count protected

All 389+ tests from Sprint 3.7 must continue to pass. Sprint 4.0 adds approximately +18 tests (per test-4.0.md spec): engagement scoring tests, session state tests, cheating-defense tests, receipt-generation tests, math-curriculum tests. Total target: ~407 tests after 4.0.

### One subject only

Math is the only subject domain with prompt fragments and curriculum in Sprint 4.0. Other subjects can be opted into via `studyPlan` but will fall back to non-Learning-mode behavior (tracker-only) with a clear note in the configure-policy response.

### Forward compat with Sprint 4.0.x and beyond

Sprint 4.1 (subject expansion) reads the same `studyPlan` and `SessionRecord` types. Adds new prompt fragments per subject domain, no schema changes.
Sprint 4.5 (voice/video) introduces optional `sessionMedium: "text" | "voice"` field on `SessionRecord`. Additive.
Sprint 5.0 (Coinbase Smart Wallet treasury migration, the originally-planned Sprint 4.0) is independent — Learning Mode shipped in 4.0 doesn't change the wallet architecture; the wallet architecture migration happens whenever.

## What this sprint is NOT

To preempt scope creep:

1. **Not Claude for Education integration.** Sprint 4.0 uses consumer Claude/ChatGPT via MCP. Claude for Education's native Learning mode is a separate integration path (Sprint 4.5+ for charter pilots).
2. **Not voice or video sessions.** Layer 6 deferred to 4.5+.
3. **Not multi-subject support.** Math only.
4. **Not curriculum authoring tools.** Parents can't write custom curriculum; they choose math and the system handles it.
5. **Not parent-as-tutor mode.** Parents don't run sessions with the kid. The LLM tutors; the parent receives receipts.
6. **Not adaptive subject selection.** The kid doesn't choose what to study — the parent sets the goal, the LLM teaches it.
7. **Not real-time parent monitoring.** Parent receives post-session receipts, not live observation.
8. **Not session pause/resume across days.** A session is a single sitting. If interrupted, the kid restarts.
9. **Not curriculum personalization beyond baseline.** Baseline assessment calibrates difficulty; from there the math progression is fixed.
10. **Not gamification beyond USDC.** No badges, no leaderboards, no streaks-of-streaks.
11. **Not Spanish-language sessions.** English only.
12. **Not under-8 age-appropriate framing.** Sprint 4.0 assumes ages 10-14, the typical AllowMe target.
13. **Not the Coinbase Smart Wallet migration (now Sprint 5.0).** Treasury wallet architecture is unchanged in 4.0.

## Open questions before code

Three confirmations:

**Q1: Engagement scoring on a 1-5 scale or 1-10 scale?**
Recommendation: 1-5. Easier for the LLM to calibrate consistently, easier for parents to read in receipts ("4.2/5" vs "8.4/10" is no clearer). 1-5 also maps cleanly to a 5-emoji visual representation if the receipt ever needs one.

**Q2: Daily session limit — strict (one per calendar day, no exceptions) or flexible (one per day, parent can grant "makeup" tokens)?**
Recommendation: flexible. Strict is too rigid for legitimate cases (sick day, weekend catchup). Default to one per day, but `configure-policy` includes a `allowMakeupSessions: true/false` flag. Manager-only override.

**Q3: Baseline assessment retake policy — once at start of curriculum, retake on parent request, or periodically (e.g., every 5 sessions)?**
Recommendation: once at start, retake on parent request. Periodic retakes turn into adversarial check-ups; once-at-start with optional retake respects the kid's ongoing study without re-traumatizing.

## Forward compatibility

**Sprint 4.1 (subject expansion):** new subjects add prompt fragments only; no schema change. The math curriculum from 4.0 becomes the template for reading comprehension, programming, history, science — each with their own pedagogy fragments and assessment patterns.

**Sprint 4.5 (voice/video for high-stakes goals):** `SessionRecord.sessionMedium` field added. Audio MCP transport. Real-time engagement scoring on speech patterns.

**Sprint 5.0 (Coinbase Smart Wallet treasury):** wallet architecture migration. Learning Mode session records and receipts are unaffected; they live in family config, not on-chain. Forward-compatible by separation.

**Sprint 6.0+ (curriculum authoring, multi-language, dashboard UI):** all built on the Sprint 4.0 foundation. Schema additions only.

## References

- Sprint 3.0.4 — subgoals + deadline schema (foundation for study-plan structure)
- Sprint 3.0.5 — bootstrap form captures study goals
- Sprint 3.6 — design completeness (the parenting-app version that 4.0 builds on)
- Sprint 3.7 — URL design, subgoal matcher (the polish that completes 3.6)
- Claude for Education Learning mode reference: https://www.anthropic.com/news/claude-for-education
- Spaced repetition pedagogy literature (cited in Decision 4 rationale for daily session limits)
- The seven-layer cheating defense framework (developed in the 2026-05-19 design conversation)