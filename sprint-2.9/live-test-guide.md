# Sprint 2.9 — Live Test Guide

**Target:** verify multi-tenant isolation + setup-code identity work end-to-end against the production deploy at `https://allowme.dev/mcp`.

**Estimated time:** 25–35 minutes (5 phases).

**Prerequisites:**
- Hotfix `efb5cdc` confirmed live (uptime < 5 min after `railway up`)
- Volume `/app/data` wiped (only `lost+found` present, fresh `.master-key` + `.migrated-2.9` regenerated on first boot)
- Claude.ai web account with custom-connector access
- ChatGPT Pro account with MCP support (or fallback to a second Claude account / curl)
- Local terminal with `railway` CLI authenticated to the AllowanceAgent project

---

## Phase 0 — Pre-flight checks (3 min)

Run these from your local terminal. All four must pass before continuing.

### 0.1 — Server is alive and freshly booted

```bash
curl -sS https://allowme.dev/health
```

**Expected:** `{"status":"ok","version":"0.3.0","transport":"http","tools":12,"uptime":<small_number>}`

**Pass:** `uptime` is the wall-clock time since the last redeploy. After a `railway redeploy` it should be in the hundreds of seconds, not thousands.

### 0.2 — Volume is clean

```bash
railway ssh "ls -la /app/data/"
```

**Expected:**
```
.master-key       — 32 bytes, recent timestamp
.migrated-2.9     — sentinel, recent timestamp
lost+found/       — ext4 reserved (ignore)
```

**Pass:** No `families/` directory, no `family-keys.json`, no `member-index.json`. Volume is genuinely empty except for keys + sentinel.

### 0.3 — Hotfix is in the running container

Run this single-shot script to confirm Priority 5 fallback is gone:

```bash
SID=$(curl -sS -i -X POST "https://allowme.dev/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"preflight","version":"1.0"}}}' \
  | grep -i "^mcp-session-id:" | tr -d '\r' | awk '{print $2}')
echo "Session: $SID"

curl -sS -X POST "https://allowme.dev/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null

curl -sS -X POST "https://allowme.dev/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check-progress","arguments":{"childName":"AnyKid"}}}'
```

**Expected:**
```json
{"success":false,"error":"No caller identity. Tool \"check-progress\" requires an authenticated member. Call configure-policy to create a family, or add ?setup=SETUP-XXXX-XXXX to your MCP server URL.","toolName":"check-progress"}
```

**Pass:** the response is `success: false` with a "No caller identity" error.
**Fail:** if the response succeeds with empty `reports: []` or any data, the hotfix is NOT live → stop and re-run `railway up --detach`.

### 0.4 — Local code matches deployed commit

```bash
git log -1 --oneline origin/main
grep -c "legacy-manager" src/middleware/access-control.ts app/tools/_helpers.ts
```

**Expected:** commit `efb5cdc` (or later), and the grep returns `0` for both files.

---

## Phase 1 — First family bootstrap from Claude.ai (5 min)

### 1.1 — Add custom connector with bootstrap URL

In Claude.ai → Settings → Connectors → **Add custom connector**:

- **Name:** `allowme-bootstrap`
- **Remote MCP server URL:** `https://allowme.dev/mcp`

Click **Add**. Confirm the connector appears in the list and shows tools (12 tools listed).

### 1.2 — Call configure-policy

Open a fresh chat with the `allowme-bootstrap` connector enabled. Paste:

> Call the `configure-policy` tool with these arguments:
>
> - `familyName`: "Isaac"
> - `useTestnet`: true
> - `children`: a list with one entry — name "TestKid", weeklyBudgetUsd 0.10, savingsPercent 20, categories `[{ "name": "general", "pct": 100 }]`
>
> Show me the full JSON response.

**Expected response (key fields):**
```json
{
  "success": true,
  "bootstrap": true,
  "familyId": "<uuid-A>",
  "memberId": "<uuid-A-manager>",
  "setupCode": "SETUP-XXXX-XXXX",
  "mcpUrl": "https://allowme.dev/mcp?setup=SETUP-XXXX-XXXX",
  "familyName": "Isaac",
  "wallets": { "treasury": "0x...", ... },
  ...
}
```

