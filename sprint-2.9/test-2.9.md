# AllowanceAgent — test.md (Sprint 2.9)

**Target new tests: ~30. Total after Sprint 2.9: ~217.** Plus updated fixtures across all 187 Sprint 2.75 tests (mechanical updates, no assertion changes).

## Unit Tests: Multi-Tenant StateManager

| # | Test | Expected | Category |
|---|------|----------|----------|
| MT1 | `loadFamilyConfig(familyId)` returns only that family's config | Family A config != Family B config; neither sees the other | Auth/Security |
| MT2 | `saveFamilyConfig(familyId, config)` writes to correct directory | File exists at `data/families/{familyId}/family-config.json`; no file at `data/family-config.json` | Functionality |
| MT3 | `loadMembers(familyId)` returns only that family's members | Family A members ≠ Family B members | Auth/Security |
| MT4 | `addAchievement(familyId, record)` appends to correct family's file | Family A achievements.json contains the record; Family B's is unchanged | Auth/Security |
| MT5 | `createFamilyDir(familyId)` creates directory with 0o700 permissions | `stat` reports mode 0o700 | Auth/Security |
| MT6 | `listFamilies()` returns all familyIds in `data/families/` | With 3 families present, returns array of 3 UUIDs | Functionality |
| MT7 | Concurrent writes to different families don't interfere | 10 parallel saves to 10 different familyIds all succeed, no corruption | Auth/Security |
| MT8 | Reading a nonexistent family returns fallback (not error) | `loadFamilyConfig("nonexistent-uuid")` returns null | Functionality |

## Unit Tests: MemberIndex

| # | Test | Expected | Category |
|---|------|----------|----------|
| MI1 | `set(memberId, familyId, role)` persists to member-index.json | File contains entry with correct familyId and role | Functionality |
| MI2 | `get(memberId)` returns the stored entry | After set, get returns `{ familyId, role }` | Functionality |
| MI3 | `get(nonexistentMemberId)` returns null | Not found case | Functionality |
| MI4 | `remove(memberId)` deletes the entry | After remove, get returns null | Functionality |
| MI5 | `list()` returns all entries | With 5 entries, returns object with 5 keys | Functionality |
| MI6 | Concurrent `set` calls for different memberIds don't race | 10 parallel set calls all succeed, index has 10 entries | Auth/Security |
| MI7 | File permissions on member-index.json are 0o600 | `stat` reports 0o600 | Auth/Security |

## Unit Tests: Identity Resolution

| # | Test | Expected | Category |
|---|------|----------|----------|
| ID1 | X-Member-Id header resolves to correct CallerContext | `CallerContext.familyId` matches the memberId's family | Auth/Security |
| ID2 | Setup code in ?setup=CODE URL param resolves to CallerContext | Same as ID1 via different auth path | Auth/Security |
| ID3 | Unknown memberId returns null (not default Manager) | `resolveCallerRole({}, { 'x-member-id': 'fake' })` → null | Auth/Security |
| ID4 | No identity + multiple families returns null | With 2+ families on server, null | Auth/Security |
| ID5 | No identity + single family returns legacy Manager fallback | With exactly 1 family, returns Manager of that family + logs warning | Functionality |
| ID6 | `_callerRole` + `_familyId` args work in test mode | CallerContext built from args | Functionality |

## Unit Tests: Setup Codes

| # | Test | Expected | Category |
|---|------|----------|----------|
| SC1 | Issued setup code follows SETUP-XXXX-XXXX format | Regex match | Design/UX |
| SC2 | Setup code resolves to correct memberId | `resolve(code)` returns `{ memberId }` | Functionality |
| SC3 | Expired setup code returns null | After 48h simulated clock skip, resolve returns null | Auth/Security |
| SC4 | Setup code with unknown format returns null | `resolve("FOO-BAR")` → null | Auth/Security |
| SC5 | Setup code is revoked when Member is removed | After `manage-members remove`, resolve returns null | Auth/Security |

## Unit Tests: Migration

