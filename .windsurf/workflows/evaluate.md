---
name: evaluate
description: "Run Harness v3 evaluation phase on current sprint"
---

# /evaluate

Run the Evaluator Agent (Phase 3):

1. Invoke the @evaluator skill
2. Do NOT read progress.md or implementation reasoning
3. Read only the Sprint Contract from planning/plan.md
4. Execute all tests in evaluation/test.md
5. Grade against the Sprint Contract rubric
6. Output: Pass with scores, or Fail with bug reports