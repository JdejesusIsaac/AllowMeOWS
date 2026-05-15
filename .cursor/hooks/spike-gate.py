#!/usr/bin/env python3
"""
Harness v3 Hook (Cursor): Spike Validation Gate.
Blocks writes to planning/ if research.md has unresolved spike candidates.
"""
import json
import os
import sys

RESEARCH_PATH = "research/research.md"


def respond(permission, user_msg=None, agent_msg=None):
    out = {"permission": permission}
    if user_msg:
        out["user_message"] = user_msg
    if agent_msg:
        out["agent_message"] = agent_msg
    print(json.dumps(out))
    sys.exit(0)


def get_file_path(tool_input):
    return (
        tool_input.get("file_path")
        or tool_input.get("path")
        or tool_input.get("target_file")
        or ""
    )


def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        respond("allow")

    file_path = get_file_path(input_data.get("tool_input", {}))

    if "/planning/" not in file_path and not file_path.startswith("planning/"):
        respond("allow")

    if not os.path.exists(RESEARCH_PATH):
        respond(
            "deny",
            user_msg="🛑 SPIKE GATE: No research.md found.",
            agent_msg="Complete Phase 0b research before drafting plan.md or contract.md.",
        )

    with open(RESEARCH_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    has_spike_markers = "⚠️" in content
    has_spike_results = "## Spike Results" in content or "### Spike Results" in content

    if has_spike_markers and not has_spike_results:
        spike_count = content.count("⚠️")
        respond(
            "deny",
            user_msg=f"🛑 SPIKE GATE: {spike_count} unresolved spike candidate(s) in research.md",
            agent_msg="research.md has spike markers but no Spike Results section. Complete Phase 0.5 before drafting planning artifacts.",
        )

    respond("allow")


if __name__ == "__main__":
    main()
