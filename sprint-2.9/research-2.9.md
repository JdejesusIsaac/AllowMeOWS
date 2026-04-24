# AllowanceAgent — research.md (Sprint 2.9)

## Phase 0a: Problem Framing

### Problem Statement

Sprint 2.75 shipped per-family encryption keys but did not actually deliver multi-tenancy. Three layers needed to be family-scoped; only one was. Encryption keys are scoped via `family-keys.json` keyed by `familyId`. Data storage is NOT scoped — all files in `data/` hold a single family's state. Identity resolution in `resolveCallerRole` is NOT scoped — the default case returns `ROLES.MANAGER` without a `familyId`. The result is a server architecturally incapable of hosting more than one family safely.

This became visible on April 24, 2026 when a new ChatGPT user added the MCP server via custom connector. Their ChatGPT session introspected AllowanceAgent and reported "3 active members, all named Isaac Manager." They then ran `configure-policy` for a new Chloe family and got responses that commingled the new request with existing Isaac family state. `distribute-allowance` executed real on-chain transfers from the shared treasury.

The bug is not recoverable without an architectural change. Patching `resolveCallerRole` to reject default-Manager isn't enough — the data layer still operates on a single global namespace. Any caller identified as a Manager still sees the one and only family's data.

### "What Is" Statement

Sprint 2.75 data architecture:

```
data/
  .master-key                  (server key, encrypts family keys)
  family-keys.json             (family-scoped ✓)
  family-config.json           (one family only ✗)
  members.json                 (one family only ✗)
  invites.json                 (one family only ✗)
  streaks.json                 (one family only ✗)
  savings.json                 (one family only ✗)
  achievements.json            (one family only ✗)
  audit-log.json               (one family only ✗)
  fitbit-tokens.json           (keyed by child name, not family-scoped ✗)
```

Sprint 2.75 auth architecture:

```
resolveCallerRole(args):
  if args._callerRole and args._callerId: return CallerContext
  if args._callerId: look up member, return CallerContext (or fall through)
  default: return { role: ROLES.MANAGER, memberId: "manager" }  // ← the bug
```

Every tool handler calls `StateManager.loadFamilyConfig()` with no arguments. The method returns the single `data/family-config.json` file. Multi-family coexistence is impossible.

### Solution Hypothesis

Sprint 2.9 refactors both layers. Data moves under `data/families/{familyId}/`. Identity resolution gains a global `member-index.json` lookup and drops the default-Manager fallback. `CallerContext` gains a mandatory `familyId` field. All 12 MCP tools receive `caller.familyId` and scope every `StateManager` call with it.

The refactor is mechanical — every method gets one new parameter, every file path gets one new directory component — but it has to be applied consistently across 14 `StateManager` methods, 12 tool handlers, 2 transports, and 187 existing tests. Miss one spot and you reintroduce the leak.

A lightweight setup-code auth mechanism bridges the identity gap between Sprint 2.9 (when tools need `familyId` in context) and Sprint 3.0 (when session tokens provide it automatically via the verify page). Setup codes are short strings users paste into their MCP connector URL as a query param. Ugly but universally supported.

Migration handles existing data: on first boot with Sprint 2.9 code, legacy `data/*.json` files are moved into `data/families/{new-uuid}/` and a `member-index.json` is built. A backward-compat fallback keeps existing users working during transition: if the server has exactly one family and a request arrives with no identity, treat it as that family's Manager. The fallback deactivates once a second family is created.

### Scope Boundary

**In scope:**
- `StateManager` refactor: all 14 methods take `familyId`
- Filesystem layout: `data/families/{familyId}/...`
- `CallerContext.familyId` mandatory field
- `resolveCallerRole` rewrite: no default-Manager, returns nullable
- `member-index.json` global lookup, atomic writes
- Setup-code auth via `?setup=CODE` URL query param
- `configure-policy` bootstrap path for unidentified callers
- Migration: one-way, atomic, sentinel-file protected
- Legacy single-family fallback for transitional backward compat
- Fitbit token store moves under family directory
- All 12 tool handlers updated to scope by `caller.familyId`
- 187 Sprint 2.75 tests mechanically updated via new test helper
- ~30 new tests for multi-tenant isolation, identity resolution, migration