**Save the `mcpUrl`** to a sticky note. Call it `MCP_URL_A`.

### 1.3 — Verify on the server side

From your terminal:
```bash
railway ssh "ls /app/data/families/ && cat /app/data/member-index.json"
```

**Expected:**
- One UUID directory under `families/`
- `member-index.json` contains exactly one entry: `{ "<uuid-A-manager>": { "familyId": "<uuid-A>", "role": "manager" } }`

**Pass:** server-side state matches the response.

---

## Phase 2 — Verify Claude is scoped to Family A (5 min)

### 2.1 — Update Claude connector URL

In Claude.ai → Settings → Connectors → click `⋮` next to `allowme-bootstrap`:

- If `Edit` / `Configure URL` is available → change URL to `MCP_URL_A`. Rename connector to `allowme-isaac` if possible.
- If URL is immutable → delete `allowme-bootstrap` and add a new connector with name `allowme-isaac` and URL = `MCP_URL_A`.

Either way: the connector now points at the authenticated URL.

### 2.2 — Smoke test from Claude

In a new chat with `allowme-isaac` enabled, paste:

> Call `check-progress` for child "TestKid".

**Expected:** Returns TestKid's progress data — zero achievements, $0.10 weekly budget, $0 earned.

**Pass:** call succeeds, data matches what was set in 1.2.

### 2.3 — Verify identity resolution path

In the same chat:

> Call `manage-members` with action "list".

**Expected:** Returns one member — yourself, role "manager", memberId matching `<uuid-A-manager>` from 1.2.

**Pass:** Claude is correctly resolving its setup code to the Isaac Manager.

### 2.4 — Verify funding address surfaces

> Call `get-funding-address`.

**Expected:** Returns the Isaac family's treasury address (from `wallets.treasury` in 1.2).

**Pass:** wallet ownership scoped to Family A.

---

## Phase 3 — Second family from ChatGPT or another client (5 min)

The cleanest second client is ChatGPT (custom MCP). If you don't have ChatGPT MCP access, use a second Claude account, or a curl session as fallback.

### 3.1 — Connect bootstrap URL again

In ChatGPT → Settings → Connectors → Add MCP server:

- **Name:** `allowme-bootstrap-2`
- **URL:** `https://allowme.dev/mcp` (no setup code yet)

### 3.2 — Call configure-policy with different family

In a fresh ChatGPT chat:

> Call the `configure-policy` tool with these arguments:
>
> - `familyName`: "Beta"
> - `useTestnet`: true
> - `children`: a list with one entry — name "BetaKid", weeklyBudgetUsd 0.20, savingsPercent 10, categories `[{ "name": "general", "pct": 100 }]`

**Expected:** identical shape to 1.2, but `familyId` is **different** from `<uuid-A>`, `memberId` is different, `setupCode` is different. Save as `MCP_URL_B`.

### 3.3 — Update ChatGPT connector to MCP_URL_B

Same edit-or-readd flow as 2.1 but with ChatGPT's connector UI.

### 3.4 — Verify ChatGPT sees only Family B

> Call `check-progress` for child "BetaKid".

**Expected:** Returns BetaKid's progress, `$0.20` budget. **No mention of TestKid.**

> Call `check-progress` for child "TestKid".

**Expected:** Returns an error or empty result — TestKid is in Family A, ChatGPT's caller is in Family B. Either:
- `success: false, error: "Child not found"` (preferred), OR
- `success: true, reports: []`

**Pass:** ChatGPT cannot read Family A data.

### 3.5 — Server-side state check

```bash
railway ssh "ls /app/data/families/ && cat /app/data/member-index.json | jq ."
```

**Expected:** Two UUID directories under `families/`, two entries in `member-index.json` — one Manager per family.

---

## Phase 4 — Cross-tenant isolation security tests (8 min)

