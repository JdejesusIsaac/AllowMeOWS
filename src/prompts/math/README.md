# Math Curriculum Prompt Fragments (Sprint 4.0)

This directory holds the load-bearing pedagogical IP for AllowMe Learning
Mode. Each fragment is read by the relevant MCP tool
(`start-learning-session`, `complete-learning-session`) and returned to
the kid's AI client as instructions on how to tutor today's topic.

## Fragment inventory

| File | Purpose | Used by |
|---|---|---|
| `baseline-assessment.md` | 5-10 question adaptive baseline run on the kid's first session of a study plan. Calibrates difficulty (novice / intermediate / advanced) and surfaces initial gaps. | `start-learning-session` (when `sessionsCompleted === 0`) |
| `engagement-scoring.md` | Universal instructions for the tutor LLM to emit per-turn engagement scores (1-5) and end-of-session metadata (knownGaps, conceptsCovered). | Appended to every Learning Mode prompt fragment. |
| `receipt-generator.md` | Lives one directory up (`src/prompts/receipt-generator.md`) — separate from the tutor library to preserve editorial distance (plan.md Decision 8). | `complete-learning-session` (post-session). |
| `place-value.md` | Topic fragment: place value to 1000 + decimal points. | `start-learning-session` when `currentPhase === "place-value"`. |
| `fractions.md` | Topic fragment: equivalent fractions, common denominators, mixed numbers. | `start-learning-session` when `currentPhase === "fractions"`. |
| `decimals.md` | Topic fragment: decimal place value, conversion, arithmetic. | `start-learning-session` when `currentPhase === "decimals"`. |
| `ratios.md` | Topic fragment: ratios, proportions, percentages. | `start-learning-session` when `currentPhase === "ratios"`. |
| `pre-algebra.md` | Topic fragment: variables, equations, distributive property. | `start-learning-session` when `currentPhase === "pre-algebra"`. |

## Phase progression

The default 7th-grade progression is:
```
place-value → fractions → decimals → ratios → pre-algebra
```

`start-learning-session` advances `studyPlan.currentPhase` based on
`sessionsCompleted / sessionsPlanned` ratio and the prior session's
`knownGaps`. Phases are not strictly time-boxed — if the kid is still
struggling with fractions after the projected fraction-sessions are
done, the tutor continues fractions and emits a `knownGaps` note that
surfaces in the parent receipt.

## Design principles

1. **Socratic, not didactic.** Every fragment instructs the LLM to ask
   questions back, not give answers. The kid does the reasoning.
2. **Probe before scaffold.** Each topic lists common misconceptions the
   tutor LLM should test for first, before assuming where the kid is.
3. **Reference today's framing.** End-of-session assessments must
   self-reference content from this session (L3 cheating defense). A
   generic question that any unrelated LLM could answer fails L3.
4. **Honesty over praise.** Tutor never inflates the kid's performance
   in the session itself. Praise is appropriate; promotion is not. The
   receipt LLM (separate call) decides the parent-facing framing.
5. **Engagement scoring is opaque to the kid.** The tutor emits
   `engagement: N` tags in its responses (per `engagement-scoring.md`)
   but never tells the kid "that response scored 2/5". The kid sees
   their final receipt, not the per-turn scores.

## Fallback if a fragment fails to induce Socratic behavior

Per plan.md Fallback approaches: rewrite the fragment with more
explicit step-by-step instructions ("First ask X. Wait. Then if
response includes Y, do Z."). More verbose, more reliable. Tune in
Sprint 4.0.1 based on Aiden dogfooding.