**Out of scope (Sprint 3.0 or later):**
- World ID verification (Sprint 3.0)
- Session tokens (Sprint 3.0 — will become priority 1 in `resolveCallerRole`, above setup codes)
- Verify page / static HTML / IDKit integration (Sprint 3.0)
- Nullifier store (Sprint 3.0)
- Mini App distribution (cut from Sprint 3.0 trimmed, school-orb model instead)
- AgentKit (Sprint 3.5 Seoul)
- World Chain USDC (Sprint 3.5 Seoul)
- Cross-family operations (e.g., Family A Manager helping Family B as Co-parent — handled by Sprint 3.0 with action namespaces, architecturally supported in Sprint 2.9 because member-index allows one `memberId` per `familyId`)
- Per-family operator tools (admin across families — out of scope, Sprint 3.5+)
- Database migration from JSON files (V3+)

**Explicitly NOT refactored:**
- OWS wallet setup (`src/wallet/setup.ts`) — already per-family via per-family keys
- OWS wallet distributor (`src/wallet/distributor.ts`) — accepts passphrase as arg, unchanged
- `FamilyKeyManager` and `master-key.ts` — already family-scoped
- `policies/allowance-policy.py` — OWS-layer policy, doesn't know about multi-tenancy at the app layer
- Sprint 2.5 `convert-savings` logic — ledger-only tool, just gets `familyId` plumbed through
- Sprint 2 x402 or aixyz — already removed

---

## Phase 0b: Technical Research

### 1. Data Layout — Directory per Family

**Proposed layout:**

```
data/
  .master-key                           server-wide, unchanged
  .session-secret                       server-wide, Sprint 3.0 prep
  .migrated-2.9                         migration sentinel (empty file)
  family-keys.json                      server-wide, keyed by familyId (Sprint 2.75)
  member-index.json                     NEW — global memberId → {familyId, role}
  setup-codes.json                      NEW — transient auth codes
  families/
    {uuid-1}/
      family-config.json
      members.json
      invites.json
      streaks.json
      savings.json
      achievements.json
      audit-log.json
      fitbit-tokens.json
    {uuid-2}/
      family-config.json
      ... (same structure)
```

**Why directory-per-family vs single file with familyId key:**

A single `families.json` with `{ [familyId]: FamilyConfig }` was considered. Rejected because:

- Atomic writes require rewriting the entire file on every update. At scale, this becomes a bottleneck.
- A bug in one family's data shape could corrupt the entire file on deserialize.
- Directory-per-family gives filesystem-level isolation. Even if the code has a `familyId` scoping bug, it cannot accidentally read/write another family's directory as long as the path includes the correct `familyId`.
- Directory permissions can be per-family (0o700 on `data/families/{id}/`) for defense in depth.
- Debugging and backups are cleaner: `tar -czf family-A-backup.tar.gz data/families/uuid-A/`.

**Existing `StateManager.readJson` and `writeJson`:**

Currently:
```typescript
async function readJson<T>(filename: string, fallback: T): Promise<T>
async function writeJson<T>(filename: string, data: T): Promise<void>
```

New signatures:
```typescript
async function readJson<T>(familyId: string, filename: string, fallback: T): Promise<T>
async function writeJson<T>(familyId: string, filename: string, data: T): Promise<void>
```

File path resolution:
```typescript
const filepath = join(dataDir, "families", familyId, filename);
```

**Directory creation:**

```typescript
async function ensureFamilyDir(familyId: string): Promise<void> {
  const familyDir = join(dataDir, "families", familyId);
  if (!existsSync(familyDir)) {
    await mkdir(familyDir, { recursive: true, mode: 0o700 });
  }
}
```

Called before the first write to any family. Safe to call repeatedly.

### 2. `member-index.json` — Global Lookup

**Structure:**
```json
{
  "member-uuid-abc": {
    "familyId": "family-uuid-A",
    "role": "manager"
  },
  "member-uuid-def": {
    "familyId": "family-uuid-A",
    "role": "co-parent"
  },
  "member-uuid-ghi": {
    "familyId": "family-uuid-B",
    "role": "manager"
  }
}
```

**`MemberIndex` class:**

