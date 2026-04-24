# AllowanceAgent — plan.md (Sprint 2.9)

## Feature Summary

Sprint 2.9 refactors AllowanceAgent from single-tenant (one family per deployment) to multi-tenant (many families on one deployment) with strict family-scoped data isolation. This is a prerequisite for Sprint 3.0 World ID integration — sybil defense is architecturally meaningless until families are actually isolated on the server.

The bug this sprint fixes: when a new user adds the MCP server to Claude or ChatGPT, they currently see the existing Isaac family's data and are auto-granted Manager role. Root cause: `resolveCallerRole` defaults to `ROLES.MANAGER` when no identity is present, and all data is in flat files at `data/*.json` with no family scoping at the access layer.

The refactor migrates data to `data/families/{familyId}/...`, adds a global `member-index.json` for caller → family lookup, hardens `resolveCallerRole` to reject unidentified callers (except for the new-family setup path via `configure-policy`), and introduces a lightweight setup-code auth mechanism for Claude Desktop users until Sprint 3.0 session tokens replace it. Legacy Sprint 2.75 data is auto-migrated on first boot; existing users preserved via single-family backward-compat fallback.

Target effort: ~12–16 hours. New tests: ~30. Total tests after Sprint 2.9: ~217. Schedule: runs before Sprint 3.0 in the 48-hour window. If Sprint 2.9 blows its budget past 18 hours, invoke fallback (single-tenant hotfix with header-forced identity) to preserve Sprint 3.0 time.

## Problem Statement

Sprint 2.75 shipped per-family encryption keys, which sound multi-tenant but aren't. The wallet encryption is family-scoped; the data layer is not. `data/family-config.json`, `data/members.json`, `data/achievements.json`, `data/savings.json`, and `data/audit-log.json` all contain a single family's data. When a second family is configured, the first is overwritten or merged incoherently. Worse: `resolveCallerRole()` falls through to `ROLES.MANAGER` as a default when no `X-Member-Id` header or `_callerId` arg is present. A stranger hitting the HTTP endpoint with no auth is treated as the Manager of whatever family happens to be in `family-config.json`.

Confirmed by screenshots (April 24, 2026): new ChatGPT user added AllowanceAgent MCP, received a response reading "3 active members, all named Isaac Manager." That's the deployed Isaac family leaking to anyone who connects. `configure-policy` from the new user then overwrote or mutated the existing family config. `distribute-allowance` executed a real on-chain transfer from the shared treasury.

This is a multi-tenancy bug, not a key persistence bug. The master key is working correctly — that's why decryption succeeded for the existing family's wallets. The problem is the single-tenant data architecture combined with default-to-Manager auth fallback.

Sprint 3.0 cannot ship without this fixed. World ID binds a nullifier to a Member; sybil defense depends on "different humans → different families." If the server has only one family and every unidentified caller is its Manager, the nullifier enforcement is theater.

## Architecture Decisions

### 1. Multi-tenant directory layout under `data/families/{familyId}/`
**Decision:** Move all per-family data into `data/families/{familyId}/` subdirectories. Each family gets `family-config.json`, `members.json`, `invites.json`, `streaks.json`, `savings.json`, `achievements.json`, `audit-log.json`, and `fitbit-tokens.json` inside its own folder. Server-wide data (`family-keys.json`, `.master-key`, `.session-secret`, `member-index.json`, Sprint 3.0 `world-id-nullifiers.json`) stays at `data/` root.
**Why:** Directory-per-family is the simplest persistence pattern that enforces isolation at the filesystem level. Even if the data layer has a bug that forgets to scope by `familyId`, the wrong family's directory won't be touched accidentally. Defense in depth over a pure logical scoping approach.

### 2. Global `member-index.json` for caller identity resolution
**Decision:** Maintain `data/member-index.json` as a flat map: `{ memberId: { familyId, role } }`. `resolveCallerRole` reads this file once per request to map an authenticated `memberId` to the caller's `familyId`.
**Why:** Without this, identifying a caller's family would require loading every family's `members.json` until a match is found — O(n) per request, unbounded. The index is small, fast to read, and atomic-writable with the existing rename pattern from Sprint 1 `state.ts`. One authoritative source of truth for "who is this member and which family do they belong to."

### 3. `CallerContext` gains `familyId` — mandatory, not optional
**Decision:** Extend `CallerContext` to require `familyId`. Every tool handler scopes its data access by `caller.familyId`. No tool may read or write data without a `familyId` in scope.
**Why:** The bug was the absence of tenant context. Making `familyId` mandatory at the middleware layer means the compiler and type system help catch missing scoping, not just runtime checks.

