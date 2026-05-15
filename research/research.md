# Research — `view-policy` MCP tool (Sprint 3.0.6 / 3.1.0 candidate)

**Sprint type:** Backend MCP tool — adds read counterpart to Sprint 3.0.2's `configure-policy` allowlist write path.
**Depends on:** Sprint 3.0.2 (`authorizedDestinations`), Sprint 3.0.5 (verify-page bootstrap form — for the live data this tool will return).
**Source material:** [`view-policy-sprint/research.md`](../view-policy-sprint/research.md), [`view-policy-sprint/plan.md`](../view-policy-sprint/plan.md) — Windsurf-era, read-only.

---

## Relevance Summary

Sprint 3.0.2 shipped `authorizedDestinations` on `configure-policy` (the write path) plus enforcement in `distribute-allowance` and `release-savings`. The allowlist is now load-bearing for every USDC outflow on the child-wallet leg. **No read path exists.** A caller (Claude human, A2A agent, dashboard) cannot answer "what is currently configured?" without one of:

1. Replaying the last `configure-policy` call from memory (lossy, stale)
2. Risking a clobbering write to "look at it" (defeats the point of read-only inspection)
3. Reading the encrypted blob directly out of Railway (not exposed)

The data is materialized and decrypted per request server-side via `StateManager.loadFamilyConfig`. What's missing is a typed read endpoint with role-aware filtering, section scoping, and child scoping. This sprint adds the read path, ships `policyVersion` as a foothold for a future optimistic-concurrency guard on `configure-policy`, and surfaces destination provenance (force-added vs configured) — the single discriminator UI needs to render "Remove" affordances safely.

This is purely additive surface area: one new tool, one new optional schema field, one read-side hydration helper. No mutation, no breaking change to existing tools.

---

## Actionable Insights

### D1 — Tool home: `src/tools/view-policy.ts`

The codebase has a flat one-file-per-tool tree at [`src/tools/`](../src/tools/) (13 existing tools). The Windsurf plan's proposed `src/mcp/tools/viewPolicy.ts` is wrong; the canonical path is `src/tools/view-policy.ts` (kebab-case per existing convention).

### D2 — Registration site: [`src/index.ts:44–51`](../src/index.ts)

MCP tools are registered via `registerXxxTool(server)` calls in `src/index.ts` after the `McpServer` is constructed. Adding `view-policy` means: new `registerViewPolicyTool` export from the new file, plus one `registerViewPolicyTool(server)` line in `src/index.ts`. No tool registry; flat imports. The Windsurf plan's Step 7 ("tool discovery wiring") is essentially trivial.

### D3 — RBAC plumbing: [`src/middleware/access-control.ts`](../src/middleware/access-control.ts)

Every existing tool uses `withAccessControl(toolName, handler)` to enforce role gating before the handler runs. The pattern is:

```ts
withAccessControl("view-policy", async (args, caller) => {
  if (!caller) return buildNoIdentityResponse("view-policy");
  // ...role-aware filtering inside handler...
})
```

Tool-level access is encoded in [`src/constants.ts:59`](../src/constants.ts) `ROLE_TOOL_ACCESS`. Section-level filtering (which slices of the response a role sees) lives inside the handler — there's no existing helper for it; we'll add one (D7).

### D4 — Role plumbing: `caller.role` + `caller.childName` (learner-only)

`CallerContext` carries `role`, `memberId`, `familyId`, and `childName?`. The `childName` is **populated only for learners** today (see `getChildScope` at [`src/middleware/access-control.ts:253–260`](../src/middleware/access-control.ts)). The Windsurf plan's "family role sees own child only" proposal **does not have a precedent** — see ⚠️ OQ5 below.

### D5 — `policyVersion` home: [`src/schemas.ts:72–84`](../src/schemas.ts) `FamilyConfigSchema`

Add `policyVersion: z.number().int().nonnegative().default(0)` to `FamilyConfigSchema`. Zod default applies on load (Sprint 3.0.2 lazy-migration pattern at [`src/engine/state.ts:148–159`](../src/engine/state.ts)) — pre-3.0.6 family configs hydrate with `policyVersion: 0`. First `configure-policy` write after deploy increments to `1`. No migration script needed.