| # | Test | Expected | Category |
|---|------|----------|----------|
| MG1 | Legacy layout detected correctly | `data/family-config.json` exists + `data/families/` absent + `.migrated-2.9` absent → migration runs | Functionality |
| MG2 | Post-migration layout matches spec | Files moved to `data/families/{familyId}/`, originals deleted | Functionality |
| MG3 | member-index.json built from migrated members | Index contains one entry per active Member | Functionality |
| MG4 | `.migrated-2.9` sentinel written after success | File exists with ISO timestamp | Functionality |
| MG5 | Migration is idempotent | Running migration a second time on already-migrated data is a no-op, no error | Auth/Security |
| MG6 | Partial migration state is recoverable | If files are half-moved and migration reruns, it completes cleanly | Auth/Security |
| MG7 | Post-migration, all Sprint 2.75 tests pass with fixture updates | 187 tests green | Functionality |

## Unit Tests: Tool Scoping

| # | Test | Expected | Category |
|---|------|----------|----------|
| TS1 | `configure-policy` with null caller creates new family | Returns new familyId + memberId + setup code | Functionality |
| TS2 | `configure-policy` with existing caller updates their family | Family A's Manager updating doesn't affect Family B | Auth/Security |
| TS3 | `verify-achievement` uses caller.familyId | Family A Manager cannot verify an achievement in Family B | Auth/Security |
| TS4 | `distribute-allowance` uses caller.familyId | Cross-family distribution attempt fails | Auth/Security |
| TS5 | `check-progress` returns only caller's family's children | Family A Manager sees only Family A progress | Auth/Security |
| TS6 | `invite-member` scoped to caller's family | Invite created in Family A is only valid for Family A | Auth/Security |
| TS7 | `accept-invite` adds Member to invite's family, not caller's | Member from Family B accepting Family A invite joins Family A | Auth/Security |

---

## E2E Tests

### E2E-S2.9-1: Two Families on One Server — Full Isolation

**Setup:** Fresh Sprint 2.9 server. No data yet.

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| TF1 | User Alice (unidentified) calls `configure-policy` for "Garcia" family with child Maya | New familyId created, Alice becomes Manager, setup code issued | Functionality |
| TF2 | User Bob (unidentified, different session) calls `configure-policy` for "Chen" family with child Carlos | Different familyId created, Bob becomes Manager of Chen family | Auth/Security |
| TF3 | Alice (with her setup code) calls `check-progress` | Returns Maya's progress. Does NOT include Carlos. | Auth/Security |
| TF4 | Bob (with his setup code) calls `check-progress` | Returns Carlos's progress. Does NOT include Maya. | Auth/Security |
| TF5 | Alice attempts `check-progress` with Bob's memberId in args | Rejected — memberId doesn't belong to Alice's family | Auth/Security |
| TF6 | Alice calls `distribute-allowance` | Distribution runs from Garcia treasury. Chen treasury untouched. | Auth/Security |
| TF7 | Bob calls `distribute-allowance` | Distribution runs from Chen treasury. Independent of Garcia. | Auth/Security |

### E2E-S2.9-2: Bug Reproduction — Does the April 24 ChatGPT Bug Still Exist?

**Setup:** Fresh Sprint 2.9 server. Pre-populate one family via migration (Isaac family with 3 members).

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| BR1 | Unidentified user adds MCP, asks "what tools do you have?" | Returns tool list. **Legacy fallback active** (one family present) — may resolve to Isaac Manager with warning. | Functionality |
| BR2 | Same user calls `configure-policy` for a new "Chen" family | **Creates new family** — does not overwrite or mutate Isaac family. Chen family has its own familyId and Manager. | Auth/Security |
| BR3 | After BR2, server now has 2 families. Another unidentified user asks "what tools do you have?" | **Legacy fallback deactivated**. Request succeeds only for `configure-policy`; other tools return null caller rejection. | Auth/Security |
| BR4 | The unidentified user in BR3 calls `check-progress` | Rejected: "No caller identity. Use configure-policy to create a family, or add ?setup=CODE to your MCP URL." | Design/UX |

