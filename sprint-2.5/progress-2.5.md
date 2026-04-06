# AllowanceAgent — progress.md (Sprint 2.5)

## Sprint History

### Sprint 1: COMPLETE — Score: 88/100
- 9 MCP tools, 84 tests, live on-chain USDC transfers on Base Sepolia
- Four-role RBAC, human-readable invite codes, custom OWS policy executable
- Five documented bugs carried forward to Sprint 2

### Sprint 2: COMPLETE — Score: 73.3% → PASS (after remediation)
- Learner role (5th role) with child-scoped data access
- HTTP transport (dual: stdio + HTTP) with A2A adapter
- x402 micropayment gating (intentional pricing override: learner tools free, manager power tools paid)
- Fitbit OAuth flow (server-side, one-tap parent connect, encrypted token storage)
- Source tagging on achievements (manual, openMAIC, fitbit, apple-health, self-report, parent-attested)
- Savings release tool, category % validation, actor audit fix, ERC-20 policy fix, passphrase security
- 135 tests passing at Sprint 2 submission
- Remediation: +16 tests (5 invite delivery + 11 HTTP transport), README sections (child connection paths, OpenMAIC orchestration, MoonPay peer MCP)
- **Total tests after remediation: 151**

### Sprint 2 Design Decisions Carried Forward
- x402 pricing: learner-accessible tools free, manager power tools paid (intentional override of original contract)
- ISO5: learner blocked from cross-child verify (stricter than planned — security improvement)
- Landing page deferred to deployment (needs live public URL)

---

## Sprint 2.5: Savings Vault Diversification (USDC → PAXG)

### Approach Taken
Single new MCP tool (`convert-savings`) that records Claude-orchestrated MoonPay swap results into the savings ledger. Schema extended with `asset` field for multi-asset tracking. No MoonPay code dependency. Claude is the coordinator, AllowanceAgent is the ledger, MoonPay is the execution engine.

### Steps
- [x] S1: Schema — added `asset` (enum USDC|PAXG, default USDC), `converted` (bool), `convertedFrom`, `conversionTxHash`, `priceAtConversion`, `receivedAmount` to SavingsEntry. Added `SavingsEntryInput` type for callers.
- [x] S2: Schema — added `savings-converted` to AuditEntry actions enum
- [x] S3: MCP tool — `convert-savings` (Manager only, FIFO USDC consumption with partial entry split, PAXG entry creation, audit logging, position summary)
- [x] S4: Updated `check-savings` — filters converted entries, groups by asset, PAXG position shows oz + value at conversion + educational note
- [x] S5: Updated `release-savings` — splits USDC vs PAXG, USDC releases with multiplier + transfer, PAXG marks released + returns orchestration message
- [x] S6: Registered `convert-savings` in index.ts + added to Manager RBAC in constants.ts
- [x] S7: README — full savings diversification guide with orchestration flow diagram, multi-asset display docs, design decisions
- [x] S8: Unit tests G1-G8 (8 tests) — all passing
- [x] S9: E2E test E1-E6 (6 tests) — all passing

### Current Blocker
None.

### Test Results
- **165 tests passing** (151 existing + 14 new Sprint 2.5 tests)
- All existing tests pass unchanged (backward compatible)
- One test updated: H2 tool count 11→12 (expected, not a regression)

### Failed Approaches
_Sprint 1 failed approaches (carried forward):_
- OWS `signAndSend` → nonce mismanagement → replaced with viem walletClient
- OWS `signTransaction` + manual broadcast → signature parsing → replaced with viem
- `process.cwd()` for dataDir → fails in Claude Desktop → fixed with `import.meta.url`
- MCP SDK global RBAC intercept → not supported → per-tool guard pattern

_Sprint 2 failed approaches:_
- None documented by Generator