# AllowanceAgent

> **SpendOS for families — five roles, five policy bundles, one OWS vault, and nobody in the family ever sees a private key.**

---

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

- **9 MCP tools** — configure-policy, verify-achievement, distribute-allowance, check-progress, check-savings, invite-member, accept-invite, manage-members, get-funding-address
- **84 passing tests** — 71 unit + 13 E2E covering policy engine, invite system, RBAC matrix, state management, and full flow
- **Live on-chain USDC transfers** — Confirmed on Base Sepolia (April 2, 2026). EIP-1559 transactions with viem. Partial success handling.
- **Claude Desktop integration** — Live-tested with Sonnet 4.6. Full conversational flow. No OWS internals ever exposed to the user.
- **Custom OWS policy executable** — `allowance-policy.py` handles all roles with ERC-20 calldata decoding, spend cap enforcement, and recipient allowlists
- **Human-readable invite codes** — `MAYA-GIFT-7X2K`. Phone-speakable, 48h expiry, single-use. Deferred OWS key creation on acceptance.
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
| `verify-achievement` | Log and evaluate a child's achievement (source tracking) | Manager, Co-parent, Learner | Free |
| `distribute-allowance` | Send earned USDC to child + savings wallets | Manager | $0.01 |
| `check-progress` | Weekly status, streaks, category breakdown with source | All | Free |
| `check-savings` | Savings vault balances, lock dates, projections | Manager, Co-parent, Learner | Free |
| `invite-member` | Generate a human-readable invite code | Manager | $0.003 |
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

Restart Claude Desktop. You'll see 12 tools available.

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
      "args": ["-y", "mcp-remote", "https://allowanceagent.app/mcp"]
    }
  }
}
```

Then tells Claude: *"I have a code: MAYA-LEARN-8K3W"*

**Path C: Parent texts join instructions via Claude**
Best for any age. Parent says *"Text Maya her invite"* and Claude sends via `message_compose`:

> Your Garcia family set up your allowance! Connect your Claude to: https://allowanceagent.app — then tell Claude: MAYA-LEARN-8K3W

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
      "args": ["-y", "mcp-remote", "https://allowanceagent.app/mcp"]
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
- `GET /health` — Health check

### Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `MASTER_KEY` | Optional | 256-bit hex key for encrypting per-family wallet keys. Auto-generated to `data/.master-key` if not set. Set this in Railway/Docker where filesystem is ephemeral. |
| `OWS_PASSPHRASE` | Deprecated | Legacy passphrase for existing families set up before Sprint 2.75. Still works as fallback. New families use per-family keys from MASTER_KEY. |
| `ALLOWANCE_AGENT_URL` | For HTTP | Public URL of the server (e.g. `https://allowanceagent.app`) |
| `FITBIT_CLIENT_ID` | For Fitbit | AllowMe LLC Fitbit developer app client ID |
| `FITBIT_CLIENT_SECRET` | For Fitbit | AllowMe LLC Fitbit developer app secret |
| `X402_RECIPIENT_WALLET` | For x402 | Wallet address that receives x402 micropayments |
| `X402_NETWORK` | For x402 | Network for payments (default: `eip155:8453` Base) |
| `ANTHROPIC_API_KEY` | For HTTP | Required for the ToolLoopAgent in A2A mode |

## Project Structure

```
src/                         Core business logic (stdio transport)
  index.ts                   MCP server entry point (12 tools registered)
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
  tools/                     12 MCP tool handlers
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

### Sprint 3 (Next)
- [ ] **Roblox Robux redemption** — children can convert USDC earnings to Robux
- [ ] **OpenMAIC integration** — Claude orchestrates verified classroom achievements
- [ ] **LegacyLink estate vault** — dead-man's-switch + conditional release
- [ ] **GiftFlow** — streak bonuses trigger automated gift purchases

## License

MIT