```typescript
// src/identity/member-index.ts
export interface MemberIndexEntry {
  familyId: string;
  role: Role;
}

export class MemberIndex {
  private indexPath: string;

  constructor() {
    this.indexPath = join(dataDir, "member-index.json");
  }

  async get(memberId: string): Promise<MemberIndexEntry | null> {
    const index = await this.load();
    return index[memberId] ?? null;
  }

  async set(memberId: string, familyId: string, role: Role): Promise<void> {
    const index = await this.load();
    index[memberId] = { familyId, role };
    await this.save(index);
  }

  async remove(memberId: string): Promise<void> {
    const index = await this.load();
    delete index[memberId];
    await this.save(index);
  }

  async list(): Promise<Record<string, MemberIndexEntry>> {
    return this.load();
  }

  private async load(): Promise<Record<string, MemberIndexEntry>> {
    try {
      const raw = await readFile(this.indexPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private async save(index: Record<string, MemberIndexEntry>): Promise<void> {
    const tmp = this.indexPath + `.tmp.${randomUUID().slice(0, 8)}`;
    await writeFile(tmp, JSON.stringify(index, null, 2), { mode: 0o600 });
    await rename(tmp, this.indexPath);
  }
}
```

**Why not embed the index inside each family's `members.json`:**

Requires scanning every family's `members.json` on every request to find which family a `memberId` belongs to. O(n) family loads per request, unbounded. The global index is O(1) — one file read.

**Concurrency:**

Atomic rename pattern (already used in Sprint 1 `state.ts`) prevents partial writes during concurrent updates. One caller's write-then-rename is atomic at the filesystem level. Worst case under heavy contention is a last-write-wins race — acceptable because member-index updates happen only on Member creation/removal, not on hot paths.

### 3. `resolveCallerRole` — Rewrite

**Priority chain (Sprint 2.9):**

```typescript
async function resolveCallerRole(
  args: Record<string, unknown>,
  headers?: IncomingHttpHeaders,
  urlQuery?: ParsedQs
): Promise<CallerContext | null> {
  const state = new StateManager();
  const index = new MemberIndex();

  // Priority 1: X-Member-Id header (Sprint 2 backward compat, HTTP only)
  if (headers?.['x-member-id']) {
    const memberId = String(headers['x-member-id']);
    const entry = await index.get(memberId);
    if (entry) {
      const member = await state.loadMember(entry.familyId, memberId);
      if (member?.active) {
        return {
          role: entry.role,
          memberId,
          familyId: entry.familyId,
          childName: member.childName,
        };
      }
    }
  }

  // Priority 2: ?setup=CODE URL query (Sprint 2.9 new — HTTP only)
  if (urlQuery?.setup) {
    const code = String(urlQuery.setup);
    const setupCodes = new SetupCodeStore();
    const resolved = await setupCodes.resolve(code);
    if (resolved) {
      const entry = await index.get(resolved.memberId);
      if (entry) {
        const member = await state.loadMember(entry.familyId, resolved.memberId);
        if (member?.active) {
          return {
            role: entry.role,
            memberId: resolved.memberId,
            familyId: entry.familyId,
            childName: member.childName,
          };
        }
      }
    }
  }

  // Priority 3: _callerId arg (Sprint 1/2 backward compat, test mode)
  if (typeof args._callerId === "string") {
    const entry = await index.get(args._callerId);
    if (entry) {
      const member = await state.loadMember(entry.familyId, args._callerId);
      if (member?.active) {
        return {
          role: entry.role,
          memberId: args._callerId,
          familyId: entry.familyId,
          childName: member.childName,
        };
      }
    }
  }

  // Priority 4: explicit _callerRole + _familyId (test mode only)
  if (typeof args._callerRole === "string" && typeof args._familyId === "string") {
    return {
      role: args._callerRole as Role,
      memberId: (args._callerId as string) || "test-user",
      familyId: args._familyId,
    };
  }

  // Priority 5: Legacy single-family fallback (transitional — Decision 7)
  const families = await state.listFamilies();
  if (families.length === 1) {
    console.error("[legacy] Request without identity resolved to sole family. Users should update MCP config with setup code.");
    return {
      role: "manager",
      memberId: "manager",
      familyId: families[0],
    };
  }

  // Default: null (NOT Manager)
  return null;
}
```