### 4. `resolveCallerRole` stops defaulting to Manager
**Decision:** `resolveCallerRole` returns `CallerContext | null`. Unidentified callers get `null`. The default-to-Manager fallback is removed entirely.
**Why:** Auto-Manager was the direct cause of the data leak. Any caller without explicit identity is a stranger until proven otherwise. Strangers can only call `configure-policy` (to create a new family, which gives them identity as its Manager). Every other tool rejects `null` callers with a clear error.

### 5. `configure-policy` is the one tool unidentified callers can use
**Decision:** `configure-policy` accepts `null` callers. When called without identity, it creates a new family: generates `familyId`, generates per-family key via `FamilyKeyManager.generateFamilyKey`, creates the family directory, creates the Manager Member, writes to `member-index.json`, returns the new `memberId` and a setup code. When called with identity, it updates the caller's existing family.
**Why:** A brand-new user must be able to bootstrap. Without an unauthenticated entry point, there's no way to onboard. `configure-policy` is the natural entry point because creating a family is the one legitimate action a stranger can take. All other tools require existing family membership.

### 6. Setup-code auth for Claude Desktop / ChatGPT MCP connectors
**Decision:** Introduce a setup-code mechanism. `configure-policy` returns a code like `SETUP-4K7W-X2P9`. User appends it to their MCP server URL as a query param: `https://allowme.dev/mcp?setup=SETUP-4K7W-X2P9`. HTTP transport reads the query param on each connection, maps to `memberId` via `member-index`, treats the connection as authenticated.
**Why:** Claude Desktop and ChatGPT MCP connectors don't have first-class custom header fields in their config UI. Query param auth is ugly but universally supported. It's a bridge to Sprint 3.0's verify-page session tokens. Setup codes persist across Sprint 3.0; they just stop being the only auth path once sessions ship.

### 7. Backward compat for migrated single-family deployments
**Decision:** On first Sprint 2.9 boot, migrate existing `data/*.json` files into `data/families/{new-uuid}/*.json`. The existing family gets a fresh `familyId`. Existing Members get entries in `member-index.json`. If a request arrives with no identity AND the server has exactly one family, treat the request as the Manager of that one family (legacy single-family mode). Log a warning every request: `[legacy] Request without identity resolved to sole family. Users should update MCP config with setup code.`
**Why:** Juan's wife is already configured as Co-parent on the Isaac family. Her Claude Mobile setup has no setup code. Breaking her access on deploy would be operationally bad. Single-family backward compat is a transitional bridge; once a second family is created, the fallback deactivates (ambiguous — which family?) and all users must use setup codes or session tokens.

### 8. Migration is one-way, atomic, and runs at startup
**Decision:** On boot, if `data/family-config.json` exists and `data/families/` does not, run migration: (a) generate `familyId`, (b) create `data/families/{familyId}/`, (c) move each file into it, (d) build `member-index.json` from the migrated members, (e) preserve `family-keys.json` entry under the new `familyId`, (f) mark migration complete via `data/.migrated-2.9` sentinel file. If any step fails, abort startup with a clear error — do not leave partial state.
**Why:** Multi-step migration with partial failure is the worst kind of data corruption. Atomic migration with a sentinel file is standard practice. If migration fails, the operator debugs with complete data, not half-moved files.

### 9. Sprint 2.75 test suite must pass unchanged after fixture updates
**Decision:** Existing 187 tests need minor fixture updates — any test that creates a `StateManager` and calls `loadFamilyConfig()` etc. must first set up a test family via a helper. Add `tests/helpers/family.ts` with `createTestFamily(overrides?)` that returns `{ familyId, memberId }`. All existing tests import this helper and scope their assertions to the test family. No test logic changes; only fixture setup.
**Why:** If existing tests pass only with changes to their assertions, the refactor leaked into behavior. If they pass with purely mechanical fixture updates, the refactor preserved semantics.

### 10. No new features in Sprint 2.9 — refactor only
**Decision:** Sprint 2.9 ships multi-tenancy and nothing else. No new tools, no new schemas (beyond `familyId` already present on `FamilyConfig`), no new features. Any scope creep gets pushed to Sprint 3.0.
**Why:** Refactors that also add features are where bugs hide. Preserving exact Sprint 2.75 semantics while fixing the architecture means any test that passed before must pass after (with mechanical fixture updates). Feature additions break that invariant.

---

## Implementation Steps

