# Plan — `view-policy` MCP tool

**Sprint:** TBD (proposed: 3.1.0)
**Component:** AllowanceAgent MCP server
**Status:** Planning
**Owner:** Juan
**Depends on:** Sprint 3.0.2 (authorizedDestinations on configure-policy)
**Blocks:** future sprint introducing `expectedPolicyVersion` optimistic-concurrency guard on `configure-policy`

---

## Scope

### In scope
- New MCP tool `view-policy` registered on the StreamableHTTPServerTransport
- Read path through the existing decryption layer (no new crypto)
- Role-based response stripping for `manager | co-parent | advisor | family | learner`
- Section filter (`all | summary | children | destinations | learning-goals`)
- `childName` scoping
- `includeWallets` toggle
- Destination provenance discriminator (`source: "force-added" | "configured"`)
- `policyVersion` field added to the stored policy document (init at 1 for existing families on first read; increment on every `configure-policy` write going forward)
- Cache layer: 60s TTL, invalidated on policy write
- Error taxonomy: `FAMILY_NOT_FOUND`, `INSUFFICIENT_ROLE`, `CHILD_NOT_FOUND`, `POLICY_NOT_INITIALIZED` (informational; not thrown — returns shell)

### Out of scope
- Pending achievement queue (lives on `check-progress`, confirmed)
- Optimistic-concurrency enforcement on `configure-policy` (separate sprint; this sprint only ships the version field)
- Mutation paths
- Multi-instance cache coordination (Railway is single-instance today)

---

## Implementation steps

Sequenced. Each step lands as a discrete commit; Evaluator agent should be able to verify acceptance per step.

### Step 1 — Add `policyVersion` to storage schema
- File: `src/storage/familyPolicy.ts` (or equivalent — the module that owns the encrypted blob shape)
- Add `policyVersion: number` to the policy document type
- Backfill: on first read of any family lacking the field, default to `1`. Do not migrate eagerly; write the field on the next `configure-policy` call.
- Add `policyVersion++` to the existing `configure-policy` write path

### Step 2 — Tag destinations with provenance
- File: `src/storage/familyPolicy.ts` (or the destination resolver)
- On read, hydrate flat `string[]` into `Array<{ address, label, source }>` by cross-referencing:
  - Manager wallet → `label: "manager-wallet", source: "force-added"`
  - Each child's wallet → `label: "child:<name>", source: "force-added"`
  - Treasury / savings-vault / gift-fund → `label: "savings-vault" | "gift-fund", source: "force-added"` (if present in the configured set)
  - Everything else → `label: "custom", source: "configured"`
- Storage stays flat string[] for backward compat; hydration is read-side only

### Step 3 — Implement `view-policy` tool handler
- File: `src/mcp/tools/viewPolicy.ts` (new)
- Input schema (see "API contract" below)
- Resolve family via `_familyId`; decrypt once
- Apply role filter (Step 4)
- Apply section filter
- Apply `childName` filter if set
- Apply `includeWallets` toggle to children[] only (NOT destinations — addresses are the point)
- Return wrapped response

### Step 4 — Role-based stripping
- File: `src/mcp/tools/viewPolicy.ts` (helper) or `src/auth/roleFilter.ts` (new)
- Implement the access control matrix from research.md:

| Role | children | destinations | learning-goals | summary |
|---|---|---|---|---|
| manager | full | full | full | full |
| co-parent | full | full | full | full |
| advisor | full (no wallets) | full | full | full |
| family | own child only (if associated) | hidden | hidden | full |
| learner | own record only | hidden | own goals only | scoped |

- Forbidden (role, section) combinations return `INSUFFICIENT_ROLE` error, not empty arrays
- "Own child" for `family` / `learner` resolved via the existing member→child binding in the roster

### Step 5 — Register tool on MCP server
- File: `src/mcp/server.ts` (or equivalent registration site)
- Register `view-policy` alongside existing tools
- Tool description should mirror the ALLOWME pattern: brief usage, manager/role notes inline

### Step 6 — Cache layer
- File: `src/cache/policyCache.ts` (new) or inline if cache infra already exists
- LRU or simple Map keyed by `familyId`
- TTL 60s
- Invalidate on `configure-policy` write inside same handler
- Cache stores the *decrypted, pre-role-filter* policy document. Role filter runs on each call. Rationale: filtering is cheap; decryption is the expensive operation worth caching.

### Step 7 — Wire into tool discovery
- Ensure tool surfaces in `tool_search` for the canonical queries: "view policy", "list destinations", "show allowlist", "family configuration"

