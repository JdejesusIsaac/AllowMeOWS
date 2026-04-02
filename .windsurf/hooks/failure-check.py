#!/usr/bin/env python3
"""
Harness v3 Hook: Failure Check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Warns if the Generator hasn't documented or read Failed Approaches.

THE PRINCIPLE:
  Failed sprints produce structured bug reports with explicit failed-approach
  documentation to prevent repeated mistakes. The Generator MUST read this
  section before beginning work. If it repeats a documented failed approach,
  the Evaluator flags this as a rubric penalty.
"""
import sys
import json
import os

PROGRESS_PATH = "implementation/progress.md"

def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_info = input_data.get("tool_info", {})
    file_path = tool_info.get("file_path", "")

    # Only check for implementation-phase writes
    impl_dirs = ["lib/", "scripts/", "implementation/"]
    is_impl_write = any(file_path.startswith(d) or f"/{d}" in file_path for d in impl_dirs)

    if not is_impl_write:
        sys.exit(0)

    # Skip if writing to progress.md itself (that's the Generator updating status)
    if file_path.endswith("progress.md"):
        sys.exit(0)

    # Check if progress.md exists and has content
    if not os.path.exists(PROGRESS_PATH):
        # No progress.md yet — this might be the first sprint. Allow.
        sys.exit(0)

    with open(PROGRESS_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    # Check for Failed Approaches section
    has_failed_section = (
        "## Failed Approaches" in content or
        "### Failed Approaches" in content or
        "**Failed Approaches" in content
    )

    if has_failed_section:
        # Extract the failed approaches to show as reminder
        lines = content.split("\n")
        in_section = False
        failed_lines = []
        for line in lines:
            if "Failed Approaches" in line:
                in_section = True
                continue
            if in_section:
                if line.startswith("## ") or line.startswith("### "):
                    break
                if line.strip():
                    failed_lines.append(line.strip())

        if failed_lines:
            print(f"📋 FAILURE CHECK: {len(failed_lines)} documented failed approach(es):")
            for fl in failed_lines[:5]:  # Show up to 5
                print(f"   • {fl[:100]}")
            print(f"   Do NOT repeat these approaches. The Evaluator will flag repeats.")

    sys.exit(0)  # Warning only — doesn't block

if __name__ == "__main__":
    main()