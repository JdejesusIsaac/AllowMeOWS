# Evaluation Report — Sprint 1 (MVP)

**Evaluator Agent** | Graded against Sprint Contract only  
**Build**: `tsc --noEmit` — PASS (0 errors)  
**Tests**: `npx vitest run` — 84/84 PASS (5 files, 976ms)

---

## Success Criteria Verification

### SC-1: configure-policy ✅
- Parent configures via natural language args (`familyName`, `children[]` with `weeklyBudgetUsd`, category percentages, `savingsPercent`)
- OWS wallets + policies created automatically when passphrase provided (`WalletSetup.initializeFamily`)
- No technical steps exposed — tool description is conversational
- Converts USD to 6-decimal USDC units correctly
- Initializes streaks for each child
- **Test coverage**: E2E test #1 exercises full configure flow

### SC-2: verify-achievement ✅
- Evaluates education/health/personal categories via `PolicyEngine.evaluateAchievement`
- RBAC: co-parent CAN verify (in `ROLE_TOOL_ACCESS`); family CANNOT
- Applies streak multiplier correctly
- **Test coverage**: 6 unit tests on evaluateAchievement, E2E test #4 (co-parent verifies)

### SC-3: distribute-allowance ✅
- Splits to child wallet + savings vault via `WalletDistributor.transferUSDC` → OWS `signAndSend`
- ERC-20 calldata built via viem `encodeFunctionData`
- OWS policy blocks unauthorized via `allowance-policy.py` (spend cap, role check)
- Savings entries created with lock period + multiplier at deposit
- Dry-run mode supported
- **Test coverage**: E2E test #5 (dry-run distribution with savings split)

### SC-4: invite-member ✅
- Single conversational turn: name + role → invite code
- Code is human-readable: `{CHILD}-{ROLE_HINT}-{4ALPHANUM}` (e.g., `MAYA-GIFT-7X2K`)
- Phone-speakable: avoids ambiguous chars (0/O/1/I)
- **Test coverage**: 6 unit tests on code generation, E2E test #2

### SC-5: accept-invite ✅
- Single code input → validate → create OWS API key → provision member
- OWS key creation via `RoleManager.createRoleApiKey` — invisible to user
- Marks invite as used, records audit entry
- **Test coverage**: 6 unit tests on validation, E2E test #3

### SC-6: Revocation ✅
- `manage-members` → `action: "remove"` → `revokeApiKey(member.apiKeyId)` → `member.active = false`
- OWS key revoked → token useless → instant
- Audit entry logged with `member-removed` action
- **Test coverage**: Not directly tested in E2E (no revocation E2E test) — **minor gap**

### SC-7: Role enforcement ✅
- Manager=full (8 tools), Co-parent=verify+read (4 tools), Family=view+gift (3 tools), Advisor=audit-only (2 tools)
- Enforced at app layer via `isToolAuthorized` + `ROLE_TOOL_ACCESS` in every tool handler
- Enforced at OWS layer via `allowance-policy.py` (4 role branches, signing blocks)
- **Test coverage**: 14 unit tests on authorization matrix, E2E tests #8-10 (RBAC denials)

### SC-8: Streaks + savings ✅
- Streak tracking: increments on consecutive days, resets on gap, weekly counter
- Multiplier: +10% per 7-day level, caps at 2.0x
- Savings: lock period, release date tracking, multiplier at deposit recorded
- **Test coverage**: 5 unit tests on evaluateStreak, 5 unit tests on streak state, E2E tests #5/#7

### SC-9: Structured responses ✅
- All 8 tools return `{ content: [{ type: "text", text: JSON.stringify({...}) }] }`
- Every response includes `success: boolean` + contextual fields
- Human-readable `message` field in every success response for Claude rendering
- Error responses are structured with `error` field

### SC-10: No OWS leakage ✅
- No tool response exposes wallet addresses, API tokens, policy JSON, or OWS internals
- `WalletSetup` logs to `console.error` (stderr), not to tool responses
- `RoleManager` returns `null` gracefully when OWS unavailable
- Invite codes don't contain any OWS metadata
- Tool descriptions use plain language ("your family", "child's name")

---

## Rubric Grading

### Functionality (30%) — Score: 27/30

| Item | Score | Notes |
|------|-------|-------|
| 8 MCP tools registered + functional | 10/10 | All 8 present with correct schemas, descriptions, handlers |
| Policy engine (eval, split, streak, budget) | 5/5 | Pure functions, well-tested (20 unit tests) |
| Savings/streaks mechanics | 4/5 | Streak tracking correct; savings lock/release logic present but no release action tool (-1) |
| Invite flow (generate → validate → accept) | 5/5 | Full lifecycle, human-readable codes, 48h expiry, single-use |
| Distribution pipeline | 3/5 | Dry-run works; real OWS path untestable without wallet setup. `verifiedBy` hardcoded to "manager" instead of using caller context (-2) |

**Deductions:**
- `-1`: No savings release tool — entries track `lockUntil` + `released` but no tool triggers release
- `-2`: `verify-achievement.ts:82` and `distribute-allowance.ts:144` hardcode `actor: "manager"` instead of using `caller.memberId` from RBAC context. The RBAC system resolves the caller correctly but the result is not passed through to the business logic.

### Auth / Security (30%) — Score: 26/30

