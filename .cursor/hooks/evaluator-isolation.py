#!/usr/bin/env python3
"""
Harness v3 Hook (Cursor): Evaluator Isolation.
Blocks the Evaluator from reading progress.md during Phase 3.
"""
import json
import os
import sys

PROTECTED_FILE = "implementation/progress.md"
STATE_FILE = ".cursor/state/active-phase"


def respond(permission, user_msg=None, agent_msg=None):
    out = {"permission": permission}
    if user_msg:
        out["user_message"] = user_msg
    if agent_msg:
        out["agent_message"] = agent_msg
    print(json.dumps(out))
    sys.exit(0)


def get_active_phase():
    if not os.path.exists(STATE_FILE):
        return None
    with open(STATE_FILE, "r", encoding="utf-8") as f:
        return f.read().strip()


def get_file_path(tool_input):
    return tool_input.get("file_path") or tool_input.get("path") or ""


def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        respond("allow")

    file_path = get_file_path(input_data.get("tool_input", {}))

    if not file_path.endswith(PROTECTED_FILE) and "progress.md" not in file_path:
        respond("allow")

    if get_active_phase() == "evaluation":
        respond(
            "deny",
            user_msg="🛑 EVALUATOR ISOLATION: Cannot read progress.md during Phase 3",
            agent_msg="The Evaluator may read planning/contract.md and the deployed build only. Grade against contract.md criteria.",
        )

    respond("allow")


if __name__ == "__main__":
    main()
