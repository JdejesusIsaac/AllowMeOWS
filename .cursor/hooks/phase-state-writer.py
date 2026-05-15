#!/usr/bin/env python3
"""
Harness v3 Hook (Cursor): Phase State Writer.
Watches user prompts for command invocations and updates .cursor/state/active-phase.
"""
import json
import os
import sys

STATE_DIR = ".cursor/state"
STATE_FILE = f"{STATE_DIR}/active-phase"

COMMAND_TO_PHASE = {
    "/new-sprint": "research",
    "/research": "research",
    "/plan": "planning",
    "/implement": "implementation",
    "/build": "implementation",
    "/evaluate": "evaluation",
    "/fail-forward": "implementation",
    "/handoff": "implementation",
}


def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        print(json.dumps({"continue": True}))
        sys.exit(0)

    prompt = input_data.get("prompt", "")
    first_token = prompt.strip().split()[0] if prompt.strip() else ""

    if first_token in COMMAND_TO_PHASE:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            f.write(COMMAND_TO_PHASE[first_token])

    print(json.dumps({"continue": True}))
    sys.exit(0)


if __name__ == "__main__":
    main()