| Item | Score | Notes |
|------|-------|-------|
| OWS policy enforcement (4 roles) | 8/8 | `allowance-policy.py` handles all 4 roles, ERC-20 decode, spend caps |
| App-layer RBAC (role isolation) | 8/8 | Per-tool guard in all 8 handlers, 14 matrix tests, 3 E2E denial tests |
| Invite code security | 4/5 | 48h expiry, single-use, ambiguous char avoidance. No rate limiting on attempts (-1) |
| Revocation completeness | 4/5 | OWS key revoked + member deactivated. No E2E test for revocation path (-1) |
| Passphrase handling | 2/4 | Passphrase passed as string arg. No file-permission hardening (0600). No OS keychain. Plan noted "V2: OS keychain" but current handling is minimal |

**Deductions:**
- `-1`: Invite validation has no brute-force protection (rate limiting)
- `-1`: Revocation works but untested in E2E
- `-2`: Passphrase is a plain string parameter. No encryption at rest, no file permission hardening

### Design / UX (25%) — Score: 22/25

| Item | Score | Notes |
|------|-------|-------|
| Invite flow simplicity | 5/5 | One code, one step. Message includes "tell their Claude" instruction |
| Role model clarity | 5/5 | 4 fixed roles, clear descriptions in responses, role hints in invite codes |
| Conversational config | 4/5 | Tool descriptions are natural language. Category % defaults to 34/33/33 for easy setup. But no validation that percentages sum to 100 (-1) |
| Error messages | 4/5 | Structured errors with context. Missing child name suggestions on lookup failure (configure-policy does this, others don't consistently) |
| No OWS leakage | 4/5 | Clean — no addresses, tokens, or policy JSON in responses. `console.error` for OWS debug logs. Minor: `walletsCreated: true/false` boolean leaks wallet concept slightly (-1) |

**Deductions:**
- `-1`: Category percentages not validated to sum to 100
- `-1`: `walletsCreated` in configure-policy response is a minor OWS concept leak
- `-1`: Error message inconsistency across tools (some suggest alternatives, some don't)

### Originality (15%) — Score: 13/15

| Item | Score | Notes |
|------|-------|-------|
| Role-to-policy mapping | 4/4 | Clean 4-role → 4-policy-bundle architecture via `ROLE_POLICY_MAP` |
| Deferred key creation (invite → accept → OWS key) | 4/4 | Novel pattern: human-readable code bridges conversational UX to OWS key provisioning |
| Code-based delegation | 3/4 | Phone-speakable codes with role hints. No QR/deep-link alternative (-1) |
| Two-tier policy (OWS + app) | 2/3 | Both layers present. App layer well-tested. OWS policy layer functional but `authorized_wallets` check in manager branch is a pass-through (line 122: `pass`) rather than actual enforcement (-1) |

**Deductions:**
- `-1`: No alternative invite mechanism (QR, link)
- `-1`: OWS policy manager branch doesn't enforce authorized recipients for ERC-20 (acknowledged in comment but not resolved)

---

## Final Score

| Category | Weight | Score | Weighted |
|----------|--------|-------|----------|
| Functionality | 30% | 27/30 (90%) | 27.0 |
| Auth / Security | 30% | 26/30 (87%) | 26.0 |
| Design / UX | 25% | 22/25 (88%) | 22.0 |
| Originality | 15% | 13/15 (87%) | 13.0 |
| **Total** | **100%** | | **88.0/100** |

---

## Verdict: **PASS** ✅

All categories meet thresholds. Build compiles clean, 84/84 tests pass.

## Bug Reports (non-blocking, for next sprint)

### Bug 1: Hardcoded `actor: "manager"` ignores RBAC caller context
- **What failed**: `verify-achievement.ts:82` and `distribute-allowance.ts:144` use `actor: "manager"` instead of `caller.memberId`
- **Expected**: Audit entries should record the actual caller identity resolved by RBAC
- **Actual**: All audit entries show "manager" regardless of who called
- **Repro**: Call verify-achievement with `_callerRole: "co-parent", _callerId: "xyz"` → audit shows `actor: "manager"`
- **Category**: Functionality

### Bug 2: Category budget percentages not validated
- **What failed**: `configure-policy.ts` accepts `educationPct + healthPct + personalPct` without checking they sum to ≤100
- **Expected**: Reject or warn when percentages exceed 100%
- **Actual**: Silently creates budgets that exceed weekly total
- **Repro**: Configure with `educationPct: 50, healthPct: 50, personalPct: 50` (150% total)
- **Category**: Design / UX

### Bug 3: No savings release tool
- **What failed**: `SavingsEntry` tracks `lockUntil` and `released` but no MCP tool triggers release
- **Expected**: A tool or automatic check that releases savings when lock period expires
- **Actual**: Savings entries stay locked forever in data
- **Repro**: Create savings entry → wait past lockUntil → no way to release
- **Category**: Functionality

### Bug 4: OWS policy manager branch doesn't enforce authorized recipients for ERC-20
- **What failed**: `allowance-policy.py:118-122` — manager branch checks `authorized_wallets` against `tx.to`, but for ERC-20 `tx.to` is the USDC contract, so the check is bypassed with `pass`
- **Expected**: Decode ERC-20 recipient and check against authorized wallets
- **Actual**: Manager can send USDC to any address (app layer tracks recipients, OWS policy doesn't)
- **Repro**: Manager sends ERC-20 transfer to unauthorized wallet → policy allows it
- **Category**: Auth / Security

### Bug 5: Passphrase handling lacks hardening
- **What failed**: Passphrase is a plain string tool argument with no at-rest protection
- **Expected**: At minimum file permissions (0600) or prompted separately
- **Actual**: Passphrase flows through tool args → OWS SDK as plaintext
- **Repro**: Observe passphrase in tool call logs
- **Category**: Auth / Security
