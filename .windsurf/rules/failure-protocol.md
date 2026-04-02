---
trigger: always_on
---

# Failure Loop Protocol

When evaluation fails:
1. Bug report becomes the new sprint input
2. Append to progress.md "Failed Approaches" (max 10 lines)
3. Compact the rest of progress.md
4. Generate new Sprint Contract scoped to failures
5. Rubric weights may shift based on failure type
6. Generator MUST read Failed Approaches before starting