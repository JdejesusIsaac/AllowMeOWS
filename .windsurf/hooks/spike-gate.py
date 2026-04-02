#!/usr/bin/env python3
"""
Harness v3 Hook: Spike Validation Gate
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Blocks writes to planning/ if research has unresolved spike candidates.

THE PRINCIPLE:
  If research.md has ⚠️ markers in Open Questions AND no "Spike Results"
  section exists, planning cannot proceed. This is programmatic enforcement —
  the planning phase is physically blocked, not just discouraged.

  This is the CCA exam pattern: "If consequences involve financial transactions,
  security operations, or compliance requirements, programmatic enforcement
  is required."
"""
import sys
import json
import os

RESEARCH_PATH = "research/research.md"

def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_info = input_data.get("tool_info", {})
    file_path = tool_info.get("file_path", "")

    # Only gate writes to the planning directory
    if "/planning/" not in file_path and not file_path.startswith("planning/"):
        sys.exit(0)

    # Check if research.md exists
    if not os.path.exists(RESEARCH_PATH):
        print("⚠️  SPIKE GATE: No research.md found. Complete Phase 0b before planning.")
        sys.exit(2)

    with open(RESEARCH_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    # Check for unresolved spike candidates
    has_spike_markers = "⚠️" in content
    has_spike_results = "## Spike Results" in content or "### Spike Results" in content

    if has_spike_markers and not has_spike_results:
        # Count how many unresolved spikes
        spike_count = content.count("⚠️")
        print(f"⛔ SPIKE GATE: {spike_count} unresolved spike candidate(s) in research.md")
        print(f"   research.md contains ⚠️ markers but no 'Spike Results' section.")
        print(f"   Complete Phase 0.5 (spike validation) before proceeding to planning.")
        print(f"   Protocol: 30-min timebox → Go/No-Go decision → append to research.md")
        sys.exit(2)

    if has_spike_markers and has_spike_results:
        print(f"✅ Spike gate passed: research.md has spike markers AND spike results.")

    sys.exit(0)

if __name__ == "__main__":
    main()