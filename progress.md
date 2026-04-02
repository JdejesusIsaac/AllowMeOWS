# AllowanceAgent — progress.md

## Current Sprint: Sprint 1 (MVP)

## Completed Steps

### Step 1: Project Scaffold ✅
- TypeScript + ESM project with `package.json`, `tsconfig.json`
- Dependencies installed: `@modelcontextprotocol/sdk`, `@open-wallet-standard/core`, `viem`, `zod`
- Dev deps: `typescript`, `tsx`, `vitest`, `@types/node`
- Entry point: `src/index.ts` — MCP server with stdio transport, registers all 8 tools
- Directory structure: `src/tools/`, `src/engine/`, `src/wallet/`, `src/roles/`, `src/invites/`, `policies/`
- `tsc --noEmit` passes with zero errors

### Step 2: OWS Wallet Setup + Policy Bundles ✅
- `src/wallet/setup.ts` — `WalletSetup.initializeFamily()` creates treasury, child-*, savings-vault, gift-fund wallets
- Creates 4 policy bundle JSON files: allowance-full-access, approve-and-read-only, gift-contribute-only, audit-read-only
- Creates initial Manager API key scoped to all wallets with full-access policy
- All operations logged to audit-log.json
- `policies/allowance-policy.py` — Role-aware custom executable policy (manager, co-parent, family, advisor)
  - Decodes ERC-20 calldata for USDC spend cap enforcement
  - Default-deny for unknown roles

### Also Completed (Ahead of Plan)
- **Step 4 (Schemas)**: `src/schemas.ts` — Full Zod schemas for all data types
- **Step 5 (State Manager)**: `src/engine/state.ts` — Atomic JSON read/write with temp+rename, all CRUD ops
- **Step 6 (Role Manager)**: `src/roles/manager.ts` — OWS API key CRUD, role→policy mapping, revoke-and-recreate
- **Step 7 (Invite System)**: `src/invites/system.ts` — Human-readable codes, 48h expiry, single-use validation
- **Step 8 (Policy Engine)**: `src/engine/policy.ts` — Achievement evaluation, savings split, streak multiplier, budget checks
- **Step 9 (Wallet Distributor)**: `src/wallet/distributor.ts` — ERC-20 transfer via viem + OWS signAndSend
- **Step 3 (Policy Executable)**: `policies/allowance-policy.py` — All 4 roles, ERC-20 calldata decoding
- **All 8 MCP Tools**: configure-policy, verify-achievement, distribute-allowance, check-progress, check-savings, invite-member, accept-invite, manage-members
- **Constants**: `src/constants.ts` — Chain IDs, USDC addresses, role definitions, policy IDs, tool access maps

### Step 18: Role-Based Access Control Middleware ✅
- `src/middleware/access-control.ts` — RBAC middleware with:
  - `resolveCallerRole()`: resolves from `_callerRole`/`_callerId` args or member lookup, defaults to manager for stdio
  - `isToolAuthorized()`: checks role against `ROLE_TOOL_ACCESS` map
  - `buildAccessDeniedResponse()`: structured JSON error with role/tool info
  - `rbacFields`: shared zod schema fields for `_callerRole`/`_callerId`
- All 8 MCP tools updated with RBAC guard at handler entry
- `tsc --noEmit` clean after fixing `ToolResponse` index signature for MCP SDK compat

### Step 19: Unit Tests ✅ (71 tests)
- `tests/policy-engine.test.ts` — 20 tests: achievement eval, savings split, streak multiplier, budget checks
- `tests/invite-system.test.ts` — 14 tests: code generation, invite creation, validation (expiry, used, normalization)
- `tests/access-control.test.ts` — 22 tests: role→tool authorization matrix, caller resolution, denied response, arg stripping
- `tests/state-manager.test.ts` — 15 tests: CRUD for config, achievements, members, invites, streaks, savings, audit

### Step 20: E2E Test ✅ (13 tests)
- `tests/e2e-flow.test.ts` — Full sequential flow:
  1. Manager configures family policy (2 children)
  2. Manager invites co-parent
  3. Co-parent accepts invite
  4. Co-parent verifies Maya's achievement ($4.25 education)
  5. Manager distributes allowance (dry-run, 20% savings split)
  6. Check progress shows correct data
  7. Check savings vault (locked, not expired)
  8-10. RBAC denials: family→configure, co-parent→distribute, advisor→all
  11. Audit log integrity (5 expected actions)
  12. Budget enforcement (over-spend denied, within-budget allowed)
  13. Used invite code rejected

### Post-Evaluation Fixes ✅
- **`get-funding-address` tool**: New manager-only tool (9th tool) — surfaces treasury + child wallet EVM addresses for funding. Added to `ROLE_TOOL_ACCESS`, registered in `index.ts`.
- **`dataDir` resolution bug**: `StateManager` used `process.cwd()` which resolves to `/` when Claude Desktop launches the process. Fixed to use `import.meta.url` → project root. This was blocking live Claude Desktop usage.
- **README.md**: Full project README with architecture, all 9 tools, Claude Desktop setup, role system, invite codes, wallet architecture, dev commands, and roadmap.