### E2E-S2.9-3: Migration of Real Data

**Setup:** Copy Railway production data locally. Legacy layout with Isaac family (3 active members: Juan Manager, Wife Co-parent, Chloe Learner).

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| MR1 | Start Sprint 2.9 server against legacy data | Migration runs. Logs confirm each file moved. Sentinel written. | Functionality |
| MR2 | `data/families/{familyId}/family-config.json` exists | File present with Isaac family config intact | Functionality |
| MR3 | `data/family-config.json` no longer exists | Legacy file removed | Functionality |
| MR4 | `member-index.json` contains 3 entries | Juan (Manager), Wife (Co-parent), Chloe (Learner) all mapped to the Isaac familyId | Functionality |
| MR5 | `family-keys.json` entry for Isaac familyId still decrypts wallets | WalletDistributor succeeds with retrieved key | Auth/Security |
| MR6 | Legacy single-family fallback: Juan's Claude Desktop (no setup code) hits `check-progress` | Succeeds. Returns Isaac family progress. Warning logged. | Functionality |
| MR7 | Juan calls `configure-policy` (existing user, path-2 behavior) | Updates Isaac family config, does NOT create new family | Functionality |

### E2E-S2.9-4: Setup Code Flow

**Setup:** Fresh Sprint 2.9 server, no data.

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| SU1 | Alice calls `configure-policy` for Garcia family | Response includes `setupCode: "SETUP-XXXX-XXXX"` and `mcpUrl` with embedded code | Design/UX |
| SU2 | Alice configures her Claude Desktop MCP connector with the mcpUrl | Claude Desktop connects successfully | Functionality |
| SU3 | Alice calls `check-progress` from her Claude | Succeeds. Returns Garcia family data. | Auth/Security |
| SU4 | Alice's wife is invited as Co-parent | Invite generated with Garcia familyId embedded. Contains setup-flow instructions. | Functionality |
| SU5 | Wife accepts invite via `accept-invite`. Receives her own setup code. | Wife becomes Co-parent of Garcia family. Setup code specific to her memberId. | Functionality |
| SU6 | Wife configures her Claude Mobile with her setup URL | Wife's Claude connects successfully | Functionality |
| SU7 | Wife's `verify-achievement` call | Succeeds. Wife's role (Co-parent) correctly resolved from her setup code. | Auth/Security |
| SU8 | Wife's `distribute-allowance` call | **Denied** — RBAC: Co-parent cannot distribute | Auth/Security |

### E2E-S2.9-5: Sprint 2.75 Regression Guard

**Setup:** Run all 187 Sprint 2.75 tests against Sprint 2.9 code with updated fixtures.

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| RG1 | Replace all `new StateManager()` usages in tests with `createTestFamily()` helper | Mechanical edit. No assertion changes. | Functionality |
| RG2 | Run full test suite | 187 tests pass. Zero semantic regressions. | Functionality |
| RG3 | Sprint 2.5 convert-savings tests pass | PAXG conversion scoped per-family, no cross-family ledger bleed | Functionality |
| RG4 | Sprint 2 Learner child-scoping tests pass | Learner still sees only their own child's data; new assertion: only within their own family | Auth/Security |
| RG5 | Sprint 2.75 per-family key tests pass | Key generation + encryption + retrieval unchanged | Auth/Security |
| RG6 | Fitbit tests pass with family-scoped token store | FITBIT_CLIENT_ID env var + tokens in `families/{id}/fitbit-tokens.json` | Functionality |

---

## Edge Cases