**Rationale for `default(0)`** (not `default(1)` as the Windsurf plan proposed): a freshly-loaded pre-existing family that has NEVER been through a 3.0.6+ write should be distinguishable from a family that's been through exactly one write. `0` means "predates the version counter"; `1+` means "has been through the new write path". The bootstrap (W2) increments to `1` on its first call.

### D6 — Destination provenance: derivable on read, no storage change

The Windsurf plan's `source: "force-added" | "configured"` is correct. Derivation:

- Force-added set = `{ managerWalletAddressLower } ∪ { c.walletAddress.toLowerCase() for c in family.children if c.walletAddress }`
- For each `addr` in `family.authorizedDestinations`:
  - If `addr ∈ force-added set` → `source: "force-added"`, `label: "manager-wallet"` or `"child:<name>"`
  - Else → `source: "configured"`, `label: "custom"`

Manager wallet is found via `state.loadMembers(familyId)` filtered to `role === "manager"` and reading the member's wallet address. (Members carry walletAddress per Sprint 3.0 v4 SIWE work.)

**Drop the Windsurf plan's `savings-vault` / `gift-fund` labels.** Internal vaults are exempt from `authorizedDestinations` by construction (Sprint 3.0.2 enforcement applies only to the child-wallet leg, not internal transfers). These addresses never appear in the array, so a label for them is dead code. The label union is `"manager-wallet" | "child:<name>" | "custom"` only.

### D7 — Role-based filter helper: new file [`src/middleware/policy-view-filter.ts`](../src/middleware/policy-view-filter.ts)

Self-contained pure function: `filterPolicyForRole(fullPolicy, caller, args) → filteredPolicy | { error: "INSUFFICIENT_ROLE" | "CHILD_NOT_FOUND" }`. Tested independently from the tool handler. Keeps the 5×4 access-control matrix in one place where the test matrix can iterate over every (role × section) cell.

### D8 — Cache layer: simple Map, 60s TTL, in-process

The Windsurf plan's `src/cache/policyCache.ts` is fine as-named. Stores decrypted, pre-filter `FamilyConfig` keyed by `familyId`. Invalidation: `configure-policy`'s write path (post `state.saveFamilyConfig`) calls `policyCache.invalidate(familyId)` synchronously. Cache is single-process — Railway is single-instance per [`view-policy-sprint/plan.md:30`](../view-policy-sprint/plan.md). When/if Railway becomes multi-instance, swap the Map for Redis; the invalidation API stays the same.

### D9 — `POLICY_NOT_INITIALIZED` returns a shell, not an error

