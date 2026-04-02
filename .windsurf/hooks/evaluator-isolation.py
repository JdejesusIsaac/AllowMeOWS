#!/usr/bin/env python3
"""
Harness v3 Hook: Evaluator Isolation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Blocks the Evaluator from reading the Generator's progress.md.

THE PRINCIPLE:
  The Evaluator receives ONLY the Sprint Contract and the deployed build.
  It does NOT have access to progress.md or the Generator's reasoning.
  This is structural independence — the evaluation is based on observable
  behavior, not implementation intent.

  CCA exam pattern: "Subagents do not inherit the coordinator's conversation
  history. They do not share memory."
"""
import sys
import json
import os

PROTECTED_FILE = "implementation/progress.md"

def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_info = input_data.get("tool_info", {})
    file_path = tool_info.get("file_path", "")

    # Check if reading progress.md
    if not file_path.endswith("progress.md") and "progress.md" not in file_path:
        sys.exit(0)

    # Detect if we're in evaluation context
    # Heuristic: check if evaluation/test.md was recently modified
    # (meaning the evaluator is likely active)
    eval_marker = "evaluation/test.md"
    if os.path.exists(eval_marker):
        eval_mtime = os.path.getmtime(eval_marker)
        # If test.md was modified in the last 30 minutes, evaluator is likely active
        import time
        if (time.time() - eval_mtime) < 1800:
            print(f"⛔ EVALUATOR ISOLATION: Cannot read progress.md during evaluation")
            print(f"   The Evaluator is structurally independent from the Generator.")
            print(f"   You may only read: Sprint Contract (planning/plan.md) + deployed build.")
            print(f"   You do NOT read the Generator's reasoning or approach.")
            sys.exit(2)

    # Outside evaluation window — allow the read
    # (The Generator and Planner need to read progress.md)
    sys.exit(0)

if __name__ == "__main__":
    main()