### Claude Desktop Live Test ✅ (Apr 2, 2026)
- Connected MCP server to Claude Desktop via stdio transport
- Confirmed `configure-policy` works: "Set up my family. Maya gets $0.10 per week." → success
- Confirmed wallet creation with passphrase: OWS wallets created on Base Sepolia testnet
- Confirmed `get-funding-address`: returned real EVM addresses (treasury + child-maya)
- Confirmed `distribute-allowance`: correctly reported "no pending achievements" (need verify-achievement first)
- All 9 tools visible and callable in Claude Desktop

### Evaluation Report ✅ (Score: 88/100)
- Functionality: 27/30, Auth/Security: 26/30, Design/UX: 22/25, Originality: 13/15
- All 10 Success Criteria met
- 5 non-blocking bugs documented in `test.md` for Sprint 2

## Sprint 2: Distribution Fixes + External Wallets

### Distribution Engine Rewrite ✅ (Apr 2, 2026)
- **Replaced OWS signAndSend with viem walletClient** — OWS docs confirm: "Current implementations do not provide a per-wallet nonce manager. Callers must handle it at a higher level." viem's walletClient is that higher level.
- `WalletDistributor.transferUSDC()` now:
  1. Decrypts private key from OWS vault via `exportWallet(wallet, passphrase)`
  2. Creates viem account (`privateKeyToAccount` or `mnemonicToAccount`)
  3. Sends via `walletClient.sendTransaction()` — viem handles nonce, gas estimation, EIP-1559
  4. Waits for on-chain confirmation via `waitForTransactionReceipt()`
- Removed all manual nonce tracking, gas bumping, and `serializeTransaction` logic

### External Wallet Support ✅
- Added optional `walletAddress` field to `ChildConfigSchema`
- `configure-policy` accepts per-child `walletAddress` — if provided, skips OWS wallet creation
- `WalletSetup.initializeFamily()` skips `createWallet()` for children with external addresses
- `WalletDistributor.transferUSDC()` accepts optional `toAddress` param — sends directly to raw EVM address
- `distribute-allowance` passes `childConfig.walletAddress` through to distributor
- Added `"external-wallet-registered"` to `AuditEntrySchema` action enum

### Partial Success Handling ✅
- Savings transfer wrapped in its own try/catch — child transfer success is never hidden by savings failure
- `savingsError` field propagated through results so Claude reports partial success accurately
- Achievements marked as distributed even if savings transfer fails (child got paid)

### On-Chain Test Results ✅ (Base Sepolia)
- **Maya (OWS wallet):** 0.03264 USDC transferred successfully — tx `0x043e45da...`
- **Elina (external wallet `0x5C47...63Ea`):** 0.02 USDC transferred successfully — tx `0xed4a14de...`
- Both used EIP-1559 with automatic gas estimation
- Savings transfers failed due to insufficient treasury ETH for second gas fee (partial success reported correctly)

### Files Changed
- `src/wallet/distributor.ts` — Full rewrite: exportWallet + viem walletClient, external address support
- `src/tools/distribute-allowance.ts` — Partial success handling, external wallet passthrough
- `src/tools/configure-policy.ts` — walletAddress param per child
- `src/wallet/setup.ts` — Skip OWS wallet creation for external addresses
- `src/schemas.ts` — walletAddress field, external-wallet-registered audit action
- `src/constants.ts` — RPC URLs for Base mainnet and Sepolia

## Remaining Steps
| Step | Task | Status |
|------|------|--------|
| 10 | x402 gating middleware | Deferred (requires HTTP transport) |
| — | Fix hardcoded `actor: "manager"` in verify/distribute | Pending |
| — | Category budget % validation (sum ≤ 100) | Pending |
| — | Savings release tool | Pending |
| — | Batch distributions (multiple children, sequential nonces) | Pending |

## Failed Approaches
- Attempted to wrap MCP SDK `server.server.setRequestHandler()` for global RBAC intercept — SDK internal API doesn't support it cleanly (missing index signature, handler type mismatch). Switched to per-tool RBAC guard pattern.
- `StateManager` using `process.cwd()` for `dataDir` — fails when Claude Desktop launches process without `cwd`. Fixed with `import.meta.url`.
- **OWS `signAndSend` for distributions** — caused persistent "replacement transaction underpriced" errors. OWS does not manage nonces internally. Replaced with viem walletClient.
- **OWS `signTransaction` + manual broadcast** — intermediate approach that still had signature parsing issues (r/s/v extraction from OWS SignResult). Replaced with full viem approach using `exportWallet`.
- **Aggressive gas fee bumping (10x baseFee, 2 gwei priority)** — did not fix stuck transactions because the root cause was OWS nonce mismanagement, not gas pricing.

## Notes
- All lint errors pre-install were expected (missing node_modules). Post-install `tsc --noEmit` is clean.
- x402 deferred per research.md recommendation — MVP uses stdio (free), Sprint 2 adds HTTP + x402.
- Policy executable decodes ERC-20 calldata to extract USDC amounts (addresses research spike #1).
- vitest configured with `fileParallelism: false` to prevent data dir race conditions between test suites.
- Total: 84 tests (71 unit + 13 E2E), all passing.
- Claude Desktop config requires absolute paths (no `cwd` support in some versions). Use full `npx` path + absolute `src/index.ts`.
- Live-tested on Claude Desktop with Sonnet 4.6 — full conversational flow works end-to-end.
- GitHub repo: https://github.com/JdejesusIsaac/AllowMeOWS
