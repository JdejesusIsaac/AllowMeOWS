# AI-Literacy Learning Track — Learning Experience design

*Produced with the EdTech Product Designer skill, Learning Experience mode. This is the pedagogy behind the dashboard's learning goals and badge tiers (AI Learner → Explorer → Pro → Master). It is designed to slot into the existing AllowMeOWS Learning Mode engine, not replace it.*

## Rationale

The product already pays kids for verified learning and already has a Learning Mode engine (sessions, 1–5 engagement scoring, a confidence flag, study plans, baseline assessment, a payout formula). The engine ships one track today: math (place-value → pre-algebra). This designs a **parallel AI-literacy track** that runs on the same engine.

Two forces shape it:
1. **The reward is extrinsic; the curiosity must stay intrinsic.** So mastery and applied doing are the hero; the payout is informational ("you demonstrated X"), never the point.
2. **The ironic threat: an AI can complete an AI-literacy test.** So assessment is applied, personalized, and human-paced, and the engine's confidence flag (median turn interval < 5s) polices integrity. A "low"-confidence session earns nothing toward mastery.

Anchored on the field-standard **AI4K12 Five Big Ideas** (Perception, Representation & Reasoning, Learning, Natural Interaction, Societal Impact), one per phase.

## The Four

| | |
|---|---|
| **User** | Learner 8–11 (Builders) primary; parent sets the goal. Sprouts 5–7 and Founders 12–16 noted at the end. |
| **Goal** | The kid can explain, at a basic level, what AI is and how it works — and use it well and honestly — and *demonstrate* it, not just recall it. |
| **Outcome** | Genuine AI literacy that climbs AI4K12's levels (awareness → conceptual → ethical → applied), retained over time, with curiosity intact. |
| **Measurement** | Mastery progression through the 5 phases, applied-assessment accuracy on *novel* items, spaced-recall retention, confidence-flag integrity rate, and an intrinsic-motivation guardrail. |

---

## 1. Learning objectives

The track is five phases (`currentPhase` values, parallel to the math `PHASE_ORDER`): `ai-perception → ai-patterns → ai-learning → ai-talking → ai-fairness`. Objectives climb Bloom's across the track and peak at Evaluate/Create.

**Phase 1 — ai-perception ("How AI sees and hears")**
By the end the learner can:
- (Remember) name two ways a computer takes in information (e.g. photos, sound, typed words).
- (Understand) explain that a computer "sees" a photo as numbers, not the way a person does.
- (Apply) sort a set of pictures the way an image classifier would and state the rule they used.

**Phase 2 — ai-patterns ("How AI finds patterns and guesses")**
- (Understand) explain that AI finds patterns in examples to make a guess.
- (Apply) given a few examples, predict the AI's next guess and say which pattern it used.
- (Analyze) compare two guesses and identify which one the pattern supports.

**Phase 3 — ai-learning ("How AI learns from examples")**
- (Understand) explain that AI learns from many examples (training data).
- (Analyze) differentiate fair vs lopsided example sets and predict the mistake the lopsided set causes.
- (Evaluate) judge whether a given set of examples would teach the AI something fair.

**Phase 4 — ai-talking ("How to work with AI")**
- (Apply) write a clear instruction (prompt) that gets a useful answer.
- (Analyze) differentiate a vague vs a clear instruction and explain the difference in results.
- (Evaluate) judge an AI's answer for whether it actually answered the question.

**Phase 5 — ai-fairness ("Using AI well and honestly")**
- (Understand) explain that AI can be wrong or unfair and is not a person.
- (Evaluate) critique a real AI output for a mistake or unfairness (spot-the-mistake).
- (Create) compose a short "rule for using AI well" and justify it.
- (Disposition) explain why doing your own thinking still matters even when AI could do it — the honesty ethic that underpins the whole reward model.

---

## 2. Prerequisite map

```
Requires (whole track): basic reading of short sentences; can use a tablet/Claude with a parent nearby;
                        comfort talking through an idea out loud (the engine is Socratic).
Per phase:              each phase requires the one before it (perception grounds patterns,
                        patterns grounds learning, etc.).
Unlocks:                responsible, capable use of AI tools; the AI Master capstone; the Founders
                        (12–16) deeper societal-impact track; transfer to school AI-use expectations.
```

The most common drop-off cause is a skipped prerequisite. The baseline assessment (below) places the kid so they start at the right phase, not always phase 1.

---

## 3. Instructional sequence