### Workstream M1: Data Layer Refactor (4.5 hours)

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| M1.1 | Add `familyId: string` parameter to all `StateManager` read methods: `loadFamilyConfig`, `loadAchievements`, `loadMembers`, `loadInvites`, `loadStreaks`, `loadStreak`, `loadSavingsEntries`, `loadAuditLog` | Medium | 45m |
| M1.2 | Add `familyId: string` parameter to all `StateManager` write methods: `saveFamilyConfig`, `saveAchievements`, `addAchievement`, `saveMembers`, `addMember`, `saveInvites`, `addInvite`, `saveStreaks`, `initializeStreak`, `updateStreak`, `saveSavingsEntries`, `addSavingsEntry`, `addAuditEntry` | Medium | 1h |
| M1.3 | Update `readJson` and `writeJson` helpers to accept `familyId` and route to `data/families/{familyId}/{filename}` | Low | 30m |
| M1.4 | New method: `StateManager.createFamilyDir(familyId)` — mkdir recursive, set permissions 0o700 on the family directory | Low | 20m |
| M1.5 | New method: `StateManager.listFamilies()` — readdir `data/families/`, return array of `familyId` strings | Low | 20m |
| M1.6 | New method: `StateManager.familyExists(familyId)` — check if `data/families/{familyId}/family-config.json` exists | Low | 10m |
| M1.7 | Move `FitbitTokenStore` storage under `data/families/{familyId}/fitbit-tokens.json`. Update `src/fitbit/token-store.ts` constructor to accept `familyId` | Medium | 45m |
| M1.8 | Preserve `family-keys.json` at `data/` root (already keyed by familyId, no change needed). Verify `FamilyKeyManager` still works | Low | 15m |
| M1.9 | Unit tests for new `StateManager` methods: per-family isolation, directory creation, concurrent writes to different families | Medium | 45m |

### Workstream M2: Identity + Access Control Refactor (3.5 hours)

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| M2.1 | New file: `src/identity/member-index.ts`. Class `MemberIndex` with `get(memberId)`, `set(memberId, familyId, role)`, `remove(memberId)`, `list()`. Persists to `data/member-index.json` with atomic rename | Medium | 45m |
| M2.2 | Extend `CallerContext` in `src/middleware/access-control.ts` — add `familyId: string` as mandatory field | Low | 10m |
| M2.3 | Rewrite `resolveCallerRole` to return `CallerContext | null`. Priority order: (1) `X-Member-Id` header → `MemberIndex.get()` → CallerContext, (2) `?setup=CODE` URL query → resolve code → CallerContext, (3) `_callerId` arg → `MemberIndex.get()`, (4) explicit `_callerRole` + `_familyId` for test mode only, (5) default → null (NOT Manager). Add legacy single-family fallback per Decision 7. | High | 1.5h |
| M2.4 | Update `withAccessControl` wrapper to handle `null` callers: allow only `configure-policy`, reject all others with clear error message | Medium | 30m |
| M2.5 | New file: `src/identity/setup-codes.ts`. Setup code generation (`SETUP-XXXX-XXXX` format, 48h expiry), validation, redemption. Stores in `data/setup-codes.json` | Medium | 45m |
| M2.6 | HTTP transport: extract `?setup=` query param from incoming requests and inject into caller resolution context. Update `app/server.ts` middleware | Medium | 30m |

### Workstream M3: Tool Handler Plumbing (2.5 hours)

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| M3.1 | Update `configure-policy` — accepts null callers. On null, generates new `familyId` + Manager Member + setup code, writes to `member-index.json`, returns `memberId` + `setupCode` + instructions. On non-null, updates existing family (same as today but with `caller.familyId` scoping). | High | 45m |
| M3.2 | Update `verify-achievement` — pass `caller.familyId` to all `state.load*` and `state.save*` calls | Low | 10m |
| M3.3 | Update `distribute-allowance` — pass `caller.familyId`, also scope `FamilyKeyManager.getFamilyKey(caller.familyId)` | Low | 15m |
| M3.4 | Update `check-progress` — pass `caller.familyId`. Child-scoping logic unchanged. | Low | 10m |
| M3.5 | Update `check-savings` — pass `caller.familyId` | Low | 10m |
| M3.6 | Update `invite-member` — pass `caller.familyId`. New invites inherit the creator's family. | Low | 10m |
| M3.7 | Update `accept-invite` — resolve invite's `familyId` from the invite record, create Member under that family, add entry to `member-index.json` | Medium | 30m |
| M3.8 | Update `manage-members` — pass `caller.familyId`. On member removal, also remove from `member-index.json`. | Low | 15m |
| M3.9 | Update `get-funding-address` — pass `caller.familyId` | Low | 10m |
| M3.10 | Update `release-savings` — pass `caller.familyId` | Low | 10m |
| M3.11 | Update `connect-fitbit` — pass `caller.familyId`, route Fitbit tokens to family-scoped path | Low | 15m |
| M3.12 | Update `convert-savings` — pass `caller.familyId` | Low | 10m |