**Sprint 3.0 will prepend Priority 0 — session tokens** — when the verify page ships. Setup codes drop to Priority 2; both remain valid.

### 4. `configure-policy` Bootstrap Path

**When caller is null (new user):**

```typescript
// Pseudocode
async function handleConfigurePolicy(args, caller): Promise<ToolResponse> {
  if (!caller) {
    // New user bootstrap
    const familyId = randomUUID();
    const memberId = randomUUID();

    // Create per-family encryption key
    const keyManager = new FamilyKeyManager();
    const familyKey = keyManager.generateFamilyKey(familyId);

    // Initialize family directory + OWS wallets
    const state = new StateManager();
    await state.createFamilyDir(familyId);
    const familyConfig = buildFamilyConfigFromArgs(args, familyId);
    const setup = new WalletSetup();
    await setup.initializeFamily(familyConfig, familyKey);
    await state.saveFamilyConfig(familyId, familyConfig);

    // Create Manager Member
    const member: Member = {
      id: memberId,
      name: args.familyName + " Manager",
      role: "manager",
      joinedAt: new Date().toISOString(),
      active: true,
    };
    await state.addMember(familyId, member);

    // Register in member-index
    const index = new MemberIndex();
    await index.set(memberId, familyId, "manager");

    // Generate setup code
    const setupCodes = new SetupCodeStore();
    const code = await setupCodes.issue(memberId);

    return {
      success: true,
      familyId,
      memberId,
      setupCode: code,
      mcpUrl: `${process.env.ALLOWANCE_AGENT_URL}/mcp?setup=${code}`,
      instructions: "Your family is set up. To continue using AllowanceAgent, update your MCP connector URL to include the setup code. Open Claude settings → Connectors → AllowanceAgent → edit URL → paste the URL above. The setup code expires in 48 hours.",
    };
  }

  // Existing user: update their family (current Sprint 2.75 behavior, now scoped)
  return updateExistingFamily(args, caller);
}
```

**When caller is identified (existing Manager updating their family):**

Same as Sprint 2.75 behavior, with every `state.*` call scoped by `caller.familyId`.

### 5. Setup Code Mechanism

**Setup code format:** `SETUP-XXXX-XXXX` — two groups of 4 alphanumeric chars (no 0/O/1/I confusion). Total entropy ~37 bits. Expires after 48 hours. Single-use by default; optionally multi-use for admins.

**Storage — `data/setup-codes.json`:**

```json
{
  "SETUP-4K7W-X2P9": {
    "memberId": "uuid-abc",
    "createdAt": "2026-04-24T...",
    "expiresAt": "2026-04-26T...",
    "used": false,
    "usedAt": null
  }
}
```

**Used flag:**

Setup codes do NOT become single-use on first redemption in Sprint 2.9. The MCP connector URL embeds the code permanently — every request is effectively "using" it. Marking it used on first request would break every subsequent request from the same client.

Instead: setup codes are "valid until expiry, then revoked on expiry OR on explicit revocation via `manage-members`." When a Member is removed via `manage-members`, any active setup code for that memberId is invalidated. When a Member changes role, a new setup code is issued and the old one invalidated.

**Privacy posture:**

- Setup codes are short — treat them as bearer credentials
- Log truncated only: `SETUP-****-X2P9`
- Never include full setup code in audit log details
- Never echo setup code in tool responses except during issuance (one-time display in `configure-policy` success message and in invite acceptance flow)
- Setup codes stored with file permissions 0o600

### 6. Migration — One-Way, Atomic, Sentinel-Protected

**Detection:** On boot, check:
- Is `data/family-config.json` present? (Legacy indicator)
- Is `data/families/` directory absent? (Not yet migrated)
- Is `data/.migrated-2.9` sentinel absent? (Migration not marked complete)

If all three are true, run migration.

**Migration steps:**

