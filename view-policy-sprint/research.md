# Research — `view-policy` MCP tool

**Sprint:** TBD (proposed: 3.1.0, additive new tool)
**Component:** AllowanceAgent MCP server
**Status:** Research
**Owner:** Juan

---

## Context

Sprint 3.0.2 introduced the `authorizedDestinations` allowlist on `configure-policy`. That sprint shipped the write path but no read path. Today the only way to inspect the current family policy — children config, categories, savings %, learning goals, *and* the destination allowlist — is to call `configure-policy`, which is a write operation that requires the full `children` payload and risks clobbering state.

Downstream agents (verify-achievement, distribute-allowance, check-progress, check-goals, check-savings) all assume policy state exists and is correct, but none of them expose it. A caller — human in Claude.ai, downstream agent on A2A, or the user's own dashboard — cannot answer "what is currently configured?" without either replaying the last configure-policy call from memory or reading the encrypted blob directly out of Railway.

This is a gap in the MCP surface, not the storage layer. The data is already present and decrypted per request; what's missing is a typed read endpoint.

## Current state

**Existing tools that touch policy:**
- `configure-policy` — write-only. Required params: `familyName`, `children`. Optional: `authorizedDestinations`, `useTestnet`. Manager-only.
- `check-progress` — runtime state (achievements, streaks, savings balance). Not policy.
- `check-goals` — derived view of learning goals only.
- `check-savings` — savings vault state, not policy.
- `manage-members` — roster, separate from policy.

**State shape (inferred from existing tool params):**
- `familyName`
- `children[]` with name, walletAddress, walletProvenance (byo vs ows-managed), weeklyBudgetUsd, savingsPercent, categories, learningGoals
- `authorizedDestinations[]` — flat array of EVM addresses; provenance not currently distinguished (force-added vs user-configured)
- `network` (Base Sepolia testnet vs Base mainnet)

**Storage:** server-managed per-family encryption blob with auto-provisioned MASTER_KEY (Sprint pre-3.0.2 work). Read path already exists internally; not exposed.

## Requirements

### Functional
- Read-only access to family policy: children config, categories, savings %, learning goals, authorized destinations, summary aggregates
- Section filtering: `all | summary | children | destinations | learning-goals`
- Child scoping: optional `childName` filter
- Wallet redaction toggle: `includeWallets` for cleaner display modes
- Destination provenance: distinguish force-added (manager + child wallets) from user-configured entries
- Policy version: monotonic counter that increments on each `configure-policy` write

### Non-functional
- Pure read; no mutation, no MASTER_KEY rotation
- Same response envelope as other ALLOWME tools (`{ success, ..., message }`)
- Per-role response shaping (see access control matrix below)
- ~60s in-memory cache, invalidated on any configure-policy write

### Out of scope
- **Pending achievement queue stays on `check-progress`.** `view-policy` is a pure config read; runtime state (verified-but-not-yet-distributed achievements) is a separate concern and already has the right home.
- Mutation of any field.
- Encrypted-blob inspection / debug endpoints.

## Design decisions

### 1. Section filter as enum, not bitmask
Five named sections (`all | summary | children | destinations | learning-goals`) instead of `include: string[]`. Rationale: keeps the call site readable and the response shape predictable. The combinatorial explosion of bitmask filters isn't justified at this scale — agents almost always want either "everything" or one specific slice.

### 2. Destination provenance as `source: "force-added" | "configured"`
Without this discriminator, UI cannot render "Remove" affordances safely (force-added destinations can't be removed — they're invariant on the manager and child wallets). This is the single bit that pays for itself most clearly in the response shape.

### 3. `policyVersion` shipped now, enforcement later
Surface the version field in this sprint even though no caller enforces it yet. This is the foothold for the missing optimistic-concurrency protection on `configure-policy` (race between manager and co-parent edits is a real risk once 3.0.2's allowlist becomes load-bearing). Cheap to add now, expensive to retrofit.

### 4. `POLICY_NOT_INITIALIZED` returns shell, not error
Bootstrap flows need to poll for policy existence. Returning `{ success: true, policyVersion: 0, children: [], ... }` is more ergonomic than forcing every caller to catch an error to detect the "no policy yet" state. Errors are reserved for *unrecoverable* states (auth, missing family).

### 5. Per-role response shaping, not separate tools
A single `view-policy` with role-aware filtering instead of `view-policy-manager`, `view-policy-learner`, etc. Rationale: simpler MCP surface, role-based stripping is already a concern the server handles for other tools, and downstream agents don't need to know which variant to call.

### 6. Cache TTL ~60s
Long enough to absorb bursty agent calls (verify-achievement → distribute-allowance → check-progress sequences that all need policy state). Short enough that the policyVersion-based invalidation is a safety net, not a load-bearing mechanism.

## Trade-offs considered

**Including pending achievements in view-policy.** Rejected — couples config read to runtime state, which violates the single-responsibility split between `view-policy` and `check-progress`. Two calls is fine; agents already chain multiple tool calls per turn.

**Surfacing the encryption metadata.** Rejected — leaks implementation details, no caller use case justifies it. If debugging needs arise, add a separate manager-only `inspect-family` tool.

**Returning `authorizedDestinations` as flat string[].** Rejected — matches current storage shape but loses provenance. The object shape (`{ address, label, source }`) is the right read-side representation even if storage remains flat.

**`includeWallets: false` stripping destinations too.** Open — leaning toward keeping destinations intact (addresses *are* the point of that section) and only stripping from `children[]`. Documented as an explicit decision in plan.md.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Role-based stripping bug exposes destinations to learner | High | Test matrix in test.md exercises every (role × section) cell |
| Cache invalidation miss → stale policy returned after configure-policy write | Medium | Invalidate on write inside the same server process; accept eventual consistency for multi-instance deploys (not currently a concern on Railway single-instance) |
| `policyVersion` field collides with future Sprint 3.0.2 schema migration | Low | Version field is additive; storage migration can backfill `policyVersion: 1` for existing families |
| Learner uses `childName` of sibling to enumerate family structure | Medium | Server enforces caller-to-child binding; `CHILD_NOT_FOUND` returned regardless of whether the child exists, when caller is unauthorized |

## Open questions

1. Should `advisor` role see wallet addresses? Current proposal: no (advisor is audit role, not custody-adjacent). Confirm with usage pattern — if advisors are CPAs reconciling on-chain flows they need addresses.
2. Should `family` role (e.g. grandparent) see destinations? Current proposal: no. Grandparents care about goals + progress, not custody plumbing.
3. Should the response include the date of last `configure-policy` write per-section, or one top-level `updatedAt`? Current proposal: one top-level. Per-section timestamps require storage changes.

## References

- Sprint 3.0.2 plan (introduced `authorizedDestinations`)
- ALLOWME MCP tool schemas (existing patterns for `_callerId/_callerRole/_familyId` envelope)
- Harness Engineering v3 four-artifact discipline (this file + plan.md + progress.md + test.md)