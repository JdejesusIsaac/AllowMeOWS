# AllowanceAgent

An [Open Wallet Standard](https://github.com/open-wallet-standard) (OWS) native MCP server that lets parents manage children's allowances entirely through conversation with Claude. No dashboards, no apps — just talk.

## What it does

Parents configure rules in plain English. Claude handles the rest: wallet creation, achievement tracking, USDC distribution, savings vaults, and family member access — all invisible to the user.

**Example:**

> "Set up Maya with $15/week. Split it evenly across education, health, and personal. Put 20% into savings."

> "Maya finished her science project — 90 out of 100."

> "Distribute what Maya has earned." → USDC sent on-chain

> "Invite Grandma Rosa so she can see Maya's progress."

Children can use **OWS-managed wallets** (created automatically) or **external wallets** (MetaMask, Coinbase, etc.) — the parent chooses per child during setup.

## Architecture

```
Claude Desktop ←stdio→ AllowanceAgent MCP Server ←→ OWS (wallets, policies, signing)
                              ↓
                        data/*.json (local persistence)
```

- **Claude is the only interface** — no family member ever sees wallet addresses, keys, or JSON
- **OWS handles custody** — wallets, policy-gated signing, API key delegation
- **USDC on Base** — ERC-20 transfers for real-value allowances (testnet or mainnet)
- **Four roles** — Manager, Co-parent, Family, Advisor — enforced at both app and OWS layer

## MCP Tools

| Tool | Description | Roles |
|------|-------------|-------|
| `configure-policy` | Set up allowance rules per child (supports external wallet addresses) | Manager |
| `verify-achievement` | Log and evaluate a child's achievement | Manager, Co-parent |
| `distribute-allowance` | Send earned USDC to child + savings wallets | Manager |
| `check-progress` | Weekly status, streaks, category breakdown | All |
| `check-savings` | Savings vault balances, lock dates, projections | Manager, Co-parent |
| `invite-member` | Generate a human-readable invite code | Manager |
| `accept-invite` | Join the family with an invite code | All |
| `manage-members` | List, change roles, or remove members | Manager |
| `get-funding-address` | Show the treasury wallet address for funding | Manager |

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

Restart Claude Desktop. You'll see 9 tools available.

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

**OWS-managed wallets** are created when you first configure with a passphrase. Children can alternatively use **external wallet addresses** (MetaMask, Coinbase, etc.) — just provide the address during setup and OWS wallet creation is skipped for that child.

Distribution uses OWS for secure key storage (`exportWallet`) and viem for transaction construction, signing, and broadcast — giving full control over nonce management, gas estimation, and EIP-1559 formatting.

## Development

### Type check

```bash
npm run typecheck
```

### Run tests

```bash
npm test
```

84 tests: 71 unit + 13 E2E covering policy engine, invite system, RBAC, state management, and full flow.

### Run locally (stdio)

```bash
npm start
```

## Project Structure

```
src/
  index.ts                 MCP server entry point (9 tools registered)
  constants.ts             Chain IDs, USDC addresses, roles, RBAC matrix
  schemas.ts               Zod schemas for all data types
  middleware/
    access-control.ts      RBAC: role resolution, authorization, denied responses
  engine/
    state.ts               JSON file persistence (atomic writes)
    policy.ts              Achievement evaluation, savings split, streaks
  wallet/
    setup.ts               OWS wallet + policy bundle initialization
    distributor.ts          USDC ERC-20 transfers via viem walletClient
  roles/
    manager.ts             Role → OWS policy mapping, API key CRUD
  invites/
    system.ts              Human-readable invite codes, validation
  tools/                   9 MCP tool handlers
policies/
  allowance-policy.py      OWS custom executable policy (4 roles, ERC-20 decode)
tests/                     Unit + E2E test suites
data/                      JSON file store (gitignored, created automatically)
```

## Tech Stack

- **TypeScript** + **Node.js** (ESM)
- **@modelcontextprotocol/sdk** — MCP server over stdio
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

- [ ] HTTP transport + x402 micropayment gating (Sprint 2)
- [ ] Savings release tool (auto-release on lock expiry)
- [ ] Category budget percentage validation (sum ≤ 100)
- [ ] QR code / deep link invite alternative
- [ ] Batch distributions (multiple children in one call with sequential nonce management)

## License

MIT