```typescript
async function migrateToMultiTenant(): Promise<void> {
  console.error("[migrate] Sprint 2.75 → 2.9 migration starting");

  // Step 1: Verify legacy data is readable before touching anything
  const legacyConfig = await readFile(join(dataDir, "family-config.json"), "utf-8");
  const parsed = JSON.parse(legacyConfig);

  // Use existing familyId if present (Sprint 2.75 already added this field)
  const familyId = parsed.familyId ?? randomUUID();

  // Step 2: Create family directory
  const familyDir = join(dataDir, "families", familyId);
  await mkdir(familyDir, { recursive: true, mode: 0o700 });

  // Step 3: Move legacy files into family directory
  const legacyFiles = [
    "family-config.json",
    "members.json",
    "invites.json",
    "streaks.json",
    "savings.json",
    "achievements.json",
    "audit-log.json",
    "fitbit-tokens.json",
  ];

  for (const file of legacyFiles) {
    const src = join(dataDir, file);
    const dst = join(familyDir, file);
    if (existsSync(src)) {
      await rename(src, dst);  // Atomic move
      console.error(`[migrate] Moved ${file} → families/${familyId}/${file}`);
    }
  }

  // Step 4: Build member-index from migrated members
  const membersRaw = await readFile(join(familyDir, "members.json"), "utf-8");
  const members = JSON.parse(membersRaw);
  const index = new MemberIndex();
  for (const member of members) {
    if (member.active) {
      await index.set(member.id, familyId, member.role);
    }
  }
  console.error(`[migrate] Built member-index with ${members.length} members`);

  // Step 5: Preserve family-keys.json entry — if familyId was auto-generated,
  // we already have an entry keyed by the pre-Sprint-2.75 familyId. Check and rename.
  // (Sprint 2.75 already generates familyId during configure-policy, so this
  // should already be in sync in most cases.)

  // Step 6: Write sentinel
  await writeFile(join(dataDir, ".migrated-2.9"), new Date().toISOString());
  console.error("[migrate] Migration complete");
}
```

**Rollback:**

If any step fails, migration throws. The server refuses to start with a clear error. Operator investigates offline. Files already moved into `families/{id}/` remain there; operator can either:
- Move them back to root and restart (forces re-migration)
- Fix the underlying issue and restart (migration resumes from consistent state)

**The migration is designed to be rerunnable.** If it fails halfway and some files are already moved, the next run will `rename` the remaining files successfully. `rename` is a no-op if source and dest are the same (already moved).

### 7. Legacy Single-Family Fallback — Transitional

**When it activates:**

`resolveCallerRole` returns null for unidentified callers by default (Priority 5 in chain above). Before falling through to null, check:

```typescript
const families = await state.listFamilies();
if (families.length === 1) {
  // Only one family on the server — must be the migrated legacy family
  console.error("[legacy] Unidentified request resolved to sole family");
  return {
    role: "manager",
    memberId: "manager",
    familyId: families[0],
  };
}
```

**Why:** Juan's existing Claude Desktop connection is configured as `https://allowme.dev/mcp` with no setup code. Wife's Claude Mobile same. Breaking their access on Sprint 2.9 deploy would be operationally bad and signal instability just before Sprint 3.0 demo.

**When it deactivates:**

Automatically. The moment a second family is created (`listFamilies().length === 2`), the fallback stops matching. All unidentified requests now return null. Juan and wife MUST update their MCP configs with setup codes at that point — or the verify page flow in Sprint 3.0 replaces this entirely.

**Deprecation path:**

Log `[legacy]` warning every request that hits this fallback. After Sprint 3.0 ships and users have migrated to session tokens or setup codes, the fallback can be removed entirely. Target removal: Sprint 3.5.

### 8. Fitbit Token Store — Family Scoping

**Current state:** `data/fitbit-tokens.json` is keyed by child name (lowercased). No family scoping.

**Problem:** If Family A has a child "Maya" and Family B also has a child "Maya," their Fitbit tokens collide.

**Solution:** Move to `data/families/{familyId}/fitbit-tokens.json`. Constructor takes `familyId`:

```typescript
export class FitbitTokenStore {
  private familyId: string;
  private tokenFile: string;

  constructor(familyId: string, masterKey?: Buffer) {
    this.familyId = familyId;
    this.tokenFile = join(dataDir, "families", familyId, "fitbit-tokens.json");
    this.masterKey = masterKey ?? resolveMasterKey();
  }
  // ... rest unchanged
}
```

`FitbitClient` constructor also takes `familyId`, passes to token store.

`connect-fitbit` tool handler passes `caller.familyId` when instantiating `FitbitClient`.

### 9. Test Helper — `createTestFamily`