Following the Windsurf research §"Design decision 4": a family with no policy yet returns `{ success: true, policyVersion: 0, familyName: "", children: [], authorizedDestinations: [], summary: {...zero-valued...}, message: "No policy configured yet." }`. Same response shape as a populated read, just zero-valued. Reserved error states: `FAMILY_NOT_FOUND` (caller is authenticated but `state.loadFamilyConfig` returns null — a structural state-store break), `INSUFFICIENT_ROLE` (forbidden role × section cell), `CHILD_NOT_FOUND` (`childName` arg doesn't match any child the caller can see).

### D10 — Test infra precedent: [`tests/verify-routes.test.ts`](../tests/verify-routes.test.ts) pattern

Sprint 3.0.5 used `siweExchange → /api/auth/verify → bootstrap via /api/configure-family → load persisted FamilyConfig via StateManager` as the E2E pattern. For view-policy tests, the lighter precedent is [`tests/policy-engine.test.ts`](../tests/policy-engine.test.ts) — calls tools directly with `{ _callerRole, _callerId, _familyId }` test-mode args. The 5×4 access-control matrix tests will use this pattern (20 cells × 1-2 assertions each = ~25-30 new tests just for the matrix).

---

## Open Questions

The following ⚠️ items resolve in either the spike phase or contract negotiation:

### ⚠️ OQ1 — Advisor role: sees wallet addresses?

Today advisor's `ROLE_TOOL_ACCESS` is `[query-audit-log, accept-invite]` only — advisor cannot call any other tool. The Windsurf research §"Open questions Q1" proposes: advisor sees full destinations but NO wallet addresses on children. But if advisor is a CPA reconciling on-chain flows, they NEED wallet addresses to map destinations back to children. **User decision** — contract negotiation. Spike-resolvable: NO (policy decision, not code-derivable).

### ⚠️ OQ2 — Family role: sees destinations?

Today family's `ROLE_TOOL_ACCESS` is `[check-progress, check-goals, accept-invite]` — they see all children's goals + progress. Windsurf proposes: family sees full `summary` but `destinations: hidden`. **Likely correct** — family role is the grandparent/gift-contributor pattern; they shouldn't care about custody plumbing. **User decision** — contract negotiation. Spike-resolvable: NO.

### ⚠️ OQ3 — `updatedAt` granularity: top-level only? — RESOLVED INLINE

`FamilyConfigSchema.updatedAt` already exists ([`src/schemas.ts:77`](../src/schemas.ts)) — top-level ISO datetime updated on every `state.saveFamilyConfig`. Per-section requires storage changes (out of scope per the source plan). **Accept Windsurf proposal: top-level only.** No ⚠️.

### ⚠️ OQ4 — Tool-level access expansion: who can call `view-policy` at all?

**Critical observation not raised in Windsurf research:** `configure-policy` itself is Manager-only in `ROLE_TOOL_ACCESS` today. Adding `view-policy` to a role's list grants that role brand-new config-visibility. The Windsurf matrix proposes adding `view-policy` to ALL 5 roles (with section-level stripping). **A tighter v1** would be: Manager + Co-parent + Advisor only, with Family + Learner deferred to a follow-up sprint after their RBAC needs are validated by usage. **User decision** — contract negotiation. Spike-resolvable: NO.

### ⚠️ OQ5 — Family role: "own child only" — diverges from existing tools

Windsurf matrix proposes: family sees `children[]` filtered to "own child only (if associated)". But today, `check-goals` and `check-progress` let family see ALL children's data ([`src/tools/check-goals.ts:45`](../src/tools/check-goals.ts) docstring: "Managers, co-parents, and family see all children's goals"). The "own child" binding requires extending `CallerContext.childName` plumbing OR adding a Member→Child binding for the family role. **This is a behavior CHANGE, not a re-use.** Three resolutions:

- (a) Family sees ALL children's policy (consistent with check-goals/check-progress)
- (b) Family sees NO children's policy (only `summary`, treating family as a "what's the shape" reader, not a "who are the kids" reader)
- (c) Add Member→Child binding for family role (new infrastructure — defer to follow-up sprint)

**User decision** — contract negotiation. Spike-resolvable: confirms the divergence is real but cannot pick the resolution.

### ⚠️ OQ6 — Internal vault labels: drop the Windsurf proposal?

The Windsurf plan §Step 2 proposes tagging `savings-vault` and `gift-fund` addresses as `source: "force-added"`. But these vaults are **exempt** from `authorizedDestinations` by Sprint 3.0.2's construction — they don't appear in the array. Labelling addresses that never appear is dead code. **Recommendation: drop the labels. Provenance label union becomes `"manager-wallet" | "child:<name>" | "custom"`.** Spike-resolvable: YES — verified by reading [`src/core/configure-family.ts:120–190`](../src/core/configure-family.ts) `buildAuthorizedDestinations` (caller + children only; no vault force-add). **Resolution: dropped.**

---

## Key Code References

| Concern | Path | Lines |
|---|---|---|
| `configure-policy` tool implementation | [`src/tools/configure-policy.ts`](../src/tools/configure-policy.ts) | 17–176 |
| `withAccessControl` wrapper | [`src/middleware/access-control.ts`](../src/middleware/access-control.ts) | 279–310 |
| `CallerContext` + `getChildScope` | [`src/middleware/access-control.ts`](../src/middleware/access-control.ts) | 23–28, 253–260 |
| `ROLE_TOOL_ACCESS` matrix | [`src/constants.ts`](../src/constants.ts) | 59–101 |
| `FamilyConfigSchema` (where `policyVersion` lands) | [`src/schemas.ts`](../src/schemas.ts) | 72–84 |
| Lazy-migration via Zod default (Sprint 3.0.2 precedent) | [`src/engine/state.ts`](../src/engine/state.ts) | 148–159 |
| `buildAuthorizedDestinations` (provenance source-of-truth) | [`src/core/configure-family.ts`](../src/core/configure-family.ts) | 120–190 |
| Tool registration (where the new line goes) | [`src/index.ts`](../src/index.ts) | 44–51 |
| Read-tool precedent (filtering + child scoping) | [`src/tools/check-goals.ts`](../src/tools/check-goals.ts) | 41–182 |
| Test-mode RBAC entry point | [`src/middleware/access-control.ts`](../src/middleware/access-control.ts) | 134–160 |

---

## Spike Results

Spike conducted inline during research (read-only code inspection, no code changes). Resolves module-layout assumptions from the Windsurf plan and OQ6.

### S1 — Module paths confirmed

The Windsurf plan referenced these paths; actual paths verified by glob + read:

| Windsurf plan said | Actual codebase | Verdict |
|---|---|---|
| `src/storage/familyPolicy.ts` | [`src/engine/state.ts`](../src/engine/state.ts) | Plan path wrong; use `state.ts` |
| `src/mcp/tools/viewPolicy.ts` | `src/tools/view-policy.ts` (new) | Plan path wrong; use kebab-case |
| `src/mcp/server.ts` | [`src/index.ts`](../src/index.ts) | Plan path wrong; tools register here |
| `src/cache/policyCache.ts` | New file at same path | Plan path acceptable |
| `src/auth/roleFilter.ts` | `src/middleware/policy-view-filter.ts` (new) | Better to live with other middleware |

### S2 — `policyVersion` lazy-migration works as-proposed

Verified the Sprint 3.0.2 lazy-migration pattern at [`src/engine/state.ts:148–159`](../src/engine/state.ts): `loadFamilyConfig` runs `FamilyConfigSchema.parse(config)` on load, which applies Zod defaults to missing fields. Adding `policyVersion: z.number().int().nonnegative().default(0)` to `FamilyConfigSchema` will make every pre-3.0.6 family hydrate with `policyVersion: 0`. The W1 backward-compat test will lock this behavior.

### S3 — Provenance derivation: read-side, zero storage change

Confirmed by reading [`src/core/configure-family.ts:120–190`](../src/core/configure-family.ts). `buildAuthorizedDestinations` only force-adds caller's wallet (line 178–184) and each child's wallet (line 168–175). Nothing else. Read-side hydration is the inverse of this: lookup manager from members, compare each `authorizedDestinations` entry against that set. **No storage migration; no schema change for provenance.**

### S4 — Manager wallet lookup at read time

Confirmed via [`src/engine/state.ts`](../src/engine/state.ts) `loadMembers(familyId)` and the Member record shape ([`src/schemas.ts`](../src/schemas.ts) Member section). Manager wallet = `members.find(m => m.role === "manager").walletAddress`. Some legacy families may have multiple managers (if a co-parent was promoted) — D6's force-added set should union ALL manager wallets, not just the first. Will encode this in W3 provenance helper.

### S5 — OQ6 dropped

Internal vault addresses (savings-vault, gift-fund) are confirmed exempt from `authorizedDestinations`. Provenance label union locked at `"manager-wallet" | "child:<name>" | "custom"`. The Windsurf vault-label proposal is dead code and excluded from this sprint's scope.

---

## Remaining ⚠️ open questions (must resolve before planning lock)

| ID | Question | Resolution path |
|---|---|---|
| OQ1 | Advisor sees children's wallet addresses? | Contract negotiation, user decision |
| OQ2 | Family sees `destinations`? | Contract negotiation, user decision |
| OQ4 | View-policy ROLE_TOOL_ACCESS scope — all 5 roles, or tighter v1 (Manager + Co-parent + Advisor)? | Contract negotiation, user decision |
| OQ5 | Family role child-scope behavior — all / none / new binding? | Contract negotiation, user decision |

All four are policy decisions, not code-derivable. They map directly to the contract's access-control criterion (the central correctness gate of the sprint). Planning proceeds with **placeholder defaults from the Windsurf research**; the contract negotiation surfaces them for explicit user sign-off.
