# AllowanceAgent

> **SpendOS for families — five roles, five policy bundles, one OWS vault, and nobody in the family ever sees a private key.**

---
//

## OWS Hackathon Submission — Track 02: Agent Spend Governance & Identity

**[Demo Video](https://www.youtube.com/watch?v=EYAkpVwEWmg)** | **[GitHub](https://github.com/JdejesusIsaac/AllowMeOWS)**

AllowanceAgent is the first consumer-ready OWS application. A family financial agent where no one in the family ever sees a wallet address, an API key, or a policy JSON — but every dollar is policy-gated, every role is cryptographically enforced, and every distribution is on-chain.

### Why Track 02

AllowanceAgent implements four of the nine Track 02 building opportunities in a single integrated product:

- **SpendOS for teams** — Five-role policy architecture (Manager, Co-parent, Learner, Family, Advisor). Each role maps to a pre-built OWS policy bundle with different signing rules, wallet scopes, and spending caps. The parent issues scoped API keys through natural language — "invite Grandma Rosa as family" — not through a dashboard.

- **Dead man's switch** — LegacyLink estate logic with tiered escalation (30/60/90 days), conditional release (age + educational attestation), and lawyer audit-read-only delegation. The "Agent Inheritance Protocol" applied to the most important use case: what happens to my family's money when I'm gone.

- **Audit log forensics** — Every achievement verification, USDC distribution, invite, role change, and policy update is logged with actor, timestamp, amount, and tx hash. `check-progress` is the family-friendly version of Datadog for agent wallets.

- **Multi-sig agent governance** — Two-tier RBAC where the Manager must approve distributions, the Co-parent can verify achievements but not spend, the Learner can self-report but not distribute, and the Advisor can audit but not sign. Enforced at both the app layer and the OWS custom policy executable.

### What's Built and Working

- **17 MCP tools** — configure-policy, view-policy, verify-achievement, distribute-allowance, check-progress, check-savings, check-goals, invite-member, **resend-invite**, accept-invite, **test-connection**, **view-my-link**, manage-members, get-funding-address, release-savings, connect-fitbit, convert-savings
- **Sign-in-with-Base onboarding** *(Sprint 3.0 v4)* — one-tap verify page at `/verify` using `@base-org/account` SIWE. New families bootstrap without ever pasting JSON into Claude; returning users get fresh 30-day magic-link URLs auto-rotated from their wallet signature. *(Sprint 3.6 extends `/verify` with connector install tabs, optional walkthrough GIFs, Markdown brand modals, and UA-aware defaults.)*
- **432 passing tests** (1 skipped counterfactual-wallet fixture) — unit + integration + E2E covering policy engine, invite system, RBAC matrix, SIWE verification, session tokens, rate-limited invite preview, cross-family Manager flows, destination allowlist enforcement, verify-page bootstrap + SIWE/API suite, **`view-policy`** read matrix + cache, recovery tools (resend / test-connection / view-my-link), QR code field on invites, kid-facing MCP **rich markdown cards**, brand copy assertions for `public/copy/*.md`, UA parser for `/verify`, and full on-chain distribution.
- **Live on-chain USDC transfers** — Confirmed on Base Sepolia (April 2, 2026). EIP-1559 transactions with viem. Partial success handling.
- **Claude Desktop integration** — Live-tested with Sonnet 4.6. Full conversational flow. No OWS internals ever exposed to the user.
- **Custom OWS policy executable** — `allowance-policy.py` handles all roles with ERC-20 calldata decoding, spend cap enforcement, and recipient allowlists
- **Human-readable invite codes** — `MAYA-GIFT-7X2K`. Phone-speakable, 48h expiry, single-use. One-tap redemption via `/verify?invite=CODE` with a read-only preview ("Joining the Asencio family as Learner — Sofia") before confirmation.
- **External wallet support** — Children can use MetaMask, Coinbase, or any EVM address alongside OWS-managed wallets

### The Consumer Proof Point

Most OWS projects are developer tools. AllowanceAgent proves the standard works for normal people. A parent says "set up Maya with $15 a week" and Claude creates OWS wallets, policy bundles, and API keys. A grandmother says "I have a code: MAYA-GIFT-7X2K" and she's connected with gift-only permissions. A child completes a lesson, earns USDC, and watches her savings vault grow. None of them know what OWS is. That's the point.

**Built by [AllowMe LLC](https://juanisaac.dev) — Juan Isaac**

---

## What it does

Parents configure rules in plain English. Claude handles the rest: wallet creation, achievement tracking, USDC distribution, savings vaults, and family member access — all invisible to the user.

**Example:**

**Family:**
> "Set up Maya with $15/week. 50% reading, 30% sports, 20% art. Put 20% into savings."

**Business:**
> "Set up AI allowance for the engineering team. $50/week. 60% AI subscriptions, 25% compute, 15% training."

> "Maya finished her reading goal — 90 out of 100."

> "Distribute what Maya has earned." → USDC sent on-chain

> "Invite Grandma Rosa so she can see Maya's progress."

Category names are user-defined strings, not enums. The same engine works for families, businesses, and teams.

Children can use **OWS-managed wallets** (created automatically) or **external wallets** (MetaMask, Coinbase, etc.) — the parent chooses per child during setup.

## Architecture

```
                      ┌─────────────────────────────┐
                      │     AllowanceAgent Server     │
                      ├──────────┬──────────┬─────────┤
Claude Desktop ←stdio→│ src/     │          │         │
Claude Mobile  ←http→ │ index.ts │ app/     │ OWS     │
Other Agents   ←a2a→  │ (MCP)    │ server.ts│ wallets │
                      │          │ (aixyz)  │ policies│
                      └──────────┴──────────┴─────────┘
                                    ↓
                              data/*.json
```

**Dual transport:**
- **stdio** (`npm start`) — Claude Desktop, local development
- **HTTP** (`npm run start:http`) — Claude Mobile, remote access, agent-to-agent

**Core:**
- **Claude is the only interface** — no family member ever sees wallet addresses, keys, or JSON
- **OWS handles custody** — wallets, policy-gated signing, API key delegation
- **USDC on Base** — ERC-20 transfers for real-value allowances (testnet or mainnet)
- **Five roles** — Manager, Co-parent, Learner, Family, Advisor — enforced at both app and OWS layer
- **x402 micropayments** — manager power tools (distribute, manage, invite) are payment-gated for agent-to-agent; learner tools are free
- **A2A discovery** — `/.well-known/agent-card.json` for OpenMAIC, MoonPay, and other agents

## MCP Tools

| Tool | Description | Roles | x402 |
|------|-------------|-------|:----:|
| `configure-policy` | Set up allowance rules per child | Manager | Free |
| `view-policy` | Read persisted policy (role-aware sections + filtering) *(Sprint 3.0.6)* | Manager, Co-parent, Advisor | Free |
| `verify-achievement` | Log and evaluate a child's achievement (source tracking) | Manager, Co-parent, Learner | Free |
| `distribute-allowance` | Send earned USDC to child + savings wallets | Manager | $0.01 |
| `check-progress` | Weekly status, streaks, category breakdown with source | Manager, Co-parent, Family, Learner | Free |
| `check-savings` | Savings vault balances, lock dates, projections | Manager, Co-parent, Learner | Free |
| `check-goals` | Learning goals + subgoal status/deadlines | Manager, Co-parent, Family, Learner | Free |
| `invite-member` | Generate a human-readable invite code | Manager | $0.003 |
| `resend-invite` | Manager-only revoke + re-issue learner/co-parent/etc. invites *(Sprint 3.6)* | Manager | Free |
| `test-connection` | Identity + heartbeat / health ping *(Sprint 3.6)* | All | Free |
| `view-my-link` | Show your MCP URL + audited magic-link fingerprint *(Sprint 3.6)* | All | Free |
| `accept-invite` | Join the family with an invite code | All | Free |
| `manage-members` | List, change roles, or remove members | Manager | $0.005 |
| `get-funding-address` | Show the treasury wallet address for funding | Manager | $0.001 |
| `release-savings` | Release matured savings with streak multiplier bonus | Manager | Free |
| `connect-fitbit` | Get Fitbit OAuth URL to link a child's health data | Manager | Free |
| `convert-savings` | Record a MoonPay swap result: USDC savings → PAXG (gold) | Manager | Free |

## Quick Start

### Prerequisites

- Node.js >= 20
- [Claude Desktop](https://claude.ai/download)

### Install

```bash
cd allowmeOpenWalletStandard
npm install
```

### Connect to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "allowance-agent": {
      "command": "/path/to/node/.bin/npx",
      "args": [
        "tsx",
        "/absolute/path/to/allowmeOpenWalletStandard/src/index.ts"
      ]
    }
  }
}
```

> Replace paths with your actual `npx` binary and project location.
> Find your npx path with: `which npx`

Restart Claude Desktop. You'll see 17 tools available.

### First conversation

1. **Configure:** *"Set up allowances for the Garcia family. Maya gets $15/week."*
2. **Verify:** *"Maya finished her math homework today — 85 out of 100 for education."*
3. **Check:** *"How is Maya doing this week?"*
4. **Distribute:** *"Distribute what Maya has earned."* (dry-run by default)
5. **Invite:** *"Invite Grandma Rosa as a family member."*

## How it works

### Achievement → Distribution flow

```
verify-achievement
  → PolicyEngine.evaluateAchievement (score × category budget)
  → evaluateStreak (consecutive-day bonus, up to 2.0x)
  → queue achievement record