### Step 8 — Update changelog / README
- File: `CHANGELOG.md`, `README.md`
- Note: new tool, additive only, no breaking changes to existing surface

---

## API contract

### Tool name
`view-policy`

### Input schema
```ts
{
  _callerId?: string;        // internal
  _callerRole?: string;      // internal, role override for test mode
  _familyId?: string;        // internal, test mode
  section?: "all" | "summary" | "children" | "destinations" | "learning-goals";  // default "all"
  childName?: string;        // optional scope
  includeWallets?: boolean;  // default true
}
```

### Output schema
```ts
{
  success: true,
  familyName: string,
  familyId: string,
  network: "Base Sepolia (testnet)" | "Base mainnet",
  updatedAt: string,         // ISO-8601
  policyVersion: number,

  children: Array<{
    name: string,
    walletAddress?: string,                          // omitted if includeWallets=false OR role lacks access
    walletProvenance: "byo" | "ows-managed",
    weeklyBudgetUsd: number,
    savingsPercent: number,
    categories: Array<{ name: string, pct: number }>,
    learningGoals: Array<{
      topic: string,
      category: string,
      deadline?: string,
      subgoals?: Array<{ topic: string }>,
    }>,
  }>,

  authorizedDestinations: Array<{
    address: string,
    label?: "manager-wallet" | "child:<name>" | "savings-vault" | "gift-fund" | "custom",
    source: "force-added" | "configured",
  }>,

  summary: {
    childCount: number,
    totalWeeklyBudgetUsd: number,
    destinationCount: number,
    learningGoalCount: number,
    activeGoalCount: number,
  },

  message: string,
}
```

### Error envelope
```ts
{
  success: false,
  error: "FAMILY_NOT_FOUND" | "INSUFFICIENT_ROLE" | "CHILD_NOT_FOUND",
  message: string,
  // CHILD_NOT_FOUND: include validChildNames?: string[] (only for roles that can see siblings)
}
```

---

## Acceptance criteria

1. Manager caller with default params receives full policy including all sections, all children, all destinations with provenance tags
2. Every (role × section) cell of the access control matrix returns the expected shape; forbidden cells return `INSUFFICIENT_ROLE`
3. `childName` scopes both `children[]` and `learning-goals[]`; non-existent child returns `CHILD_NOT_FOUND` (with `validChildNames` only for authorized roles)
4. `includeWallets: false` strips `children[].walletAddress` only; destinations remain intact
5. Destination provenance correctly tags manager wallet, each child wallet, and treasury sub-wallets (treasury / savings-vault / gift-fund) as `force-added`; everything else as `configured`
6. `policyVersion` increments by exactly 1 after each `configure-policy` write
7. Two consecutive `view-policy` calls with no intervening write return identical payloads (including `policyVersion`)
8. Family with no policy yet returns `{ success: true, policyVersion: 0, children: [], ... }` shell — does NOT error
9. Cache TTL: writes invalidate immediately within the same process; reads within 60s of last read hit cache
10. Tool surfaces in `tool_search` for the canonical queries listed in Step 7

---

## Test plan summary

Full test enumeration goes in `test.md`. High-level coverage targets:

- Smoke: defaults, section filters, childName scoping, includeWallets toggle
- Access control: full matrix (5 roles × 4 sections + summary = 25 cells)
- Provenance: every label kind correctly tagged
- Policy version: monotonic, increments on writes, stable across reads
- Cache: hit/miss behavior, write invalidation
- Edge: empty allowlist, POLICY_NOT_INITIALIZED, learner enumerating siblings, advisor accessing wallets (should be stripped)
- Determinism: same input → same output across consecutive calls

---

## Dependencies

- Sprint 3.0.2 must be deployed (authorizedDestinations storage)
- No new external deps; uses existing MCP SDK StreamableHTTPServerTransport + storage layer

---

## Rollback

Tool is purely additive. To roll back:
1. Unregister `view-policy` from the tool registry
2. Leave `policyVersion` field in storage (harmless if unused)
3. Leave destination provenance hydration in place (read-side only, no storage change)

No data migration required either direction.

---

## Estimated effort

- Step 1 (policyVersion): 30 min
- Step 2 (provenance hydration): 1h
- Step 3 (tool handler): 2h
- Step 4 (role filter): 2h
- Step 5–6 (registration + cache): 1h
- Step 7–8 (discovery + docs): 30 min
- Tests (per test.md, separately scoped): ~3h

**Total implementation:** ~7h dev + 3h tests = 1 focused day