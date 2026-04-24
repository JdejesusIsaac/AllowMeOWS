# Phase 0b — Technical Research: AllowanceAgent

## Relevance Summary

AllowanceAgent is an OWS-native MCP server where Claude is the sole interface for family allowance management. The parent never touches OWS directly. This research validates the technical feasibility of the MVP stack: **OWS Node.js SDK** for wallet/policy/key operations, **MCP TypeScript SDK** for the tool server, **x402** for micropayment gating, and **USDC on Base** for distribution.

**Core finding:** All four pillars are confirmed viable. OWS v1.2.0 provides every primitive needed — programmatic wallet creation, API key creation with policy attachment, custom executable policies with `policy_config` injection, and token-based revocation. The x402-mcp package from Vercel wraps the MCP SDK with `paidTool()` declarations requiring ~5 lines of integration per tool. No blockers identified for MVP.

---

## 1. OWS — Core Infrastructure

### Relevance to Problem
OWS replaces centralized wallet APIs (Coinbase AgentKit) with local key custody + policy-gated signing. AllowanceAgent's value proposition — policy-enforced distribution without exposing keys to the agent — depends entirely on OWS.

### Key Findings

**Package:** `@open-wallet-standard/core` (npm). Prebuilt native binaries for macOS + Linux via Rust FFI. No toolchain required.

**Architecture flow:**
```
Agent calls sign() → Policy Engine evaluates (AND semantics) → Key decrypted in hardened memory → Transaction signed → Key wiped → Signature returned
```
The OWS API **never returns raw private keys**. Agent mode always enforces policies before decryption.

**Wallet creation** — `createWallet(name, passphrase?, words?, vaultPath?)` → derives addresses for EVM, Solana, Bitcoin, Cosmos, Tron, TON, Sui, Filecoin from one mnemonic. Returns `WalletInfo { id, name, accounts[], createdAt }`.

**API key creation** — `createApiKey(name, walletIds[], policyIds[], passphrase, expiresAt?, vaultPath?)` → returns `{ token, id, name }`. Token shown once. Token = authentication + decryption capability (HKDF-SHA256). Revocation = `revokeApiKey(id)` — deletes key file, token decrypts nothing.

**Policy creation** — `createPolicy(policyJson, vaultPath?)`. Policies stored as JSON in `~/.ows/policies/`. Attached to API keys, not wallets. AND semantics: all attached policies must allow.

**Policy file format:**
```json
{
  "id": "string",
  "name": "string", 
  "version": 1,
  "rules": [{ "type": "allowed_chains", "chain_ids": ["eip155:8453"] }],
  "executable": "/absolute/path/to/policy.py",
  "config": { "role": "manager", "max_weekly": 50000000 },
  "action": "deny"
}
```
- `config` object is injected into `PolicyContext` as `policy_config` when executable runs
- Declarative rules evaluate first (in-process, fast); executable only runs if rules pass
- Custom executable: receives `PolicyContext` JSON on stdin, writes `PolicyResult` JSON to stdout
- Default-deny on all failures (non-zero exit, invalid JSON, timeout >5s, not found)

**PolicyContext fields:** `chain_id`, `wallet_id`, `api_key_id`, `transaction { to, value, raw_hex, data }`, `spending { daily_total, date }`, `timestamp`, `policy_config` (when config is set)

**Credential semantics:**
| Caller | Auth | Policy |
|--------|------|--------|
| Owner | Passphrase | None — full access |
| Agent | `ows_key_...` token | All attached policies enforced |

**Signing functions:**
- `signTransaction(wallet, chain, txHex, passphrase?, index?, vaultPath?)` → `SignResult`
- `signAndSend(wallet, chain, txHex, passphrase?, index?, rpcUrl?, vaultPath?)` → `SendResult { txHash }`
- `signMessage(wallet, chain, message, passphrase?, encoding?, index?, vaultPath?)` → `SignResult`

**Key operations for AllowanceAgent MVP:**
1. `createWallet("treasury")` — parent's treasury
2. `createWallet("child-maya")` — child sub-wallet
3. `createWallet("savings-vault")` — savings
4. `createPolicy(managerPolicyJson)` — role-based policy
5. `createApiKey("allowance-agent", ["treasury", "child-maya"], ["allowance-full-access"], passphrase)` — agent key
6. `revokeApiKey(id)` — instant revocation on role removal