distribute-allowance
  → calculateSavingsSplit (e.g. 80% child / 20% savings)
  → WalletDistributor.transferUSDC (viem walletClient, EIP-1559)
  → wait for on-chain confirmation
  → audit log (partial success if savings transfer fails)
```

### Role-Based Access Control

Every tool enforces RBAC at two layers:

1. **App layer** — `isToolAuthorized(toolName, role)` checked in every handler
2. **OWS layer** — `allowance-policy.py` enforces signing rules per role

| Role | Can do | Cannot do |
|------|--------|-----------|
| **Manager** | Everything | — |
| **Co-parent** | Verify achievements, view progress/savings | Configure, distribute, invite, manage |
| **Family** | View progress, send gifts | Verify, distribute, configure |
| **Advisor** | View audit log | Everything else |
| **Learner** | View own progress/savings, self-report achievements | View other children, configure, distribute, invite |

### Invite System

Invite codes are human-readable and phone-speakable:

```
MAYA-COPRT-7X2K
^^^^  ^^^^^  ^^^^
child  role   random
```

- 48-hour expiry, single-use
- Avoids ambiguous characters (0/O, 1/I)
- Accepting creates an OWS API key scoped to the role's policy

### Wallet Architecture

| Wallet | Purpose |
|--------|---------|
| `treasury` | Parent funds this — source of all distributions |
| `child-{name}` | Each child's spending wallet (OWS-managed, or external address) |
| `savings-vault` | Locked savings with streak multiplier bonus |
| `gift-fund` | Family members contribute gifts here |

**OWS-managed wallets** are created automatically when you first run `configure-policy`. Children can alternatively use **external wallet addresses** (MetaMask, Coinbase, etc.) — just provide the address during setup and OWS wallet creation is skipped for that child.

Distribution uses OWS for secure key storage (`exportWallet`) and viem for transaction construction, signing, and broadcast — giving full control over nonce management, gas estimation, and EIP-1559 formatting.

### Sign-in-with-Base onboarding *(Sprint 3.0 v4)*

Parents and co-parents skip the "paste this JSON into Claude Desktop" onboarding step entirely. The server hosts a static verify page at `/verify` that uses Coinbase's `@base-org/account` SDK to sign an [EIP-4361](https://eips.ethereum.org/EIPS/eip-4361) message with the user's Base wallet — no gas, no transaction, just a signature.

**The five onboarding flows, all through one URL:**

| URL | Who clicks | What happens |
|-----|------------|--------------|
| `/verify` | A new parent setting up their family | Signs in with Base → fills a short family-creation form → receives their MCP magic-link URL |
| `/verify` | A returning parent whose laptop got wiped | Signs in with Base → the server recognizes their wallet → issues a fresh 30-day magic-link URL, revokes the old one |
| `/verify?invite=ASEN-COPRT-X7K2&role=co-parent` | A Co-parent invited by SMS | Preview shows "Joining the Asencio Family as Co-parent" → signs in with Base → joined |
| `/verify?invite=SOFI-LEARN-X7K2&role=learner` | A child (Sofia) who doesn't have a wallet | Preview shows "Joining the Asencio Family as Learner — Sofia" → confirms her name → receives her private magic-link URL |
| `/verify` (multi-family wallet) | A Manager in Family A who is Co-parent in Family B | Signs in once → picker shows both memberships → picks one → fresh 30-day magic-link URL for that family only |

**Security model:**
- **SIWE verification** via viem's `verifySiweMessage` public-client action — supports ERC-6492 counterfactual Base Account signatures (wallets that haven't been deployed on-chain yet).
- **Single-use nonces** with 5-minute TTL; replay-protected.
- **Short-lived session tokens** (10-minute HMAC-SHA256 JWTs, `.session-secret` auto-generated on first boot).
- **Invite preview is strictly read-only** — `GET /api/invites/:code/preview` never consumes the invite, even on transient error. Rate-limited to 30 requests/minute/IP to mitigate code enumeration against the ~20-bit suffix space.
- **Cross-family isolation** — each `(memberId, familyId)` tuple is its own independent membership; rotating the setup code for Family A never affects Family B.

See `sprint-3.0/research-3.0-v4.md` for the full threat model and security/UX trade-off analysis (particularly the "preview discloses child's first name for Learner invites" decision).

### Child Connection Paths

Three ways a child connects their Claude to AllowanceAgent — families choose what works for their age and comfort level:

**Path A: Parent sets up child's device**
Best for younger children (6-10). Parent opens Claude on the child's phone/tablet, adds the MCP connector, and hands it back. The child just talks to Claude.

**Path B: Child self-configures Claude Desktop**
Best for older children (13+). Parent texts the server URL. Child adds it to Claude Desktop config:

```json
{
  "mcpServers": {
    "allowance-agent": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://allowme.dev/mcp"]
    }
  }
}
```

Then tells Claude: *"I have a code: MAYA-LEARN-8K3W"*

**Path C: Parent texts join instructions via Claude**
Best for any age. Parent says *"Text Maya her invite"* and Claude sends via `message_compose`:

> Your Garcia family set up your allowance! Connect your Claude to: https://allowme.dev — then tell Claude: MAYA-LEARN-8K3W

**Parent Claude Desktop config (stdio — local):**
```json
{
  "mcpServers": {
    "allowance-agent": {
      "command": "npx",
      "args": ["tsx", "/path/to/allowmeOpenWalletStandard/src/index.ts"]
    }
  }
}
```

**Parent Claude Desktop config (HTTP — remote):**
```json
{
  "mcpServers": {
    "allowance-agent": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://allowme.dev/mcp"]
    }
  }
}
```

> **Note:** Claude free plan gets 1 custom connector. AllowanceAgent uses it. Pro/Max get unlimited. For schools: Team/Enterprise admin adds the connector once, all parents see it automatically.

### OpenMAIC Orchestration Pattern

AllowanceAgent is an **achievement sink** — it accepts verified achievements from any source without caring how they were generated. OpenMAIC (open-source math/AI curriculum) is one such source.

**How Claude orchestrates between AllowanceAgent and OpenMAIC:**

```
Parent: "Maya, time for your math lesson"
    │
    ▼
