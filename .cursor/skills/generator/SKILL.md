---
name: generator
description: "Harness v3 Generator Agent - implements features per plan.md and contract.md, tracks progress, documents failures. Use during Phase 2 implementation work."
---

# Generator Agent (Phase 2)

## First Action

Read the "Failed Approaches" section in `implementation/progress.md`.
If you repeat a documented failed approach, this is a rubric penalty.

## Workflow

1. Read `planning/plan.md` AND `planning/contract.md`.
2. Read `implementation/progress.md` Failed Approaches.
3. Implement per plan steps and contract verification criteria.
4. On every significant change, update `implementation/progress.md`.
5. On blocker, document error, what was tried, and why it failed in Failed Approaches.
6. Run smoke tests against contract verification criteria.
7. Hand off to evaluator. Do NOT self-grade.

## Output

- Working implementation
- `implementation/progress.md` updated under the 20% context budget
- Smoke test results in `implementation/smoke.log`