These are the **critical** tests. If any fail, the hotfix did not actually close the bypass.

### 4.1 — Family A cannot read Family B data

In Claude (using `MCP_URL_A`):

> Call `check-progress` for child "BetaKid".

**Expected:** Error or empty — `BetaKid` is in Family B.

**Pass:** Family A blocked from seeing Family B's child names.

### 4.2 — Family A cannot use Family B's memberId

In Claude:

> Call `manage-members` with action "remove" and memberId set to `<uuid-B-manager>` (paste the manager UUID from Phase 3).

**Expected:** Error — `Member <uuid-B-manager> not in your family. Cross-family operation rejected.`

**Pass:** memberId is checked against `caller.familyId` before any mutation.

### 4.3 — Family A cannot distribute to Family B's treasury

In Claude:

> Call `distribute-allowance` with no arguments (uses default Family A scope).

**Expected:** Distribution succeeds against Family A's treasury only. Server logs (`railway logs --deployment` from terminal) should show `[distribute] family=<uuid-A>` not `<uuid-B>`.

**Pass:** spend isolation holds.

### 4.4 — Stranger with no setup code is rejected

From terminal (no Claude / ChatGPT involvement):

```bash
SID=$(curl -sS -i -X POST "https://allowme.dev/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"stranger","version":"1.0"}}}' \
  | grep -i "^mcp-session-id:" | tr -d '\r' | awk '{print $2}')

curl -sS -X POST "https://allowme.dev/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null

# Try a normal tool — should be rejected
curl -sS -X POST "https://allowme.dev/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check-progress","arguments":{}}}'
```

**Expected:** `success: false, error: "No caller identity..."`.

**Pass:** with TWO families on the server, Priority 5 fallback is definitively gone (it would have promoted the stranger to Manager of one of them in the old code).

### 4.5 — Stranger CAN still bootstrap a third family

Same session, call `configure-policy`:

```bash
curl -sS -X POST "https://allowme.dev/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"configure-policy","arguments":{"familyName":"Stranger","useTestnet":true,"children":[{"name":"X","weeklyBudgetUsd":0.05,"categories":[{"name":"general","pct":100}],"savingsPercent":0}]}}}'
```

**Expected:** Succeeds. New family created. Returns a third `mcpUrl` with a third setup code.

**Pass:** `configure-policy` is correctly in the `UNIDENTIFIED_CALLER_TOOLS` allow-list — bootstrap path still works for new users.

**Cleanup tip:** if you don't want a third family littering production, delete it after the test:
```bash
railway ssh "rm -rf /app/data/families/<uuid-stranger>"
# also remove the member-index entry for the stranger Manager:
railway ssh "cat /app/data/member-index.json"  # find the stranger entry
# manually edit member-index.json or wipe everything for a fresh start
```

---

## Phase 5 — Edge cases (5 min)

### 5.1 — Setup code with bad format

```bash
curl -sS "https://allowme.dev/mcp?setup=NOT-A-VALID-CODE" -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"badcode","version":"1.0"}}}'
```

Then on a tool call: **expected** `No caller identity` error. Bad-format codes don't match the regex, treated as no code at all.

### 5.2 — Setup code that doesn't exist

```bash
SID=$(curl -sS -i "https://allowme.dev/mcp?setup=SETUP-AAAA-BBBB" -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"fakecode","version":"1.0"}}}' \
  | grep -i "^mcp-session-id:" | tr -d '\r' | awk '{print $2}')
```

Tool call after: **expected** `No caller identity`. The code is well-formed but doesn't resolve to any member in `setup-codes.json`.

### 5.3 — Setup code expiry (manual)

To verify expiry without waiting 48h, ssh in and edit a code's `expiresAt` to a past timestamp:

```bash
railway ssh "cat /app/data/setup-codes.json"  # pick a code, note its key
# manually edit expiresAt to e.g. "2020-01-01T00:00:00.000Z" via nano or a sed-replace
```

Then call any tool from Claude with that setup code → expect `No caller identity`. Restore the timestamp afterward.