Claude → OpenMAIC: start lesson (topic: Fractions, grade: 4)
    │     Child works through interactive problems
    │     OpenMAIC returns: { score: 88, topic: "Fractions", classroomId: "abc-123" }
    │
    ▼
Claude → AllowanceAgent verify-achievement:
    {
      childName: "Maya",
      category: "education",
      description: "Completed OpenMAIC: Introduction to Fractions",
      score: 88,
      source: "openMAIC",
      metadata: { classroomId: "abc-123", topic: "Fractions" }
    }
    │
    ▼
AllowanceAgent: records achievement, applies streak multiplier, queues for distribution
    │
    ▼
Parent checks progress → sees "education: 88/100 — verified by OpenMAIC"
```

**Key design:** AllowanceAgent has zero OpenMAIC code dependency. Claude is the coordinator. Either system can evolve independently. The `source` field provides provenance so parents see *who* verified each achievement — "openMAIC" vs "self-report" vs "fitbit" vs "manual" (parent-verified).

### MoonPay Peer MCP Integration

MoonPay runs as a **separate MCP server** alongside AllowanceAgent. Claude orchestrates between both — AllowanceAgent has zero MoonPay code dependency.

**Install MoonPay CLI:**
```bash
npm install -g @moonpay/cli
moonpay auth login
```

**Claude Desktop config with both MCP servers:**
```json
{
  "mcpServers": {
    "allowance-agent": {
      "command": "npx",
      "args": ["tsx", "/path/to/allowmeOpenWalletStandard/src/index.ts"]
    },
    "moonpay": {
      "command": "moonpay",
      "args": ["mcp", "serve"]
    }
  }
}
```

**Three orchestration workflows Claude can perform:**

1. **Fiat on-ramp to treasury** — Parent says *"Add $50 to the treasury."* Claude calls `get-funding-address` (AllowanceAgent) → gets treasury wallet address → calls MoonPay buy (fiat → USDC → treasury address). Parent pays via Apple Pay/card on MoonPay's hosted checkout.

2. **Savings diversification** — Parent says *"Convert half of Maya's savings to gold."* Claude calls `check-savings` (AllowanceAgent) → $25 locked → calls MoonPay swap (USDC→PAXG) → calls `convert-savings` (AllowanceAgent) to record the result. See [Savings Diversification](#savings-diversification-usdc--paxg-gold) for the full flow.

3. **Combined portfolio view** — Parent says *"What does Maya have?"* Claude calls `check-savings` + `check-progress` (AllowanceAgent) → USDC position → calls MoonPay `discover-tokens` for price context → displays unified view: "$12.50 USDC savings (locked 67 days) + $4.40 earned this week."

> **AllowanceAgent has zero MoonPay dependency.** No imports, no API calls, no shared state. Claude orchestrates both servers independently.

### Savings Diversification (USDC → PAXG Gold)

Parents can convert a child's USDC savings into gold-backed tokens (PAXG) via MoonPay. AllowanceAgent is the **ledger**, MoonPay is the **execution engine**, Claude is the **coordinator**.

**Full orchestration flow:**

```
Parent: "Convert half of Maya's savings to gold"
    │
    ▼