Order: **perception → patterns → learning → talking → fairness.** Rationale: start concrete and sensory (a computer "seeing" pictures is observable), build to how patterns become guesses, then to where guesses come from (data), then to acting on AI (prompting), and only then to judgment and ethics (the most abstract, and the one that needs all the prior ideas to reason about fairness).

Within each session, follow the worked-example effect for novices, then fade support:
```
Step 1: Warm-up recall — one quick item from a prior phase (spaced review).
Step 2: Worked example — the tutor shows one fully, thinking aloud.
Step 3: Guided practice — the kid does one with hints; hints fade.
Step 4: Applied task — the kid does + explains in their own words (the gradable behavior).
Step 5: End-of-session check — a novel item; immediate, specific feedback.
```
This maps directly onto the engine's existing session flow and prompt-fragment structure (`src/prompts/<track>/*.md` + `engagement-scoring.md`).

---

## 4. Mastery model

```
Mastery threshold (per phase):
  - Pass the end-of-session applied check on NOVEL items (engine: assessmentPassed), AND
  - avgEngagement >= 3 (the kid actually participated), AND
  - confidenceFlag == "ok" (human-paced; not the <5s copy-paste signal).
  A phase is "mastered" after 2 qualifying sessions, the last on transfer/novel items.

Demonstration:
  The applied task for that phase (sort / predict / critique / prompt / compose), explained
  aloud in the Socratic session — not a multiple-choice score.

Decay / refresh:
  Concepts interleave forward: each phase opens with a spaced-recall item from an earlier phase.
  A failed recall schedules a short revisit (reuse the engine's knownGaps revisit mechanic).
  Mastery is "warm," not permanent — spaced review keeps it alive.

Integrity rule (anti-gaming):
  A "low"-confidence session counts toward NOTHING and routes to human review. Mastery requires
  demonstrated, human-paced reasoning. This is how the track survives the "AI takes the AI test" risk.
```

**Badge tiers = mastery milestones** (these are the dashboard badges):
- **AI Learner** — `ai-perception` + `ai-patterns` mastered.
- **AI Explorer** — + `ai-learning`.
- **AI Pro** — + `ai-talking`.
- **AI Master** — + `ai-fairness` + a capstone: use AI to help with a real task, then critique its output.

---

## 5. Assessment design

Measure the objectives, not test-taking skill. Every item is **applied** (per the Fryer evidence: reward verifiable doing, not a raw score) and, for mastery, **novel**.

```
Objective                                   → Item type                         → Measures                → Difficulty
P1 sort pictures by a rule                   → live sort + explain the rule      → Apply (perception)       → low
P2 predict the AI's next guess              → "what will it guess? why?"        → Apply→Analyze (patterns) → medium
P3 judge a fair vs lopsided example set     → choose + justify which is fair    → Evaluate (data/bias)     → medium
P4 fix a vague prompt                       → rewrite it + predict the change   → Apply→Analyze (prompting)→ medium
P5 spot the mistake in a real AI answer     → critique + say how you'd check    → Evaluate (judgment)      → high
P5 capstone                                 → use AI on a real task, then critique → Create + Evaluate      → high
```

**AI-resistant assessment principles (the load-bearing design):**
- **Personalized/contextual** — items use the kid's own example or interest, so they aren't memorizable or web-lookup-able.
- **Applied + explain, in live dialogue** — the kid must reason aloud; pacing/engagement signals expose copy-paste (the confidence flag).
- **Critique over recall** — judging an AI output is higher-order and hard to fake.
- **Novel transfer items for mastery** — never the same item twice.
- Formative items every step (immediate, specific feedback — feedback timing matters); one summative check per session. No trick questions.

---

## 6. Cognitive-load budget

Working memory is the bottleneck. Sessions run 15–25 min for Builders (engine allows 15–60; keep the low end for this age).

| Phase | Dominant load | How the design keeps it under budget |
|---|---|---|
| ai-perception | Intrinsic (abstract: "seeing as numbers") | Concrete metaphor + one observable task (sorting real pictures); one idea only. |
| ai-patterns | Germane (building the pattern→guess schema) | Protect it: worked example first, then a single predict-and-explain. |
| ai-learning | Intrinsic (data→behavior is a chain) | Chunk: examples → guess → mistake, one link at a time. |
| ai-talking | Extraneous risk (tool UI can distract) | Strip the interface to the prompt + answer; no incidental jargon. |
| ai-fairness | Germane (judgment integrates all prior ideas) | Sequence last, when the prior schemas exist to reason with. |

