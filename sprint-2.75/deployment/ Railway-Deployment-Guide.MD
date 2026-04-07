# AllowanceAgent — Railway Deployment Guide

## Pre-Deployment Checklist

Run locally. Every check must pass.

```bash
# 1. All tests pass
npm test
# Expected: 187 passed

# 2. TypeScript compiles clean
npm run typecheck
# Expected: 0 errors

# 3. HTTP server starts locally
npm run start:http
# Expected: "[AllowanceAgent] HTTP on :3001"
# Expected: "[keys] Master key auto-generated at data/.master-key"

# 4. Health check responds
curl http://localhost:3001/health
# Expected: {"status":"ok",...}

# 5. No secrets in git
git diff --cached --name-only | grep -E '\.env|\.master-key|family-keys'
# Expected: no output

# 6. Docker builds locally
docker build -t allowance-agent .
# Expected: builds without errors

# 7. npm audit clean
npm audit
# Expected: 0 critical vulnerabilities
```

---

## Step 1: Install Railway CLI

```bash
npm install -g @railway/cli
railway --version
```

---

## Step 2: Login to Railway

```bash
railway login
```

Sign in with GitHub (JdejesusIsaac account).

---

## Step 3: Initialize the Project

```bash
cd allowmeOpenWalletStandard
railway init
```

Select **"Empty Project"**, name it `allowance-agent`.

---

## Step 4: Verify Project Structure

These files must be in your project root:

```
allowmeOpenWalletStandard/
  ├── Dockerfile              ← Railway uses this to build
  ├── railway.toml            ← Deploy config (region, health check, replicas)
  ├── package.json            ← Must have start:http script
  ├── app/
  │   └── server.ts           ← HTTP entry point
  ├── src/
  │   ├── index.ts            ← stdio entry point (not used on Railway)
  │   └── keys/
  │       ├── master-key.ts   ← Auto-resolves master key
  │       └── family-keys.ts  ← Per-family key manager
  ├── policies/
  │   └── allowance-policy.py ← OWS custom policy
  └── data/                   ← Created at runtime (gitignored)
```

---

## Step 5: Verify .gitignore

```gitignore
# Secrets — NEVER commit
.env
.env.*
data/.master-key
data/family-keys.json
data/fitbit-tokens.json

# Runtime data (contains PII)
data/

# OWS wallet files
.ows/

# Node
node_modules/
```

Verify: `git status` should not show `data/` or `.env` as tracked.

---

## Step 6: First Deploy

```bash
railway up
```

Railway will:
1. Build from your Dockerfile (Node 20 Alpine, typecheck, non-root user)
2. Start `npx tsx app/server.ts`
3. Health check `/health` before routing traffic
4. Deploy to US East (closest to NYC)

Watch the build logs. You should see:
```
[keys] Master key auto-generated at data/.master-key
[AllowanceAgent] HTTP on :PORT
```

---

## Step 7: Get Your Public URL

```bash
railway open
```

Dashboard → **Settings → Networking → Public Networking** → **Generate Domain**.

You'll get a URL like:
```
allowme.dev
```

Verify:
```bash
curl https://allowme.dev/health
```

**Save this URL.**

---

## Step 8: Set Environment Variables

The server auto-generated a master key on first start. But Railway containers are ephemeral — on restart, that key is lost and your family data becomes inaccessible. Fix this by persisting the key as an env var.

### Get the auto-generated key from logs

1. Railway dashboard → your service → **Deployments** → click latest → **View Logs**
2. Find the line: `[keys] Master key auto-generated at data/.master-key`
3. Look for the hex value logged (or SSH into the container and read the file)

**If the key isn't logged in hex**, generate one locally and set it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the 64-character hex string.

### Set variables in Railway dashboard

Go to your service → **Variables** tab:

| Variable | Value | Required? |
|----------|-------|-----------|
| `MASTER_KEY` | *(64-char hex from above)* | **Yes** — survives container restarts |
| `ALLOWANCE_AGENT_URL` | `https://allowme.dev` | **Yes** — used in invite join messages |
| `NODE_ENV` | `production` | Recommended |
| `FITBIT_CLIENT_ID` | *(from dev.fitbit.com)* | Optional — skip for initial testing |
| `FITBIT_CLIENT_SECRET` | *(from dev.fitbit.com)* | Optional — skip for initial testing |
| `X402_RECIPIENT_WALLET` | *(your USDC address on Base)* | Optional — skip for initial testing |

Railway auto-redeploys after setting variables.

### Verify key persistence

Check logs after redeploy:
```
[keys] Master key loaded from MASTER_KEY env var
```

That confirms the key persists. If it still says "auto-generated," the env var wasn't set correctly.

---

## Step 9: Attach a Volume (Data Persistence)

Without a volume, family configs, savings, and Fitbit tokens are lost on restart.

1. Railway dashboard → your service → **Volumes**
2. Click **"Add Volume"**
3. Mount path: `/app/data`
4. Click **Save**

Railway redeploys. Now `data/` persists across restarts:
- `data/family-config.json` — family settings
- `data/family-keys.json` — encrypted per-family keys
- `data/savings.json` — savings vault entries
- `data/fitbit-tokens.json` — encrypted Fitbit tokens
- `data/audit.json` — audit log

---

## Step 10: Verify the Deployment

```bash
# Health check
curl https://allowme.dev/health

# Check logs confirm correct master key source
# Dashboard → Deployments → View Logs
# Should say: "Master key loaded from MASTER_KEY env var"
```

