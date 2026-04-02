# Harness Engineering v3.0 — AllowMe Build Framework

This project uses the Harness Engineering framework.
All work follows: Research → Spike → Planning → Implementation → Evaluation.

## Non-Negotiable Rules

1. **Agent Separation:** The agent that builds does NOT evaluate its own work.
2. **Artifact State:** Only 4 files persist: research.md, plan.md, progress.md, test.md
3. **Context Budget:** No artifact exceeds 40% of working context. Compact aggressively.
4. **Failed Approaches:** ALWAYS read progress.md "Failed Approaches" before coding.
   Repeating a documented failure is a rubric penalty.
5. **Spike Before Commit:** Uncertain integrations get a 30-min spike before planning.

## Phase Routing

- `/research/` → Research agent. Scope all work to the problem statement.
- `/planning/` → Planner agent. Produce plan.md + Sprint Contract.
- `/implementation/` → Generator agent. Build per plan.md. Update progress.md.
- `/evaluation/` → Evaluator agent. Grade against Sprint Contract only.
  You do NOT read progress.md.

## AllowMe-Specific Context

- Stack: TypeScript, Node.js

