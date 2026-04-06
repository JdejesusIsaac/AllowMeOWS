# AllowanceAgent — progress.md (Sprint 2.75)

## Sprint History

### Sprint 1: COMPLETE — Score: 88/100
9 MCP tools, 84 tests, live on-chain USDC, four-role RBAC, invite codes, custom OWS policy.

### Sprint 2: COMPLETE — Score: 73.3% → PASS (after remediation)
Learner role, HTTP transport, x402, Fitbit OAuth, source tagging, 5 bug fixes.
135 tests + 16 remediation = **151 tests.**

### Sprint 2.5: COMPLETE — Score: 91.3/100
convert-savings (USDC→PAXG), multi-asset savings display, 14 new tests.
**165 tests total.**

### Sprint 2 Design Decisions Carried Forward
- x402 pricing: learner tools free, manager power tools paid
- ISO5: learner blocked from cross-child verify (security improvement)
- Landing page deferred to deployment

---

## Sprint 2.75: Server-Managed Per-Family Keys

### Approach Taken
Replace single `OWS_PASSPHRASE` with `MASTER_KEY` + auto-generated per-family encryption keys. Zero passphrase prompts in any user-facing flow. Operator sets one key in Railway env vars. AllowanceAgent handles everything else.

### Steps
- [x] K1: Create `src/keys/family-keys.ts` — FamilyKeyManager (generate, encrypt, store, retrieve)
- [x] K2: Create `src/keys/master-key.ts` — `resolveMasterKey()` auto-resolves from env var → file → auto-generate
- [x] K3: Update `configure-policy` — auto-generate family key on first setup (both src/ and app/)
- [x] K4: Update `distribute-allowance` — auto-resolve family key (both src/ and app/)
- [x] K5: Update `release-savings` — auto-resolve family key (both src/ and app/)
- [x] K6: Update `WalletSetup` + `WalletDistributor` — already accept passphrase as parameter (no change needed)
- [x] K7: Update Fitbit token encryption — uses MASTER_KEY Buffer instead of OWS_PASSPHRASE string
- [x] K8: Remove ALL passphrase/secret phrase references from user-facing code (6 files updated)
- [x] K9: Startup — resolveMasterKey() called in both src/index.ts and app/server.ts; fatal exit on failure
- [x] K10: Update README — MASTER_KEY env var docs, security architecture, project structure, Sprint 2.75 roadmap
- [x] K11: Unit tests — 12 tests (FK1-FK8, FK10-FK11 + helpers) all passing
- [x] K12: E2E + integration tests — 10 tests (E1-E6, TI4-TI6, FK9) all passing
- [x] K13: Backward compat — OWS_PASSPHRASE fallback in distribute-allowance and release-savings (both transports)

### Test Results
- **22 new tests** (12 unit + 10 E2E/integration)
- **187 total tests passing** (165 carried + 22 new)
- All existing Sprint 2.5 tests still pass

### Current Blocker
None — sprint complete.

### Failed Approaches
_Carried forward from prior sprints:_
- OWS `signAndSend` → nonce mismanagement → replaced with viem walletClient
- OWS `signTransaction` + manual broadcast → signature parsing → replaced with viem
- `process.cwd()` for dataDir → fails in Claude Desktop → fixed with `import.meta.url`
- MCP SDK global RBAC intercept → not supported → per-tool guard pattern
- Single `OWS_PASSPHRASE` for all families → UX blocker (Claude prompts for passphrase) → replacing with per-family keys