### 5.4 — Manager removal revokes setup codes

In Claude (Family A Manager):

> Call `invite-member` with role "co-parent" and name "Test Co-parent". Show me the response.

Then accept that invite from a curl session (or from a third client). The new co-parent gets their own setup code. Then in Claude:

> Call `manage-members` with action "remove" and memberId = `<co-parent uuid>`.

Then attempt any tool from the co-parent's setup-code URL. **Expected:** `No caller identity` — `revokeForMember` was called as part of remove, all their codes are revoked.

---

## Phase 6 — Cleanup or persist

### Option A — Persist for ongoing dogfooding

Leave Family A (Isaac) and Family B (Beta) on the volume. Both can be your real-world test families. Just back up the master key:

```bash
railway ssh "xxd /app/data/.master-key" | tee ~/Desktop/allowme-master-key-$(date +%Y%m%d).hex
```

Store that hex dump somewhere safe. If the volume ever dies, set `MASTER_KEY=<hex>` env var on Railway and the family-keys.json blobs will still decrypt.

### Option B — Wipe and start fresh

```bash
railway ssh "rm -rf /app/data/families /app/data/.master-key /app/data/.migrated-2.9 /app/data/family-keys.json /app/data/member-index.json /app/data/setup-codes.json"
railway redeploy --yes
```

Then re-run Phase 1 with your real family details.

---

## Result template

Copy this into a chat or commit it to `sprint-2.9/live-test-results-<date>.md` after running:

```
Sprint 2.9 Live Test — <date>
================================
Phase 0 (preflight):       [ ] Pass  [ ] Fail   notes:
Phase 1 (Claude bootstrap):[ ] Pass  [ ] Fail   notes:  setupCode_A=SETUP-****-XXXX
Phase 2 (Claude scoped):   [ ] Pass  [ ] Fail   notes:
Phase 3 (ChatGPT bootstrap):[ ] Pass [ ] Fail   notes:  setupCode_B=SETUP-****-XXXX
Phase 4.1 (A blocked from B):    [ ] Pass [ ] Fail
Phase 4.2 (cross-family memberId):[ ] Pass [ ] Fail
Phase 4.3 (treasury isolation):  [ ] Pass [ ] Fail
Phase 4.4 (stranger rejected):   [ ] Pass [ ] Fail   <-- security-critical
Phase 4.5 (bootstrap still works):[ ] Pass [ ] Fail
Phase 5 (edge cases):      [ ] Pass [ ] Fail   notes:
Final state: [ ] persisted A+B  [ ] wiped clean
```

If any Phase-4 row is FAIL → revert deploy, re-investigate. The security fix did not hold.

---

## Troubleshooting

### Claude says "Tool returned error" with no JSON body
The connector URL is wrong (typo or missing setup code). Re-check the `?setup=` query param.

### "No caller identity" when you DO have a setup code in the URL
Check `https://allowme.dev` is reachable: `curl -sS https://allowme.dev/health`. If yes, the setup code may be expired (>48h since issuance). Solution: ssh in, look at `setup-codes.json`, regenerate by running `configure-policy` again from a different bootstrap session — but note this creates a NEW family. For the same family, use `invite-member` from an active Manager + accept the invite.

### Claude.ai connector dialog won't accept the URL with `?setup=...`
Some MCP UIs filter query strings. Workaround: use the bare URL `https://allowme.dev/mcp` and add a header `Mcp-Session-Setup-Code: SETUP-XXXX-XXXX` if Claude supports custom headers. If not, file a UX issue and use Claude Desktop instead (which accepts arbitrary URLs).

### Server returns 502 Bad Gateway
Container restarting or build still in progress. Wait 60s and retry. If persistent, `railway logs --deployment` for the error.

### Tests in Phase 4 fail (data leaks across tenants)
Stop. The hotfix did not deploy correctly. Run `git log -1 origin/main` — if it's not `efb5cdc` or later, push the latest commit. Then `railway up --detach` and re-run preflight.