### Actionable Insights
- **Use wallet names as identifiers** — `createWallet("treasury")` then reference by name everywhere. UUIDs are internal.
- **One passphrase per setup** — Parent enters passphrase once during `configure-policy`. Agent stores it nowhere; it's only needed for `createApiKey` and `createWallet` calls during initial setup and member management.
- **Custom vault path** — All SDK functions accept optional `vaultPath`. Could use project-local vault for testing: `./data/ows-vault/`.
- **signAndSend with built-in RPC** — OWS resolves RPC from built-in defaults for Base chain. No need to configure Infura/Alchemy for MVP.

---

## 2. MCP Server Architecture

### Relevance to Problem
AllowanceAgent IS an MCP server. Claude connects to it via stdio transport. Every family interaction flows through MCP tool calls.

### Key Findings

**Package:** `@modelcontextprotocol/sdk` (npm). Official TypeScript SDK.

**Server pattern (stdio transport — correct for Claude Desktop / local agent):**
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "allowance-agent", version: "1.0.0" });

server.tool("verify-achievement", { 
  childName: z.string(), 
  category: z.enum(["education", "health", "personal"]),
  description: z.string(),
  score: z.number().min(0).max(100) 
}, async (args) => {
  // ... tool implementation
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Transport choice:** stdio for MVP. Claude spawns the server as a child process. No HTTP/auth complexity. x402 gating layered on top for Streamable HTTP transport in V2.

**Tool registration:** `server.tool(name, zodSchema, handler)`. Zod schemas provide automatic validation + type safety.

### Actionable Insights
- **stdio first, HTTP later** — MVP uses stdio transport. x402 requires HTTP transport (Streamable HTTP). Phase into x402 when moving to remote/multi-user.
- **Tool naming convention** — kebab-case: `verify-achievement`, `distribute-allowance`, `check-progress`, `configure-policy`, `invite-member`, `accept-invite`, `manage-members`, `check-savings`, `contribute-gift`, `query-audit-log`.
- **Return format** — All tools return `{ content: [{ type: "text", text: string }] }`. Claude parses the text.

---

## 3. x402 Micropayment Integration

### Relevance to Problem
x402 is the revenue mechanism for MVP (Model 2). Each tool call has a USDC price. Zero infrastructure cost.

### Key Findings

**Protocol flow:**
1. Client requests resource
2. Server responds HTTP 402 + `PAYMENT-REQUIRED` header with payment instructions
3. Client signs payment (USDC on Base via EIP-3009), attaches `PAYMENT-SIGNATURE` header
4. Server verifies via facilitator, delivers response

**Package:** `x402-mcp` (npm, by Vercel). Light wrapper around `mcp-handler`.

**Server integration:**
```typescript
import { createPaidMcpHandler } from "x402-mcp";
import z from "zod";

const handler = createPaidMcpHandler(
  (server) => {
    server.paidTool("verify-achievement", { price: 0.02 },
      { childName: z.string(), score: z.number() },
      async (args) => { /* ... */ }
    );
  },
  { recipient: process.env.WALLET_ADDRESS }
);
```

**Client integration:**
```typescript
import { withPayment } from "x402-mcp";
const mcpClient = await createMCPClient({ transport })
  .then(client => withPayment(client, { account }));
```

**Facilitator:** Coinbase CDP provides free tier (1,000 tx/month, then $0.001/tx). Handles settlement verification. Multi-chain: Base, Polygon, Solana.

**Settlement:** ~100-200ms on Base. Fees under $0.01 per transaction.

### Actionable Insights
- **x402-mcp requires Streamable HTTP transport** — NOT compatible with stdio. MVP must choose: (A) stdio for simplicity + defer x402, or (B) HTTP transport from day one for x402 revenue.
- **Recommendation: MVP = stdio (free), V1.1 = add HTTP + x402.** The MVP proves the product thesis. Revenue gating adds complexity that can wait 1-2 sprints.
- **If x402 from day one:** Use `createPaidMcpHandler` from `x402-mcp`, deploy as HTTP server (Express/Next.js/standalone), agent connects via Streamable HTTP.
- **USDC on Base (mainnet):** Contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Base Sepolia for testnet.
- **Recipient wallet** — The AllowanceAgent operator wallet (separate from family wallets). Set via `WALLET_ADDRESS` env var.

---

## 4. USDC Distribution on Base

### Relevance to Problem
AllowanceAgent distributes USDC from treasury to child wallets. OWS signs EVM transactions. Need to construct proper ERC-20 transfer calldata.

### Key Findings

**USDC on Base:**
- Mainnet: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Base Sepolia (testnet): standard test USDC faucet
- 6 decimals (1 USDC = 1,000,000 units)
- Supports EIP-3009 (`transferWithAuthorization`) + standard ERC-20 `transfer(address,uint256)`

**Transaction construction (using viem or ethers):**
```typescript
import { encodeFunctionData } from "viem";

const transferData = encodeFunctionData({
  abi: erc20Abi,
  functionName: "transfer",
  args: [childWalletAddress, BigInt(amount)] // amount in 6-decimal units
});

// Build raw tx hex
const txHex = serializeTransaction({
  to: USDC_BASE_ADDRESS,
  data: transferData,
  chainId: 8453, // Base mainnet
  // ... gas params
});

// Sign via OWS
const result = signAndSend("treasury", "evm", txHex, undefined, undefined, rpcUrl);
```

**Chain IDs (CAIP-2):**
- Base mainnet: `eip155:8453`
- Base Sepolia: `eip155:84532`

### Actionable Insights
- **Use `viem` for tx construction** — lighter than ethers, tree-shakeable, native BigInt. OWS handles signing/sending.
- **Gas estimation** — Need RPC call to estimate gas before constructing tx. OWS `signAndSend` handles broadcast but tx must be pre-built with gas params.
- **Amount format** — Store all USDC amounts as integers in 6-decimal units (1 USDC = 1000000). Display as human-readable in tool responses.
- **Policy enforcement** — The custom policy executable validates `transaction.to` matches authorized wallets and `transaction.value` + `spending.daily_total` stays under weekly cap. But for ERC-20 transfers, the `value` field is 0 (ETH value) — the actual USDC amount is in `transaction.data`. Policy executable must decode ERC-20 calldata to extract transfer amount.

---

## 5. Role Model → OWS Mapping

### Relevance to Problem
The four plain-language roles (Manager, Co-parent, Family, Advisor) must map cleanly to OWS API key + policy bundles. This is the critical consumer abstraction.

### Key Findings (Validated Against OWS Spec)

**Role → OWS mapping confirmed viable:**

| Role | Wallets (walletIds) | Policy | Signing? |
|------|---------------------|--------|----------|
| Manager | treasury, child-*, savings-vault | allowance-full-access | Yes — capped |
| Co-parent | treasury (read), child-* (read) | approve-and-read-only | No |
| Family | gift-fund | gift-contribute-only | Yes — gift only |
| Advisor | estate-vault (read) | audit-read-only | No |

**Implementation via SDK:**
```typescript
// Manager setup
createPolicy(JSON.stringify(managerPolicy));
const key = createApiKey("parent-manager", 
  ["treasury", "child-maya", "savings-vault"],
  ["allowance-full-access"], 
  ownerPassphrase
);

// Family member invite acceptance
createPolicy(JSON.stringify(familyPolicy));
const key = createApiKey("grandma-family",
  ["gift-fund"],
  ["gift-contribute-only"],
  ownerPassphrase
);
```

**Critical note:** `createApiKey` requires the owner passphrase. This means the AllowanceAgent must have access to the passphrase during invite acceptance. Options:
1. Store passphrase encrypted in agent config (MVP — acceptable for local-only)
2. Prompt parent for passphrase during each invite acceptance (secure but high friction)
3. Pre-create API keys at invite time, not acceptance time (changes flow)

**Recommendation:** Option 1 for MVP. The passphrase is stored in a local config file readable only by the agent process. Since OWS is local-only and the agent runs on the parent's machine, this is acceptable security for MVP.

### Actionable Insights
- **ERC-20 calldata decoding in policy** — The policy executable must parse `transaction.data` to extract the ERC-20 `transfer(to, amount)` call. The `transaction.value` field will be `"0"` for token transfers. This is a **must-implement** for accurate spend tracking.
- **Wallet naming convention** — Use descriptive names: `treasury`, `child-{name}`, `savings-vault`, `gift-fund`, `estate-vault`. OWS SDK accepts names as wallet identifiers.
- **Multiple policies per key** — AND semantics. Can stack `allowed-chains` + role-specific policy on each key for defense-in-depth.

---

## 6. Data Persistence (App Layer)

### Relevance to Problem
AllowanceAgent needs app-layer state beyond OWS: achievements, streaks, invites, family config. OWS handles wallet/key/policy state.

### Key Findings

**Recommended: JSON file store for MVP.** Matches the local-first OWS model. No database dependency.

```
data/
  family-config.json    — family name, children, role assignments
  achievements.json     — verified achievements with timestamps
  streaks.json          — streak counters, multipliers
  invites.json          — pending/used invite codes
  audit-log.json        — append-only log of all financial operations
  savings-goals.json    — per-child savings targets and progress
```

**Why not SQLite/Supabase for MVP:**
- Local-only deployment (Claude spawns via stdio)
- JSON files match OWS's own storage model (`~/.ows/`)
- Zero dependencies
- Easy to inspect/debug
- V2 migration to Supabase when adding multi-device/web dashboard

### Actionable Insights
- **Atomic writes** — Use write-to-temp + rename pattern for crash safety.
- **Audit log** — Append-only, never mutated. Every `distribute-allowance` and `contribute-gift` call appends an entry with timestamp, actor, amount, recipient, tx hash.
- **File locking** — Not needed for MVP (single agent process). Add if going multi-process in V2.

---

## Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| 1 | OWS custom policy reads `role` from `policy_config`? | ✅ Resolved | Spec confirms: `config` object injected as `policy_config` into PolicyContext for executables |
| 2 | OWS Node.js SDK supports programmatic wallet + key + policy creation? | ✅ Resolved | Full API: `createWallet`, `createApiKey`, `createPolicy`, `revokeApiKey`, `deletePolicy` |
| 3 | x402-mcp compatible with stdio transport? | ✅ Resolved | **No.** x402-mcp requires Streamable HTTP. MVP uses stdio (free); add x402 in V1.1 |
| 4 | ERC-20 transfer amount in `PolicyContext.transaction`? | ⚠️ Needs spike | `transaction.value` = ETH value (0 for token transfers). USDC amount is in `transaction.data`. Policy must decode ERC-20 calldata. Need to verify OWS parses `data` field for EVM transactions. |
| 5 | OWS `signAndSend` gas estimation for Base? | ⚠️ Needs spike | Does OWS handle gas estimation + nonce management internally, or must the agent pre-build a complete tx with gas params? |
| 6 | Passphrase storage for invite acceptance? | ✅ Resolved | MVP: encrypted local config file. Acceptable for single-machine deployment. |
| 7 | OWS spending tracker scope? | ⚠️ Low risk | `spending.daily_total` — does this track ERC-20 value or ETH value? If ETH-only, policy must maintain its own USDC spend tracker. |

---

## Key Code References

| Component | Package | Import |
|-----------|---------|--------|
| OWS SDK | `@open-wallet-standard/core` | `import { createWallet, createApiKey, createPolicy, signAndSend, revokeApiKey } from "@open-wallet-standard/core"` |
| MCP Server | `@modelcontextprotocol/sdk` | `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"` |
| MCP Transport (stdio) | `@modelcontextprotocol/sdk` | `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"` |
| x402 MCP (V1.1) | `x402-mcp` | `import { createPaidMcpHandler } from "x402-mcp"` |
| Tx construction | `viem` | `import { encodeFunctionData, serializeTransaction } from "viem"` |
| Schema validation | `zod` | `import { z } from "zod"` |
| USDC Base mainnet | — | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals) |
| Base chain ID (CAIP-2) | — | `eip155:8453` (mainnet), `eip155:84532` (Sepolia) |

---

## Spike Results

### Spike 0.5: OWS Policy + Role Config (from Phase 0a)
**Question:** Can OWS create a wallet, create an API key with a custom executable policy that reads role-based config from `policy_config`, and correctly deny when role lacks authority?

**Result: GO** — OWS v1.2.0 injects `policy_config` into PolicyContext. Custom executable receives full context including `role` field. Deny path returns `POLICY_DENIED` without touching key material. Programmatic API key creation via SDK confirmed.

### Spike Candidates (Pre-Planning)

**Spike 1: ERC-20 calldata in PolicyContext** (Open Question #4)
- Write a test policy that receives a USDC `transfer()` tx and decodes `transaction.data` to extract recipient + amount
- Verify `transaction.data` is populated for EVM ERC-20 calls
- If not populated: policy must accept raw_hex and decode manually
- **Time box:** 30 min

**Spike 2: OWS gas handling for signAndSend** (Open Question #5)
- Call `signAndSend` with a minimal Base Sepolia tx
- Determine if OWS estimates gas + manages nonce, or if agent must provide complete tx
- If agent must provide: add `viem` gas estimation to distribution flow
- **Time box:** 30 min

---

## MVP Dependency Summary

```
@open-wallet-standard/core   — wallet, key, policy, signing
@modelcontextprotocol/sdk     — MCP server (stdio)
viem                          — EVM tx construction, ABI encoding
zod                           — tool schema validation
```

**Dev dependencies:** `typescript`, `tsx` (for running TS directly), `vitest` (testing)

**No x402 dependency in Sprint 1.** Add `x402-mcp` + `x402-next` in Sprint 2 when migrating to HTTP transport.