Claude → AllowanceAgent check-savings: $6.00 USDC locked for Maya
    │
    ▼
Claude → MoonPay discover-tokens: get PAXG price → ~$4,660/oz
    │
    ▼
Claude → MoonPay swap: $3.00 USDC (Base) → PAXG (Ethereum)
    │     MoonPay handles: bridge + swap + routing
    │     Returns: txHash, PAXG amount received (~0.000644 PAXG)
    │
    ▼
Claude → AllowanceAgent convert-savings:
    {
      childName: "Maya",
      usdcAmount: 3000000,
      receivedAsset: "PAXG",
      receivedAmount: "0.000644",
      txHash: "0xabc...",
      priceAtConversion: 4660.00
    }
    │
    ▼
AllowanceAgent internally:
    1. Find Maya's USDC savings entries totaling ≥ $3.00
    2. Mark consumed USDC entries as converted
    3. Create new SavingsEntry with asset: "PAXG"
    4. Audit log: "savings-converted" action
    │
    ▼
Claude: "Done. Maya's savings vault now holds $3.00 in USDC and
         0.000644 oz of gold (~$3.00 at today's price). Gold
         doesn't earn the savings multiplier — it earns gold price
         appreciation instead."
```

**Multi-asset display** — `check-savings` groups positions by asset:
- **USDC:** locked amount, multiplier, release dates
- **PAXG:** amount in oz, value at conversion price, educational note about price appreciation vs streak multipliers

**Gold release** — When PAXG savings are released, AllowanceAgent marks them as released in the ledger and returns an orchestration message. Claude then coordinates MoonPay to swap PAXG back to USDC for transfer to the child's wallet. AllowanceAgent never executes Ethereum transactions directly.

**Key design decisions:**
- PAXG lives on Ethereum (not Base) — MoonPay handles the cross-chain swap
- Gold doesn't earn streak multiplier (`multiplierAtDeposit: 1.0`) — it earns price appreciation
- PAXG amounts stored as strings to avoid 18-decimal integer overflow
- Zero MoonPay code in AllowanceAgent — Claude orchestrates everything

## Development

### Type check

```bash
npm run typecheck
```

### Run tests

```bash
npm test
```

### Run locally (stdio — Claude Desktop)

```bash
npm start
```

### Run HTTP server (Claude Mobile / agents)

```bash
npm run start:http
```

Endpoints:
- `POST /mcp` — MCP over HTTP (StreamableHTTPServerTransport)
- `POST /agent` — A2A JSON-RPC
- `GET /.well-known/agent-card.json` — Agent discovery card
- `GET /fitbit/connect?child=maya` — Fitbit OAuth redirect
- `GET /fitbit/callback` — Fitbit OAuth callback
- `GET /verify` *(Sprint 3.0 v4 + Sprint 3.6 polish)* — Sign-in-with-Base onboarding SPA (+ install tabs, Markdown modals, UA helper)
- `GET /walkthroughs/*`, `GET /copy/*.md`, `GET /verify-ua.js` *(Sprint 3.6)* — static assets for verify UX (GIF placeholders + brand stories + UA parser bundle)
- `GET /api/auth/nonce` *(Sprint 3.0 v4)* — issue a SIWE nonce (5-min TTL)
- `POST /api/auth/verify` *(Sprint 3.0 v4)* — verify SIWE signature, return session token + memberships
- `POST /api/configure-family` *(Sprint 3.0 v4)* — bootstrap a family from a SIWE-verified wallet
- `POST /api/redeem-invite` *(Sprint 3.0 v4)* — redeem an invite code (adult with Bearer token, or Learner without)
- `POST /api/rotate-setup-code` *(Sprint 3.0 v4)* — issue a fresh 30-day setup code for a returning wallet
- `GET /api/invites/:code/preview` *(Sprint 3.0 v4)* — read-only invite metadata lookup (rate-limited 30/min/IP)
- `GET /health` — Health check

### Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `MASTER_KEY` | Optional | 256-bit hex key for encrypting per-family wallet keys. Auto-generated to `data/.master-key` if not set. Set this in Railway/Docker where filesystem is ephemeral. |
| `OWS_PASSPHRASE` | Deprecated | Legacy passphrase for existing families set up before Sprint 2.75. Still works as fallback. New families use per-family keys from MASTER_KEY. |
| `ALLOWANCE_AGENT_URL` | For HTTP | Public URL of the server (e.g. `https://allowme.dev`) |
| `SESSION_SECRET` | Optional | 256-bit hex key for signing Sign-in-with-Base session-token JWTs. Auto-generated to `data/.session-secret` if not set. Required in Railway/Docker where filesystem is ephemeral. |
| `ALLOWANCE_USE_TESTNET` | Optional | `"false"` to serve `/verify` pointed at Base Mainnet (chain id `0x2105`). Defaults to testnet (`0x14a34` Base Sepolia) for the pilot. |
| `FITBIT_CLIENT_ID` | For Fitbit | AllowMe LLC Fitbit developer app client ID |
| `FITBIT_CLIENT_SECRET` | For Fitbit | AllowMe LLC Fitbit developer app secret |
| `X402_RECIPIENT_WALLET` | For x402 | Wallet address that receives x402 micropayments |
| `X402_NETWORK` | For x402 | Network for payments (default: `eip155:8453` Base) |
| `ANTHROPIC_API_KEY` | For HTTP | Required for the ToolLoopAgent in A2A mode |

## Project Structure

```
src/                         Core business logic (stdio transport)
  index.ts                   MCP server entry point (17 tools registered)
  constants.ts               Chain IDs, USDC addresses, roles, RBAC matrix
  schemas.ts                 Zod schemas for all data types
  middleware/
    access-control.ts        RBAC: role resolution, authorization, child scoping
  engine/
    state.ts                 JSON file persistence (atomic writes)
    policy.ts                Achievement evaluation, savings split, streaks
  wallet/
    setup.ts                 OWS wallet + policy bundle initialization
    distributor.ts           USDC ERC-20 transfers via viem walletClient
  roles/
    manager.ts               Role → OWS policy mapping, API key CRUD
  invites/
    system.ts                Human-readable invite codes, validation
  keys/
    master-key.ts            Master key resolution (env var → file → auto-generate)
    family-keys.ts           Per-family key generation, encryption, retrieval
  fitbit/
    client.ts                Fitbit OAuth + Activity API client
    token-store.ts           AES-256-GCM encrypted token storage (uses MASTER_KEY)
  tools/                     14 MCP tool handlers
app/                         HTTP transport layer (aixyz adapter)
  server.ts                  AixyzServer + MCP + A2A + Fitbit OAuth endpoints
  agent.ts                   ToolLoopAgent for A2A interactions
  tools/                     Thin wrappers over src/ business logic
    _helpers.ts              HTTP RBAC (getPayer → member lookup)
aixyz.config.ts              Agent metadata, skills, x402 payment config
policies/
  allowance-policy.py        OWS custom executable policy (5 roles, ERC-20 decode)
tests/                       Unit + E2E test suites
data/                        JSON file store (gitignored, created automatically)
```

## Tech Stack

- **TypeScript** + **Node.js** (ESM)
- **@modelcontextprotocol/sdk** — MCP server over stdio
- **aixyz** — HTTP transport, x402 micropayments, A2A protocol
- **ai** + **@ai-sdk/anthropic** — Vercel AI SDK ToolLoopAgent for A2A
- **@open-wallet-standard/core** — wallet creation, policy enforcement, signing
- **viem** — ERC-20 calldata encoding, transaction signing, gas estimation, broadcast
- **zod** — schema validation
- **vitest** — testing

## Tested On-Chain

Successfully tested on Base Sepolia testnet (Apr 2, 2026):
- USDC transfers from treasury to child wallets (both OWS-managed and external)
- EIP-1559 transactions with automatic gas estimation
- Partial success handling (child transfer succeeds even if savings transfer fails due to gas)
- Transaction confirmation via `waitForTransactionReceipt`

## Roadmap

### Sprint 2 (Done)
- [x] **Learner role** — child connects from their own Claude account, sees only their own data
- [x] **HTTP transport** — multi-device access for parent + child + family via aixyz
- [x] **x402 micropayment gating** — revenue on manager power tools, learner tools free
- [x] **A2A protocol** — agent-card discovery + JSON-RPC for agent-to-agent
- [x] **Savings release tool** — auto-release on lock expiry with multiplier
- [x] **Source tagging** — track achievement provenance (openMAIC, fitbit, self-report)
- [x] **Fitbit OAuth** — one-tap health data connection per child
- [x] **Category % validation** — budget percentages must sum ≤ 100%

### Sprint 2.5 (Done)
- [x] **Savings diversification (USDC → PAXG)** — parents convert savings to gold-backed tokens via MoonPay
- [x] **Multi-asset savings display** — check-savings groups USDC and PAXG positions separately
- [x] **PAXG release orchestration** — gold release handled gracefully via Claude + MoonPay
- [x] **convert-savings tool** — Manager-only, records MoonPay swap results into the ledger

### Sprint 2.75 (Done)
- [x] **Server-managed per-family keys** — zero passphrase prompts in any user-facing flow
- [x] **MASTER_KEY auto-resolution** — env var → file → auto-generate on first run
- [x] **Per-family key isolation** — each family gets a unique 256-bit key, encrypted at rest
- [x] **Backward compatible** — existing OWS_PASSPHRASE families continue to work
- [x] **Fitbit encryption upgraded** — token store uses MASTER_KEY instead of OWS_PASSPHRASE

### Sprint 3.0 v4 (Done)
- [x] **Sign-in-with-Base onboarding** — `/verify` SPA + SIWE verification + session-token JWTs. Families bootstrap without pasting JSON into Claude; returning users get fresh 30-day magic-link URLs auto-rotated from their wallet signature.
- [x] **Invite preview endpoint** — `GET /api/invites/:code/preview` returns read-only family/role/childName/expiresAt metadata (rate-limited 30/min/IP). Learner invites render "Joining as Learner — Sofia" for recognition UX; non-Learner invites strip the childName to minimize PII disclosure.
- [x] **One-tap invite redemption** — `invite-member` tool response emits `/verify?invite=CODE&role=ROLE` URLs; SMS the link, recipient taps once, redeems in <10 seconds.
- [x] **Cross-family Manager support** — a single wallet can legitimately hold Manager in Family A AND Co-parent in Family B; `/api/auth/verify` surfaces all memberships; rotation on one never affects the others.
- [x] **Priority 0 session-token access control** — short-lived Bearer tokens from the verify page can authenticate MCP tool calls without the setup-code detour.

### Sprint 3.0.2 (Done)
- [x] **Destination allowlist** — `FamilyConfig.authorizedDestinations` constrains every USDC outflow on the child-wallet leg of `distribute-allowance` and `release-savings`. Internal vaults (savings, gift fund) are exempt by construction. A compromised Manager session can no longer drain treasury to an attacker address: the allowlist check fires before `transferUSDC`, the rejection records an audit entry (`transfer-rejected-by-allowlist`), and the on-chain transfer is never attempted.
- [x] **Auto-populated + force-added** — `configure-policy` auto-populates the allowlist on bootstrap (admin wallet + every child's `walletAddress`) and force-adds the caller's wallet + every child's wallet on every update. Your wallet and each child's wallet are *always* on the allowlist — explicitly omitting them in an update does not remove them. Prevents the parent from locking themselves out and prevents an attacker from "swapping" an address via configure-policy.
- [x] **Block-on-removal protection (Decision 3)** — `configure-policy` rejects any update that would remove an address from the allowlist when the corresponding child has unreleased and unconverted savings entries. The error lists *every* affected child (not just the first) so the parent knows exactly which savings to release or convert before retrying.
- [x] **Four new audit-log actions** — `transfer-rejected-by-allowlist`, `transfer-rejected-by-policy-enforcer`, `authorized-destinations-updated`, `authorized-destinations-removal-blocked`. Every mutation and every rejection leaves a record.
- [x] **Backward-compatible schema** — pre-3.0.2 family configs load cleanly via Zod default; the first `configure-policy` call after deploy lazy-migrates the allowlist field. No data migration script required.
- [x] **Forward-compatible for Sprint 4.0** — `authorizedDestinations` is the exact data shape a Coinbase Smart Wallet spend permission consumes as its recipient constraint. When the enforcement layer migrates from the app to the chain in Sprint 4.0, the data model survives unchanged.

### Sprint 3.0.5 (Done)
- [x] **Verify-page form extension** — `/verify` bootstrap form now captures per-child wallet addresses (BYO wallet, optional) and learning goals (topic + category + subgoals + ISO deadline, up to 5 goals × 5 subgoals per child). Pre-3.0.5 payloads continue to bootstrap cleanly — every new field is `.optional()` end-to-end and `HE5c` locks the backward-compat contract.
- [x] **HTTP boundary alignment** — `configureFamilyBodySchema` extended to mirror `LearningGoalSchema` so subgoals + deadlines are no longer silently stripped at the HTTP edge; the `/api/configure-family` response now surfaces `authorizedDestinations` so the post-bootstrap UI can render the allowlist that Sprint 3.0.2 generated.
- [x] **Allowlist transparency panel** — parents see (and can talk through with their kids) the addresses their family's treasury is allowed to send USDC to, immediately after bootstrap. Admin wallet labelled "Admin (you)", per-child wallets labelled by name, with a one-line note about `configure-policy` for later changes.
- [x] **Inline validation** — wallet shape regex checked on blur, goal-topic conditionally required when subgoals/deadline/category are populated. Defence-in-depth only — `tryNormalizeWallet` is still authoritative server-side.
- [x] **+6 net new tests** — `HE5c` (backward-compat regression bar), `HE5d` (rich payload: walletAddress + subgoals + deadline persist + allowlist auto-feeds child wallet), `HE5e` (multi-child mixed BYO/managed coexist), `HE5f` (deadline-only goal), `HE5g` (subgoals-only goal), `VP4` (verify-page DOM markers locked). 369 passing + 1 skipped.

### Sprint 3.0.6 (Done)
- [x] **`view-policy` MCP tool** — read counterpart to `configure-policy`. Returns the persisted family policy with destination provenance tagging (`manager-wallet | child:<name> | custom`), role-aware filtering, section slicing (`all | summary | children | destinations | learning-goals`), and per-child scoping. Read-only by construction — no state mutation, no audit-log entries.
- [x] **`policyVersion` write counter** — monotonic, single-counter-per-family. Bootstrap writes `1`; every subsequent `configure-policy` increments by exactly `1`. Pre-3.0.6 family configs lazy-migrate to `policyVersion: 0` via Zod default (same pattern as Sprint 3.0.2's `authorizedDestinations`). Foothold for a future optimistic-concurrency guard on `configure-policy` and a cache-correctness discriminator today.
- [x] **5×4 role × section access matrix** — encoded as data in `src/middleware/policy-view-filter.ts` so the matrix is auditable in one place. Manager / Co-parent see everything. Advisor sees everything except `children[].walletAddress`. Family + Learner rows are matrix data only — the tool itself is denied at the `withAccessControl` gate for those roles in v1 (`tight_v1` profile). Sibling enumeration blocked: a Learner asking for a sibling's name gets the same `CHILD_NOT_FOUND` shape as a fictional name (no `validChildNames` field leaks).
- [x] **In-process FamilyConfig cache** — 60s TTL keyed by `familyId`. Synchronous write-invalidation inside `configureFamilyCore` (both bootstrap and update paths), so HTTP + MCP write paths both flush the cache without coupling to the read-side layer. Single-process Railway deployment ⇒ no cross-instance coherence problem to solve in this sprint.
- [x] **+47 net new tests** — `CP-VER1/2/3` (policyVersion regression bar), `PV-H1..H5` (provenance tagging), `VP-T1..T6` (Manager happy path), `VP-T7a/T7b` (tool-level access denial — locks the v1 tight profile), `PV-M-*` (20-cell role × section matrix, parameterized via `it.each`), `PV-CHILDNAME1..4` (childName scoping + sibling-enumeration block), `PV-WALLETS1..3` (role-precedence over client `includeWallets`), `PC1..PC4` (cache TTL + invalidation + no-stale-read integration). 416 passing + 1 skipped *(snapshot at Sprint 3.0.6 ship; see Sprint 3.6 for today's totals).*

### Sprint 3.6 (Done — design completeness pass)

Design + recovery + kid UX polish layered on Sprint 3.0.x without breaking JSON tool contracts (`summary` fields are additive; structured fields retained per C3a).

- [x] **Connector install walkthrough** — `/verify` success state exposes Claude / ChatGPT / Other tabs, numbered steps, optional `public/walkthroughs/*.gif` with SVG fallback, UA-selected default tab + ChatGPT inline banner (`public/verify-ua.js`).
- [x] **QR-enhanced invites** — `invite-member` can surface a supplemental QR (`inviteQrCode`) plus existing verify URL/message copy (**QR1** guarded in CI).
- [x] **Rich MCP cards** — Kid-facing tools (`check-progress`, `check-savings`, `check-goals`, `verify-achievement`) emit Markdown `summary` cards alongside unchanged machine fields (**CARD1–CARD4** guarded in CI).
- [x] **Failure recovery tools** — `resend-invite` + `test-connection` + `view-my-link`, Manager-first RBAC, audit breadcrumbs without leaking plaintext setup codes (**RC1–RC8** guarded in CI).
- [x] **Brand narratives** — `public/copy/security.md` + `public/copy/why.md` served statically; `/verify` renders them through lazy-loaded [`marked`](https://github.com/markedjs/marked) (**MODAL1** content assertions in CI).
- [x] **Client detection helpers** — `defaultInstallTab` / `detectInAppClient` extracted for **`UA1`** deterministic coverage.

Automated sprint bar: **432 passing + 1 skipped**. Remaining gates: Railway smoke + recorded GIFs (+ real-device walkthrough QA).

### Sprint 4.0 (Next)
- [ ] **Postgres migration** — replace JSON file store; `listMembershipsByWallet` becomes O(1) on `wallet_address` index.
- [ ] **Paymaster + Sybil defense** — Coinbase Verifications integration so Learner wallets get gasless transactions without opening a DoS vector.
- [ ] **LegacyLink estate vault** — dead-man's-switch + conditional release with lawyer audit-read-only delegation.
- [ ] **Roblox Robux redemption** — children can convert USDC earnings to Robux.
- [ ] **OpenMAIC production integration** — move from manual `source: "openMAIC"` tagging to Claude-orchestrated verified classroom achievements.
- [ ] **GiftFlow** — streak bonuses trigger automated gift purchases.

## License

MIT
