#!/usr/bin/env python3
"""
Harness v3 Hook (Cursor): MCP Phase Router.
Restricts MCP tool access based on the active Harness phase.
"""
import json
import os
import sys

STATE_FILE = ".cursor/state/active-phase"

PHASE_ALLOWED_MCPS = {
    "research": ["brave-search", "sequential-thinking"],
    "planning": ["sequential-thinking", "brave-search", "figma"],
    "implementation": [
        "supabase",
        "figma",
        "flowglad",
        "desktop-commander",
        "upstash",
        "github",
    ],
    "evaluation": ["playwright", "puppeteer", "sentry", "github"],
}


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


def extract_server_name(input_data):
    tool_name = input_data.get("tool_name", "")
    server_name = input_data.get("server_name", "")

    if server_name:
        return server_name.removeprefix("user-")

    if tool_name.startswith("MCP:"):
        rest = tool_name[4:]
        server_name = rest.split("__")[0] if "__" in rest else rest
        return server_name.removeprefix("user-")

    return ""


def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        respond("allow")

    phase = get_active_phase()
    if not phase:
        respond("allow")

    server_name = extract_server_name(input_data)
    allowed = PHASE_ALLOWED_MCPS.get(phase, [])
    if server_name and server_name not in allowed:
        respond(
            "deny",
            user_msg=f"🛑 PHASE ROUTING: MCP '{server_name}' not assigned to '{phase}' phase",
            agent_msg=f"During {phase}, only these MCPs are available: {', '.join(allowed)}. Switch phase via the appropriate command or use a different tool.",
        )

    respond("allow")


if __name__ == "__main__":
    main()
