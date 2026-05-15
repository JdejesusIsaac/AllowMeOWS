#!/usr/bin/env python3
"""
Harness v3 Hook (Cursor): Artifact Budget Guard.
Blocks writes to artifact files that exceed their context budget.
"""
import json
import os
import sys

ARTIFACT_BUDGETS = {
    "research/research.md": 80000,
    "planning/plan.md": 40000,
    "planning/contract.md": 20000,
    "implementation/progress.md": 40000,
    "evaluation/test.md": 40000,
}


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

    tool_input = input_data.get("tool_input", {})
    file_path = get_file_path(tool_input)
    new_content = tool_input.get("content", "") or tool_input.get("new_string", "")

    for artifact, limit in ARTIFACT_BUDGETS.items():
        if file_path.endswith(artifact):
            existing_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            projected_size = max(existing_size, len(new_content.encode("utf-8")))

            if projected_size > limit:
                respond(
                    "deny",
                    user_msg=f"🛑 HARNESS BUDGET GUARD: {artifact} exceeds budget ({projected_size:,} > {limit:,} bytes)",
                    agent_msg=f"Compact {artifact} before adding content. Current: {projected_size:,} bytes. Budget: {limit:,} bytes.",
                )
            break

    respond("allow")


if __name__ == "__main__":
    main()