---

## Step 11: Connect Your Claude Account

1. Open **claude.ai** in your browser
2. **Settings** → **Connectors** → **Add custom connector**
3. Paste: `https://allowme.dev/mcp`
4. Click **Add**
5. New chat → **"+"** → **Connectors** → enable **AllowanceAgent**
6. Say: **"Set up allowance for the Isaac family. Maya gets $15 per week."**

Verify: family configured, no passphrase prompt, no errors.

---

## Step 12: Connect Your Wife's Claude (Mobile)

### She does:

1. Download **Claude** from App Store (iOS) — free
2. Create account or sign in
3. Open **Safari** → go to `claude.ai`
4. Sign in → **Settings** → **Connectors** → **Add custom connector**
5. Paste: `https://allowme.dev/mcp`
6. Tap **Add**
7. Open **Claude app** → **"+"** → **Connectors** → enable **AllowanceAgent**

### You do (from your Claude):

8. Say: **"Invite my wife as co-parent"**
9. Claude generates invite code (e.g., `ISAAC-COPRT-4K7W`)
10. Text the code to your wife

### She does:

11. In Claude app: **"I have a code: ISAAC-COPRT-4K7W"**
12. She's connected as co-parent

---

## Step 13: Test the Full Flow

| # | Who | Says | Expected |
|---|-----|------|----------|
| 1 | You | "Set up allowance for Maya, $15/week" | Family configured, wallets created |
| 2 | You | "Maya finished her reading — 90 out of 100" | Achievement verified, streak updated |
| 3 | You | "How's Maya doing?" | Progress report |
| 4 | You | "Invite my wife as co-parent" | Invite code generated |
| 5 | Wife | "I have a code: ISAAC-COPRT-4K7W" | Joins as co-parent |
| 6 | Wife | "How's Maya doing?" | Same progress report |
| 7 | Wife | "Maya finished her math quiz — 85" | Verify works (co-parent allowed) |
| 8 | Wife | "Distribute what Maya earned" | **DENIED** — co-parent can't distribute |
| 9 | You | "Distribute what Maya earned" | Dry-run shows amounts |
| 10 | You | "Yes, send it" | USDC moves on-chain |
| 11 | Both | "Check Maya's savings" | Savings vault shows locked USDC |

---

## Security Hardening Checklist

| Item | Status | Notes |
|------|--------|-------|
| HTTPS | ✅ Railway auto | All Railway domains are HTTPS by default |
| Non-root container | ✅ Dockerfile | Runs as `appuser`, not root |
| Node pinned | ✅ Dockerfile | `node:20-alpine` — no version drift |
| Secrets in env vars | ✅ | MASTER_KEY, FITBIT secrets in Railway Variables, not in code |
| Health check | ✅ | `/health` returns 200, Railway checks before routing |
| US East region | ✅ railway.toml | `region = "us-east4"` — closest to NYC |
| Serverless off | ✅ | Railway services are persistent by default with Dockerfile deploy |
| CORS restricted | ⚠️ Check | Verify `app/server.ts` doesn't use `cors({ origin: "*" })` in production. Restrict to Claude origins. |
| Bearer auth / OAuth | 🔜 Sprint 3 | RBAC handles role enforcement. Full OAuth for production. |
| 2+ replicas | 🔜 When needed | Single replica for testing. Add for Success Academy pilot. |
| Graceful shutdown | ⚠️ Add | Add `SIGTERM` handler for zero-downtime deploys (see below) |
| Data on volume | ✅ Step 9 | `/app/data` persisted across restarts |

### Graceful Shutdown (Add to app/server.ts)

```typescript
process.on("SIGTERM", () => {
  console.error("[AllowanceAgent] SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.error("[AllowanceAgent] Server closed");
    process.exit(0);
  });
  // Force exit after 10 seconds if connections don't close
  setTimeout(() => process.exit(1), 10000);
});
```

Railway sends SIGTERM before stopping a container. Without this handler, active MCP sessions are killed abruptly.

---

## Troubleshooting

### Docker build fails
- Check `tsconfig.json` paths match Dockerfile COPY paths
- Verify `package-lock.json` exists (required for `npm ci`)
- Run `docker build -t allowance-agent .` locally first

### Health check fails after deploy
- Verify Express binds to `0.0.0.0` (not `localhost`)
- Verify `process.env.PORT` is used (Railway injects it)
- Check Railway logs for startup errors

### "Master key auto-generated" after restart
- `MASTER_KEY` env var not set or set incorrectly in Railway
- Fix: set the env var, redeploy
- Without it, a restart generates a new key and old family data is inaccessible

### Wife can't see AllowanceAgent in Claude
- Must add via **claude.ai website** (Safari), not the app directly
- Free plan: 1 custom connector. Remove existing one if she has one.
- Syncs to mobile automatically after adding on web

### RBAC denial
- Check invite code role hint: `COPRT` = co-parent, `LEARN` = learner
- Co-parent cannot: distribute, configure, invite, manage

### Container keeps restarting
- Check logs for crash reason
- `restartPolicyMaxRetries = 3` — after 3 failures, Railway stops retrying
- Most common cause: missing env var or port binding issue

---

## Railway Costs

Hobby plan: $5/month
- AllowanceAgent uses ~50MB RAM, near-zero CPU at idle
- Well within Hobby plan limits for testing
- Pro plan ($20/month) needed for: volumes > 5GB, 2+ replicas, custom domains