| # | Edge Case | Expected | Category |
|---|-----------|----------|----------|
| EC1 | Unidentified request + multiple families + `configure-policy` | Allowed. Creates yet another family. | Functionality |
| EC2 | Unidentified request + multiple families + any other tool | Rejected with "No caller identity" error + guidance | Design/UX |
| EC3 | Setup code for deleted Member used in MCP URL | Rejected: "Setup code revoked. Contact your family Manager." | Auth/Security |
| EC4 | Setup code with expired timestamp | Rejected: "Setup code expired. Request a new one via accept-invite or contact your family Manager." | Auth/Security |
| EC5 | Member's role changes while their setup code is active | Old setup code invalidated. New setup code issued and delivered via tool response. | Auth/Security |
| EC6 | Migration runs on already-migrated data | No-op. Sentinel present → skip migration. | Functionality |
| EC7 | `data/families/` exists but no families inside (empty directory) | Treated as "no families" — `listFamilies()` returns empty array. Legacy fallback does not activate. | Functionality |
| EC8 | Two calls to `configure-policy` from the same unidentified user (duplicate submission) | Each creates a new family. No deduplication at Sprint 2.9 — user responsibility. | Functionality |
| EC9 | member-index.json is corrupted (manual tampering) | Server logs warning. Falls through to rebuild-from-directory path (CLI script). Tools that require identity rejection until rebuilt. | Auth/Security |
| EC10 | Family directory exists but member-index entry is missing | Member cannot authenticate. `rebuild-member-index` CLI script resolves. | Auth/Security |

---

## Test Count Summary

| Suite | Count |
|-------|-------|
| Multi-tenant StateManager (MT1-MT8) | 8 |
| MemberIndex (MI1-MI7) | 7 |
| Identity resolution (ID1-ID6) | 6 |
| Setup codes (SC1-SC5) | 5 |
| Migration (MG1-MG7) | 7 |
| Tool scoping (TS1-TS7) | 7 |
| E2E: Two families isolation (TF1-TF7) | 7 |
| E2E: Bug reproduction (BR1-BR4) | 4 |
| E2E: Migration of real data (MR1-MR7) | 7 |
| E2E: Setup code flow (SU1-SU8) | 8 |
| E2E: Sprint 2.75 regression (RG1-RG6) | 6 |
| Edge cases (EC1-EC10) | 10 |
| **Sprint 2.9 new tests** | **82** |
| **Carried from Sprint 2.75 (mechanical fixture updates)** | **187** |
| **Total after Sprint 2.9** | **269** |

The explicit count lands at 82, higher than the ~30 estimate in plan.md. Most of these are short one-assert tests (MI1-MI7, SC1-SC5, ID1-ID6 are trivially small). Engineering time stays at ~3 hours for new tests + ~1 hour for the mechanical Sprint 2.75 fixture update.

**Ship floor if tests slip past budget:** MT1-MT8 + MI1-MI6 + ID1-ID5 + MG1-MG5 + TF1-TF5 + BR1-BR4 + RG1-RG3 = **38 critical tests.** Covers isolation, identity, migration, and regression guards. Additional suites are defensive and can be added post-sprint if needed.

---

## Test Execution Strategy (12–16 Hour Sprint)

**Hour 0–1:** Spike 1 (migration against production copy), Spike 2 (setup code query param propagation). Must complete before M4 implementation.

**Hour 1–5:** M1 (StateManager refactor) + MT1-MT8 unit tests as each method is refactored.

**Hour 5–9:** M2 (Identity layer) + MI1-MI7, ID1-ID6, SC1-SC5 unit tests.

**Hour 9–11:** M3 (tool handler plumbing) + TS1-TS7 tests as each tool is updated.

**Hour 11–13:** M4 (migration + backward compat) + MG1-MG7 tests.

**Hour 13–15:** M5 (mechanical Sprint 2.75 fixture updates) + RG1-RG6 regression verification.

**Hour 15–16:** E2E tests (TF, BR, MR, SU) + smoke test with real data.

If execution slips past hour 16, drop to ship floor (38 tests) and proceed to Sprint 3.0 at hour 17.

**Hard stop at hour 18:** If Sprint 2.9 is not green by hour 18, invoke the fallback from plan.md — ship single-tenant hotfix (`ALLOWME_REQUIRE_IDENTITY=true` env var, reject unidentified callers, but don't refactor data layer). Sprint 3.0 becomes single-tenant + World ID. Multi-tenancy ships in Seoul Sprint 3.5.