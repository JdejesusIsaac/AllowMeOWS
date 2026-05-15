#!/usr/bin/env python3
"""
Harness v3 Hook (Cursor): Failure Check.
Warns the Generator about documented failed approaches before implementation writes.
"""
import json
import os
import sys

PROGRESS_PATH = "implementation/progress.md"


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
    is_impl_write = any(
        file_path.startswith(d) or f"/{d}" in file_path
        for d in ["src/", "app/", "scripts/", "implementation/"]
    )
    if not is_impl_write or file_path.endswith("progress.md"):
        respond("allow")

    if not os.path.exists(PROGRESS_PATH):
        respond("allow")

    with open(PROGRESS_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    if "Failed Approaches" not in content:
        respond("allow")

    lines = content.split("\n")
    in_section = False
    failed = []
    for line in lines:
        if "Failed Approaches" in line:
            in_section = True
            continue
        if in_section and (line.startswith("## ") or line.startswith("### ")):
            break
        if in_section and line.strip():
            failed.append(line.strip())

    failed = [line for line in failed if line != "- None documented."]
    if failed:
        items = "\n".join(f"  - {line[:120]}" for line in failed[:5])
        respond(
            "allow",
            agent_msg=f"FAILURE CHECK: {len(failed)} documented failed approach(es) in progress.md:\n{items}\n\nDo NOT repeat these.",
        )

    respond("allow")


if __name__ == "__main__":
    main()
