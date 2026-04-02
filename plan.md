# AllowanceAgent — plan.md (Sprint 1: MVP)

## Feature Summary

AllowanceAgent is an OWS-native MCP server where Claude abstracts all wallet complexity. Parents interact via natural language. OWS handles key custody, policy-gated signing, and API key delegation invisibly. MVP delivers: achievement-gated USDC distribution, four-role family model with invite codes, gamified savings with streaks/multipliers, and local JSON persistence. stdio transport for Claude Desktop; x402 deferred to Sprint 2.

## Architecture Decisions

1. **Claude is the only interface** — No family member sees OWS commands, keys, or wallet addresses
2. **Four fixed roles** — Manager, Co-parent, Family, Advisor. No custom permissions
3. **Invite codes for delegation** — Human-readable (MAYA-GIFT-7X2K), deferred key creation
4. **OWS as wallet + policy layer** — Replaces AgentKit. Policy engine enforces at signing layer
5. **Two-tier policy** — OWS for signing security, app for business logic
6. **One wallet per concern** — treasury, child-{name}, savings-vault, gift-fund, estate-vault
7. **stdio transport for MVP** — x402 requires HTTP; defer to Sprint 2
8. **JSON file persistence** — Matches OWS local-first model. Zero DB dependency

## Implementation Steps

| Step | Task | Complexity | Status |
|------|------|-----------|--------|
| 1 | Project scaffold — TypeScript + MCP SDK + OWS SDK. Dirs: `src/tools/`, `src/engine/`, `src/wallet/`, `src/roles/`, `src/invites/`, `data/`. Package.json, tsconfig, entry point. | Low | Pending |
| 2 | OWS wallet setup module (`src/wallet/setup.ts`) — Creates treasury + child + savings + gift-fund wallets via OWS SDK. Creates initial Manager API key with allowance-full-access policy. Generates all four policy bundle JSON files. Stores passphrase in local encrypted config. | High | Pending |
| 3 | OWS custom policy executable (`policies/allowance-policy.py`) — Reads role from `policy_config`. Manager: spend cap + recipient allowlist. Co-parent: deny signing. Family: gift-fund only + max gift. Advisor: deny all. Decodes ERC-20 calldata for USDC amount. | High | Pending |
| 4 | Zod schemas (`src/schemas.ts`) — PolicyConfig, AchievementInput, FamilyConfig, SavingsLedger, Invite, Member, Role, AuditEntry, StreakData. | Low | Pending |
| 5 | State manager (`src/engine/state.ts`) — Atomic read/write for JSON files: config, achievements, savings, members, invites, audit-log, streaks. Write-to-temp + rename pattern. | Medium | Pending |
| 6 | Role manager (`src/roles/manager.ts`) — Maps roles → OWS policy bundle IDs. createRoleApiKey, revokeRoleApiKey, changeRole (revoke + recreate). Member registry in data/members.json. | High | Pending |
| 7 | Invite system (`src/invites/system.ts`) — Generate codes ({CHILD}-{ROLE}-{4ALPHANUM}). Store in data/invites.json. Validate + accept: create OWS API key with role policy. 48h expiry, single-use. | Medium | Pending |
| 8 | Policy engine (`src/engine/policy.ts`) — Pure functions: evaluateAchievement(), calculateSavingsSplit(), evaluateStreak(), calculateMultiplier(). App-layer business logic only. | Medium | Pending |
| 9 | Wallet distributor (`src/wallet/distributor.ts`) — Wraps OWS signAndSend. Builds ERC-20 transfer calldata via viem. Handles treasury→child and treasury→savings splits. Dry-run mode. | Medium | Pending |
| 10 | MCP tool: `configure-policy` — NL → config JSON. Validates, writes family config, creates/updates OWS policy_config. Manager only. | Medium | Pending |
| 11 | MCP tool: `verify-achievement` — Category + description + score → policy eval → queue for distribution → update streaks. Manager + Co-parent. | High | Pending |
| 12 | MCP tool: `distribute-allowance` — Process pending achievements. OWS signAndSend for each split. Update audit log. Manager only. | High | Pending |
| 13 | MCP tool: `check-progress` — Weekly status, streaks, totals, savings. Read-only. All roles. | Low | Pending |
| 14 | MCP tool: `check-savings` — Vault details, lock status, multiplier projections. Manager + Co-parent. | Low | Pending |
| 15 | MCP tool: `invite-member` — Name + role → generate invite code. Manager only. | Medium | Pending |
| 16 | MCP tool: `accept-invite` — Code → validate → create OWS API key → provision. | High | Pending |
| 17 | MCP tool: `manage-members` — List, change role, remove. Manager only. | Medium | Pending |
| 18 | MCP server wiring (`src/index.ts`) — Register all tools, stdio transport, role-based access control middleware. | Medium | Pending |
| 19 | Unit tests — Policy engine, role manager, invite system, state manager. | Medium | Pending |
| 20 | E2E test — Configure → invite → accept → verify → distribute → check as co-parent → denied distribute. | High | Pending |

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| ERC-20 calldata not in `PolicyContext.transaction.data` | Policy can't enforce USDC spend caps | Fallback: decode from `raw_hex`. App-layer spend tracking as defense-in-depth. |
| OWS `signAndSend` doesn't handle gas/nonce | Distribution flow must pre-build complete tx | Use viem `estimateGas` + `getTransactionCount` before building tx hex |
| OWS `spending.daily_total` tracks ETH not ERC-20 | Policy spend cap is blind to USDC | App-layer USDC spend tracker in state manager; policy as secondary check |
| Passphrase storage for deferred key creation | Security concern if config file leaked | MVP: local-only, file permissions 0600. V2: prompt parent or use OS keychain |

---

## Sprint Contract — Sprint 1 (MVP)

### Success Criteria

1. **configure-policy**: Parent configures allowance in natural language. OWS policy bundles + wallets created automatically. No technical steps.
2. **verify-achievement**: Correctly evaluates education/health/personal categories. Co-parent can verify; Family cannot.
3. **distribute-allowance**: Splits to child wallet + savings vault via OWS signAndSend. OWS policy blocks unauthorized recipients and over-cap spending.
4. **invite-member**: Non-technical parent adds family member by name + role in one conversational turn. Invite code is human-readable and phone-speakable.
5. **accept-invite**: Family member connects with a single code. OWS API key creation invisible. Zero technical steps.
6. **Revocation**: "Remove Marcus" → OWS key deleted → token useless → instant. No residual access.
7. **Role enforcement**: Manager=full, Co-parent=verify+read, Family=view+gift, Advisor=audit-only. Enforced at both OWS and app layer.
8. **Streaks + savings**: Streak tracking increments/resets correctly. Savings multiplier calculates after lock period.
9. **Structured responses**: All tools return structured data Claude can render conversationally.
10. **No OWS leakage**: No tool response ever exposes wallet addresses, API tokens, policy JSON, or OWS internals to the user.

### Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| Functionality | 30% | 8 MCP tools, policy engine, savings/streaks, invite flow, distribution pipeline |
| Auth / Security | 30% | OWS policy enforcement, role isolation, invite code security, revocation completeness, passphrase handling |
| Design / UX | 25% | Invite flow simplicity, role model clarity, conversational config, error messages, no OWS leakage |
| Originality | 15% | Role-to-policy mapping, deferred key creation, code-based delegation, two-tier policy architecture |