**Purpose:** Every existing Sprint 2.75 test that creates a `StateManager` needs the same bootstrap: create a family, create a Manager, set up the member-index. A helper removes boilerplate from 50+ tests.

**API:**

```typescript
// tests/helpers/family.ts
export interface TestFamily {
  familyId: string;
  memberId: string;
  managerContext: CallerContext;
}

export async function createTestFamily(overrides?: Partial<FamilyConfig>): Promise<TestFamily> {
  const familyId = overrides?.familyId ?? randomUUID();
  const memberId = randomUUID();

  const state = new StateManager();
  await state.createFamilyDir(familyId);

  const config: FamilyConfig = {
    familyId,
    familyName: overrides?.familyName ?? "Test Family",
    children: overrides?.children ?? [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    chainId: overrides?.chainId ?? "eip155:84532",
    usdcAddress: overrides?.usdcAddress ?? USDC.BASE_SEPOLIA,
  };
  await state.saveFamilyConfig(familyId, config);

  const manager: Member = {
    id: memberId,
    name: "Test Manager",
    role: "manager",
    joinedAt: new Date().toISOString(),
    active: true,
  };
  await state.addMember(familyId, manager);

  const index = new MemberIndex();
  await index.set(memberId, familyId, "manager");

  return {
    familyId,
    memberId,
    managerContext: {
      role: "manager",
      memberId,
      familyId,
    },
  };
}
```

**Usage in existing tests:**

Before:
```typescript
const state = new StateManager();
await state.saveFamilyConfig({ familyName: "Garcia", children: [...] });
// test body
```

After:
```typescript
const { familyId, managerContext } = await createTestFamily({
  familyName: "Garcia",
  children: [...],
});
// test body — all state calls now take familyId
```

One-line replacement. No assertion changes.

### 10. Sprint 3.0 Handoff

After Sprint 2.9 ships, Sprint 3.0's entry point is clean:

- `CallerContext` already has `familyId` — World ID verification binds a nullifier to a `memberId` which is already bound to a `familyId` via `member-index.json`
- Session tokens become priority 0 in `resolveCallerRole`, pushing setup codes to priority 2
- Nullifier uniqueness enforcement (one human per Manager role per server) is architecturally meaningful because "Manager role per family" is actually enforced
- Verify page's `/api/worldid/verify` endpoint receives an optional `invite_code` param; on success, it creates a Member under the invite's `familyId`, issues a session token, and the handoff to Claude already has a fully-scoped `CallerContext`

No architectural changes needed in Sprint 3.0 to accommodate multi-tenancy. It just works because Sprint 2.9 did the groundwork.

---

## Phase 0.5: Spike Validation

### Spike 1: Migration against copy of production data

**Question:** Does the migration script correctly move the existing Isaac family data into `data/families/{uuid}/` without corrupting any state, losing any wallet access, or breaking any existing tests?

**Rationale:** The Isaac family is the real test case. If migration breaks Juan's data, Sprint 2.9 is a regression, not an improvement.

**Steps:**
1. Pull a copy of production `data/` from Railway volume to local machine
2. Run Sprint 2.9 migration against the local copy
3. Verify directory structure: `data/families/{uuid}/family-config.json` etc. exist
4. Verify `member-index.json` contains entries for Juan (Manager) and Wife (Co-parent)
5. Verify `family-keys.json` entry for the familyId still decrypts wallets correctly
6. Run full Sprint 2.75 test suite against migrated data — all 187 must pass
7. Start the Sprint 2.9 server against migrated data. Test all 12 tools work for the existing family via the legacy single-family fallback.

**Expected result:** All assertions pass. If any fail, fix migration before deploy.

**Spike status:** 🔜 Must run before deploy to Railway. ~45 minutes.

### Spike 2: Setup code flow end-to-end through MCP connector

**Question:** Does appending `?setup=SETUP-XXXX-XXXX` to the MCP connector URL in Claude Desktop actually propagate to the HTTP transport layer, and does the server correctly parse and resolve it?

**Rationale:** If Claude Desktop strips query params from MCP URLs, the entire setup-code mechanism doesn't work.