### Workstream M4: Migration + Backward Compat (1.5 hours)

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| M4.1 | New file: `src/migrations/2.9-multi-tenant.ts`. Function `migrateToMultiTenant()` runs at startup. Detects legacy layout (`data/family-config.json` exists, `data/families/` does not), generates `familyId`, creates family directory, moves all legacy files into it, builds `member-index.json` from migrated members, writes `data/.migrated-2.9` sentinel, logs each step | High | 45m |
| M4.2 | Call `migrateToMultiTenant()` from `src/index.ts` (stdio) and `app/server.ts` (HTTP) at startup, before any other initialization | Low | 15m |
| M4.3 | Legacy single-family fallback in `resolveCallerRole` — when caller has no identity and `listFamilies()` returns exactly 1, treat as Manager of that family. Log warning each request. Deactivates automatically once a second family is created. | Medium | 30m |

### Workstream M5: Tests (3 hours)

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| M5.1 | New helper: `tests/helpers/family.ts` — `createTestFamily(overrides?)` returns `{ familyId, memberId, managerContext }`. Used by all updated tests as the one-line setup replacement for prior single-tenant fixtures. | Medium | 30m |
| M5.2 | Update all 187 Sprint 2.75 tests to use `createTestFamily()` helper. Mechanical. | High | 1h |
| M5.3 | Multi-tenant isolation tests (MT1-MT8) — see test.md | Medium | 45m |
| M5.4 | Identity resolution tests (ID1-ID6) — see test.md | Medium | 30m |
| M5.5 | Migration tests (MG1-MG5) — see test.md | Medium | 30m |
| M5.6 | E2E: two-family cross-isolation (E1-E5) — see test.md | Medium | 45m |

**Total Sprint 2.9 estimate: ~15 hours (with ~2h of slippage cushion = 17h worst case).**

---

## Dependencies and Risks

| Dependency | Risk | Mitigation |
|------------|------|------------|
| Sprint 2.75 test suite | Medium | All 187 tests must pass after mechanical fixture updates. If any test fails semantically, the refactor leaked. Fix the refactor, don't fix the test. |
| Existing Railway deployment data | High | Isaac family data in current `data/` must migrate cleanly. Run migration against a copy of prod data locally before deploying. If migration fails, existing family is recoverable from Railway volume snapshots. |
| `member-index.json` write atomicity | Medium | Atomic rename pattern from Sprint 1 `state.ts` already handles this. Verify test NS5-style concurrent-write test covers member index. |
| Setup code UX | Medium | Query param auth is ugly. Users may not understand "paste `?setup=XXX` at the end of the URL." Mitigate with very explicit instructions in `configure-policy` response. Sprint 3.0 verify page replaces this path for new users. |
| Legacy single-family fallback edge case | Medium | What happens if legacy user is mid-request when a second family is created? Fallback deactivates mid-request → request fails. Accept this — it's rare, recoverable, and logged loudly. |
| Fitbit token migration | Low | Fitbit is optional per child. Moving `fitbit-tokens.json` under family dir is mechanical. If a user hasn't connected Fitbit, nothing to migrate. |
| Setup codes leak via logs | Medium | Do NOT log full setup codes. Log truncated: `SETUP-****-X2P9`. Same privacy posture as nullifiers in Sprint 3.0. |
| Sprint 3.0 session tokens supersede setup codes | Low | Sprint 3.0 session tokens are priority 1 in `resolveCallerRole`; setup codes drop to priority 2. Both remain valid auth paths. No deprecation needed in Sprint 2.9. |

## Fallback Approaches

