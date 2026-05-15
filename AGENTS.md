# Harness Engineering v3 — AllowMe Build Framework

This project uses the Harness Engineering framework.
Work flows: Research → Spike → Planning → Contract → Implementation → Evaluation.

## Non-Negotiable Rules
1. **Agent Separation:** The agent that builds does NOT evaluate its own work.
2. **Artifact State:** Only 4 files persist across resets: research.md, plan.md, progress.md, test.md (plus contract.md per sprint).
3. **Context Budget:** No artifact exceeds 40% of working context. Compact aggressively.
4. **Failed Approaches:** ALWAYS read progress.md "Failed Approaches" before coding. Repeating a documented failure is a rubric penalty.
5. **Spike Before Plan:** Uncertain integrations get a 30-min spike before planning.
6. **Contract Before Code:** No implementation begins until generator and evaluator agree on the sprint contract.

## Phase Routing
- `research/` → Researcher agent. Scope to the Phase 0a problem statement.
- `planning/` → Planner + Evaluator. Produce plan.md + negotiated contract.md.
- `implementation/` → Generator. Build per plan.md and contract.md. Update progress.md.
- `evaluation/` → Evaluator. Grade against contract.md only. Do NOT read progress.md.

## Phase State
Read `.cursor/state/active-phase` to know the current phase. Hooks enforce phase boundaries via this file.