**Steps:**
1. Manually edit Claude Desktop MCP config to use `https://allowme.dev/mcp?setup=SETUP-TEST-ABCD` (with a pre-seeded setup code in `data/setup-codes.json`)
2. Restart Claude Desktop
3. Server logs show the request arriving with the query param intact
4. `resolveCallerRole` returns the correct `CallerContext` for the pre-seeded memberId
5. Tool calls (e.g., `check-progress`) succeed with the correct family scope

**Expected result:** Query param propagates, resolution works.

**If it fails:** Claude Desktop may use a custom protocol for MCP connections that strips query params. Fallback: investigate `mcp-remote` package (which is the actual transport Claude Desktop uses for remote MCP) — it may support headers via a different mechanism.

**Spike status:** 🔜 Must run before implementing M2.6. ~30 minutes.

### Spike 3: Concurrent family creation race

**Question:** If two `configure-policy` calls arrive simultaneously from two unidentified users, do both families get created correctly without corrupting `member-index.json`?

**Rationale:** Under load, multiple new-user bootstraps could race on `member-index.json` writes. Atomic rename should handle it, but verify.

**Steps:**
1. Concurrent `Promise.all` with 10 `configure-policy` calls from 10 different "users"
2. Assert 10 distinct `familyId` values
3. Assert `member-index.json` contains 10 distinct entries
4. Assert each family directory has the correct members

**Expected result:** All 10 families created cleanly. No corruption.

**Spike status:** 🟡 Nice to have. Atomic rename pattern should work; explicit test is defense-in-depth. Skip if time-constrained.

---

## Open Questions

| Question | Status | Resolution |
|----------|--------|------------|
| Does Claude Desktop strip query params from MCP server URLs? | 🔜 Spike 2 | Must validate before committing to setup-code approach. If stripped, pivot to header-based auth (requires a wrapper proxy). |
| Should setup codes be single-use or multi-use? | ✅ Resolved | Multi-use, revocable. Single-use breaks the "embed in URL" pattern. Revocation happens on Member removal or role change. |
| How are existing setup codes handled after Sprint 3.0 ships? | ✅ Resolved | Sprint 3.0 session tokens become priority 0 in `resolveCallerRole`; setup codes remain at priority 2. Both paths coexist. |
| What if `member-index.json` gets out of sync with `families/{id}/members.json`? | ✅ Resolved | Rebuild command: `npx tsx src/scripts/rebuild-member-index.ts` scans all family directories and reconstructs the index. Manual intervention only if corruption detected. |
| Do we need a per-family master key instead of server-wide? | ✅ Resolved | No. Per-family keys already derive from the server-wide master key via AES-256-GCM encryption. Per-family isolation is cryptographic via `family-keys.json`; server-wide master key is the root of trust. This is Sprint 2.75's architecture, unchanged. |
| What about cross-family operations (e.g., Manager helping another family)? | ✅ Resolved | Out of scope for Sprint 2.9. Architecturally supported: one person can be a Member of multiple families (multiple entries in `member-index.json` with different `memberId`s and different `familyId`s). Sprint 3.0 action namespaces enable legitimate cross-role use. |
| Should we delete the legacy single-family fallback immediately? | ✅ Resolved | No. Transition requires it. Deactivates automatically on second family creation. Can be removed in Sprint 3.5 after all users have migrated to session tokens or setup codes. |
| How do operators manage deployments (e.g., delete a test family)? | ✅ Resolved | CLI scripts in `src/scripts/`. Not exposed as MCP tools (out of scope). Manual ops via Railway SSH. |
| What if the migration fails on existing data? | ✅ Resolved | Migration is rerunnable. Partial state is safe. If irrecoverable, revert deploy to Sprint 2.75 code and investigate from Railway volume snapshot. |
| Does the Fitbit token store move break existing users' Fitbit connections? | ✅ Resolved | Migration moves `fitbit-tokens.json` into the family directory. Existing tokens preserved. FitbitClient constructor change is backward compatible (familyId added as required param in all call sites during M3 plumbing). |
| Is there a chicken-and-egg problem with setup codes in `configure-policy`? | ✅ Resolved | No. `configure-policy` can be called with null caller (Priority 5 returns null for unknown users except legacy single-family). The null case is the only one that triggers new-family bootstrap. Setup code is issued AFTER family + Member creation, so the caller doesn't need identity to start. |