---
name: fail-forward
description: "Activate Harness v3 failure loop protocol after a failed evaluation"
---

# /fail-forward

Activate the failure loop protocol:

1. Take the Evaluator's bug report as the new sprint input
2. Append to progress.md "Failed Approaches" section (max 10 lines)
3. Compact the rest of progress.md
4. Generate a NEW Sprint Contract scoped specifically to the failures
5. Adjust rubric weights based on failure type
6. The Generator MUST read Failed Approaches before restarting work