Cross-cutting extraneous-load cuts: one primary action per dashboard screen; no wallet/chain jargon in the kid's view; worked examples before independent practice.

---

## 7. Engagement & retention mechanics

Grounded in evidence, not dark patterns.

- **Spaced repetition** — each phase opens with a recall item from an earlier phase; the capstone re-touches all five big ideas.
- **Progress feedback** — visible and **mastery-tied** (phase progress + badge tiers on the dashboard), not activity-tied. Hidden progress kills motivation.
- **Achievable challenge** — the baseline assessment places the kid (novice/intermediate/advanced); the engine's knownGaps revisit keeps difficulty in the flow zone.
- **Autonomy & relevance** — the kid picks the example/topic they care about; the tutor frames "why this matters" for each big idea.
- **Forgiving streaks** — never punish a break (illness, life). The dashboard already does kind streaks and a calm "all done today"; keep it.

**Flag (raised, per the skill's mandate):** the payout is an extrinsic reward layered on learning we want to be intrinsic. If the dashboard ever makes the money the hero, it will crowd out curiosity (overjustification). Mitigation is built in: reward *informational* framing, mastery as the hero, and the intrinsic-motivation guardrail metric below. This is a real product risk, monitored, not assumed away.

---

## How it surfaces on the dashboard

- **Learning goal + steps** — an `ai-literacy` study plan whose subgoals are the five phases, rendered exactly like the math goal card: "AI literacy (perception ✓ · patterns ✓ · learning ○ · talking ○ · fairness ○)".
- **Badges** — AI Learner / Explorer / Pro / Master are the mastery tiers above.
- **"Why you earned"** — the session `receiptSummary` + `confidenceFlag` already produce this; here it reads e.g. "12 min on spotting AI mistakes, stayed focused (4/5), passed the check."
- **Categories** — lives under the child's `education` (or a dedicated `AI`) weekly-budget category.

## Age-band notes

- **Sprouts (5–7):** only `ai-perception` and the honesty disposition, at Remember/Understand level, no abstract data/bias. "Computers can sort pictures" + "always tell the truth, even to a robot." No numbers, no assessment scores — a star for showing up and trying.
- **Founders (12–16):** add depth at Evaluate/Create — real bias case studies, prompt-injection awareness, deepfakes, "when should a person decide, not an AI." The capstone becomes a small build-and-critique project. Societal Impact is foregrounded.

## Implementation note (engine fit)

Slots into the existing engine with no redesign: a new `ai-literacy` study-plan track, prompt fragments at `src/prompts/ai-literacy/*.md` parallel to `src/prompts/math/*.md`, and an AI `PHASE_ORDER`. The one real change is lifting the **math-only enforcement at the `configure-policy` boundary** (README/plan.md success criterion 12) to allow this track. Engagement scoring, confidence flag, payout formula, baseline assessment, and receipts all carry over unchanged.

---

## Metrics tie-back

```
Student metric:   Applied-assessment accuracy on NOVEL items — target ≥ 75% by phase 3
                  (hypothesis; validate in pilot), measured by SessionRecord.assessmentScore on transfer items.
Student metric:   30-day retention of mastered phases — target ≥ 70% pass on spaced-recall items,
                  measured by the warm-up recall item logged each session.
Integrity metric: % of sessions with confidenceFlag == "ok" — target ≥ 90%; a lower rate means the
                  assessment is gameable and needs redesign. Measured directly from SessionRecord.
Guardrail metric: intrinsic motivation — % self-initiated sessions, and learning continuation during a
                  deliberate no-reward cohort week. Measured by session-start source + cohort A/B.
Parent metric:    trust ("I can see real learning, and it's genuinely my kid") + hours saved vs manually
                  tutoring/checking — measured by survey + auto-graded-session count.
Business metric:  Activation = first badge (AI Learner) earned within 2 weeks of the goal being set,
                  measured by time-from-goal-create to first tier.
```

## Handoff to Product Designer mode

- **Mastery model → progress UI:** the five phases + four badge tiers drive the goal card and badge component already in the prototypes.
- **Instructional sequence → user flow:** the 5-step session flow is the learner's core loop.
- **Assessment design → acceptance criteria:** "mastery requires novel-item pass + engagement ≥ 3 + confidence ok" becomes a testable acceptance criterion on the verify/settle path.