- **Sprint 2.9 blows past 18 hours:** Ship a single-tenant hotfix instead. Add `ALLOWME_REQUIRE_IDENTITY=true` env var. When set, `resolveCallerRole` rejects all requests without `X-Member-Id` or `_callerId`. Sprint 3.0 then becomes "single-tenant + World ID" with a clearer limitation in the pitch. Multi-tenancy ships in Seoul as Sprint 3.5.
- **Migration fails on existing data:** Back out the migration (delete `data/families/` directory, revert deploy to Sprint 2.75 code). Railway volume snapshots preserve the legacy layout. Debug offline; don't demo with broken state.
- **Setup code UX fails during testing:** Fall back to `X-Member-Id` header via curl for testing. Claude Desktop users can manually edit the raw MCP connector config JSON to append query params. Not great UX but unblocks demo.
- **`member-index.json` corruption:** Rebuild from family directories — iterate every `data/families/{id}/members.json`, reconstruct the index. Make this a manual CLI command: `npx tsx src/scripts/rebuild-member-index.ts`. Run only if corruption detected.
- **Legacy single-family fallback breaks something:** Remove the fallback. Juan and wife update their MCP configs manually with setup codes before Sprint 3.0 demo. 10 minutes of coordinated update. Not the end of the world.

---

## Sprint Contract — Sprint 2.9

### Success Criteria

1. **Two families can coexist on the same server with complete data isolation.** Family A's Manager cannot read or write any of Family B's data via any MCP tool. Attempting to pass Family B's `memberId` while authenticating as Family A fails with a clear error.
2. **New user onboarding produces a new family, not access to existing data.** A stranger adding the MCP server to their Claude/ChatGPT and calling `configure-policy` creates a brand-new family with its own `familyId` and its own Manager Member. They never see the Isaac family's data.
3. **The multi-tenancy bug demonstrated in the April 24 screenshots does not reproduce** on the updated server. New user connecting to MCP, asking "what tools do you have?" gets back the tool list with no leaked family data.
4. **Legacy single-family fallback preserves existing users during the transition.** Juan's existing Claude Desktop connection continues to work without code changes. Wife's Claude Mobile connection continues to work. Both get a deprecation warning in logs.
5. **Setup-code auth works end-to-end.** `configure-policy` returns a setup code. User appends `?setup=SETUP-XXXX-XXXX` to their MCP server URL. Subsequent requests are correctly identified as that Member of that Family.
6. **Migration of existing Sprint 2.75 data runs cleanly on first boot.** Isaac family data is preserved under a new `familyId`-scoped directory. `member-index.json` is correctly built from the migrated members. All wallet operations continue to work (per-family keys are already scoped correctly from Sprint 2.75).
7. **All 187 Sprint 2.75 tests pass unchanged after fixture updates.** Any test logic change indicates a semantic regression and must be fixed in the refactor, not the test.
8. **No default-to-Manager path exists.** `resolveCallerRole` returns `null` for unidentified callers (outside the legacy fallback). `configure-policy` is the only tool that accepts null callers.
9. **Member-index, setup-code store, and family directories are resilient to concurrent writes.** Atomic rename pattern prevents partial writes or race conditions.
10. **Sprint 3.0 can start from a multi-tenant foundation.** The `familyId` field is mandatory throughout the access layer. World ID nullifier enforcement in Sprint 3.0 becomes architecturally meaningful because families are actually separated.

### Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| Functionality | 30% | Multi-tenant data layer, identity resolution, setup codes, migration, legacy fallback |
| Auth/Security | 40% | The bug was an auth failure. Security category is weighted higher than usual. Covers no-default-Manager, strict family scoping, data isolation, setup code security, no plaintext code storage in logs. |
| Design/UX | 15% | Setup-code UX is ugly but clear. Migration is transparent. Error messages for unidentified callers guide the user toward `configure-policy`. |
| Originality | 15% | Transitional setup-code auth bridging to Sprint 3.0 session tokens. Single-family backward compat as a deliberate migration tool. Family-directory filesystem isolation as defense in depth. |

### Grading Thresholds

- **Pass:** All categories ≥ 70%. Auth/Security ≥ 80% (this is where the bug lived — cannot ship without high confidence here). All 10 success criteria met.
- **Fail:** Auth/Security below 80%, OR any success criterion unmet, OR any data leak between families reproducible in tests, OR Sprint 2.75 regression in the 187-test suite.

### Explicit Non-Goals

- No new MCP tools
- No new schemas beyond what Sprint 2.75 already ships (`FamilyConfig.familyId` is already present)
- No UX polish on setup-code flow beyond "works and is documented"
- No changes to OWS custody, viem transfer logic, or `policies/allowance-policy.py`
- No changes to Sprint 2.5 savings asset schema, convert-savings flow
- No World ID, no session tokens, no verify page (all Sprint 3.0)
- No production Mini App review, no Vercel deployment (all Sprint 3.0 trimmed scope)
- No AgentKit, no World Chain, no WLD (all Sprint 3.5)