#!/usr/bin/env python3
"""
Harness v3 Hook: Artifact Budget Guard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Blocks writes to artifact files that exceed their context budget.

HOW IT WORKS:
  1. Windsurf sends JSON via stdin with the file_path being written
  2. We check if it's one of the 4 Harness artifacts
  3. If the file already exceeds its byte limit, exit code 2 blocks the write
  4. If under budget, exit code 0 allows the write

EXIT CODES:
  0 = Allow the write
  2 = Block the write (Cascade sees our print output as the error)
  1 = Hook error (Windsurf logs it but doesn't block)
"""
import sys
import json
import os

# ── Configuration ──────────────────────────────────────────────
# Byte limits as a proxy for context percentage.
# These assume ~50K tokens ≈ ~200KB of text.
# 40% of 200KB = 80KB for research.md
# 20% of 200KB = 40KB for the others
ARTIFACT_BUDGETS = {
    "research/research.md":         80000,   # 40% context budget
    "planning/plan.md":             40000,   # 20% context budget
    "implementation/progress.md":   40000,   # 20% context budget
    "evaluation/test.md":           40000,   # 20% context budget
}

# ── Main Logic ─────────────────────────────────────────────────
def main():
    try:
        # Read the JSON that Windsurf sends via stdin
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        # If we can't read input, fail open (allow the write)
        sys.exit(0)

    # Extract the file path from the hook payload
    tool_info = input_data.get("tool_info", {})
    file_path = tool_info.get("file_path", "")

    # Check each artifact against its budget
    for artifact, limit in ARTIFACT_BUDGETS.items():
        if file_path.endswith(artifact):
            if os.path.exists(file_path):
                current_size = os.path.getsize(file_path)
                if current_size > limit:
                    # ⛔ BLOCK THE WRITE
                    print(f"⛔ HARNESS BUDGET GUARD: {artifact} is over budget")
                    print(f"   Current size: {current_size:,} bytes")
                    print(f"   Budget limit: {limit:,} bytes")
                    print(f"   Action: Compact {artifact} before adding more content.")
                    print(f"   Remove redundant findings, summarize verbose sections,")
                    print(f"   and keep only actionable information.")
                    sys.exit(2)  # EXIT CODE 2 = BLOCK
                else:
                    remaining = limit - current_size
                    print(f"✅ Budget OK: {artifact} ({current_size:,}/{limit:,} bytes, {remaining:,} remaining)")
            break

    # Not an artifact file, or artifact is under budget — allow the write
    sys.exit(0)

if __name__ == "__main__":
    main()