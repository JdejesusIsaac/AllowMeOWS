# AllowanceAgent — plan.md (Sprint 2.5)

## Feature Summary

Sprint 2.5 adds savings vault diversification — parents can convert a child's USDC savings into gold-backed tokens (PAXG) via MoonPay, tracked in AllowanceAgent's multi-asset ledger. Claude orchestrates the swap externally; AllowanceAgent records the result. No MoonPay code dependency. One new tool, one schema extension, two tool updates.

## Architecture Decisions

### 1. AllowanceAgent is the ledger, MoonPay is the execution engine, Claude is the coordinator
**Decision:** `convert-savings` receives swap results as input parameters. AllowanceAgent never calls MoonPay directly.
**Why:** Loose coupling. MoonPay can change APIs, pricing, or routing without breaking AllowanceAgent. Claude handles the orchestration naturally — it already runs both MCP servers side by side.

### 2. PAXG lives on Ethereum, not Base
**Decision:** Record the Ethereum tx hash and PAXG amount. Don't attempt to track PAXG on Base (it doesn't exist there natively).
**Why:** PAXG is an ERC-20 on Ethereum mainnet only. The OWS treasury already has an Ethereum address (derived from the same mnemonic). Cross-chain swap (USDC Base → PAXG Ethereum) is handled by MoonPay's Swaps.xyz aggregator.

### 3. Gold doesn't earn multiplier — it earns price appreciation
**Decision:** PAXG savings entries have `multiplierAtDeposit: 1.0` always. The educational message is explicit: "Gold earns price appreciation, not a streak multiplier."
**Why:** Applying a 1.5x multiplier to gold doesn't make economic sense. The educational value is teaching kids that different assets grow differently — USDC earns streaks, gold earns market appreciation.

### 4. PAXG release requires Claude orchestration
**Decision:** `release-savings` identifies PAXG entries but does not auto-transfer. Returns a message indicating Claude should orchestrate a MoonPay swap (PAXG → USDC → child wallet).
**Why:** AllowanceAgent can't execute Ethereum transactions for PAXG swaps. That's MoonPay's job. Keeping the boundary clean.

---

## Implementation Steps

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| S1 | **Schema: add `asset` field to SavingsEntry** — Enum: "USDC" (default), "PAXG". Add `convertedFrom` (original entry ID), `conversionTxHash`, `priceAtConversion` optional fields. Backward compatible — existing entries default to "USDC". | Low | 20m |
| S2 | **Schema: add `savings-converted` to AuditEntry actions** — Single enum addition. | Low | 5m |
| S3 | **MCP tool: `convert-savings`** — Manager only, free. Accepts: childName, usdcAmount, receivedAsset ("PAXG"), receivedAmount (string), txHash, priceAtConversion. Validates: USDC savings entries exist with sufficient balance. Marks consumed USDC entries with `status: "converted"`. Creates new SavingsEntry with `asset: "PAXG"`, `multiplierAtDeposit: 1.0`. Audit logs the conversion. Returns confirmation with before/after position summary. | High | 2.5h |
| S4 | **Update `check-savings`** — Group entries by asset. USDC position: locked amount, multiplier, release dates. PAXG position: amount in oz, value at conversion price, note about price appreciation. Claude fetches live price externally — AllowanceAgent reports stored data only. | Medium | 1h |
| S5 | **Update `release-savings`** — USDC entries release as before (multiplier applied, transfer to child wallet). PAXG entries: mark as released but return "Gold release requires MoonPay swap — Claude will handle the conversion." Do not attempt direct PAXG transfer. | Medium | 45m |
| S6 | **Register `convert-savings` in index.ts** — Add tool to MCP server. Manager only. Free (no x402). | Low | 10m |
| S7 | **README: Savings diversification guide** — Document the full Claude orchestration sequence: parent says "convert half of Maya's savings to gold" → Claude calls check-savings → MoonPay discover-tokens → MoonPay swap → AllowanceAgent convert-savings. Include multi-asset display example. Note PAXG on Ethereum, gold vs multiplier education. | Low | 30m |
| S8 | **Unit tests (8 tests)** — Schema backward compat, convert-savings validation (sufficient balance, child not found, Manager only), check-savings multi-asset grouping, audit entry creation. | Medium | 45m |
| S9 | **E2E test (6 steps)** — Configure → deposit USDC → deposit again → convert half to PAXG → check-savings shows both → release (USDC releases, PAXG returns orchestration message). | Medium | 1h |

**Sprint 2.5 estimate: ~6.75 hours**

---

## Dependencies and Risks

| Dependency | Risk | Mitigation |
|------------|------|------------|
| MoonPay USDC(Base) → PAXG(Ethereum) route | Medium | Spike needed. If unsupported as single swap, fallback: two-step (bridge + swap). Claude orchestrates both. |
| PAXG price data | Low | AllowanceAgent stores conversion-time price only. Live price is Claude's responsibility via MoonPay discover-tokens. |
| Existing savings tests | Low | All changes backward compatible. `asset` defaults to "USDC". Existing tests pass unchanged. |
| SavingsEntry schema migration | Low | No migration needed — new fields are optional with defaults. |

## Fallback Approaches

- **MoonPay cross-chain swap not available:** Claude orchestrates two steps: (1) bridge USDC from Base to Ethereum via MoonPay, (2) swap USDC for PAXG on Ethereum. `convert-savings` records the final result regardless of how many steps the swap took.
- **PAXG price unavailable at display time:** `check-savings` shows "value at conversion: $X" without live price. Claude can add live price when MoonPay is available.
- **Schema backward compat breaks:** All new fields are optional with defaults. If something breaks, the fields can be removed without data loss.

---

## Sprint Contract — Sprint 2.5

### Success Criteria

1. **`convert-savings` records conversion correctly:** USDC entries marked as converted, new PAXG entry created with amount + txHash + priceAtConversion. Total savings value preserved.
2. **`check-savings` shows multi-asset positions:** USDC and PAXG grouped separately. PAXG shows amount in oz + value at conversion price. USDC shows lock dates + multiplier as before.
3. **Backward compatible:** All existing USDC-only savings entries work unchanged. Default `asset: "USDC"` applied automatically. All 151 existing tests still pass.
4. **PAXG release handled gracefully:** `release-savings` identifies PAXG entries and returns a message indicating Claude should orchestrate MoonPay swap. Does not attempt direct PAXG transfer.
5. **No MoonPay dependency in code:** AllowanceAgent has zero MoonPay imports. `convert-savings` receives swap results as input — Claude did the swap externally.
6. **Audit trail complete:** `savings-converted` action logged with USDC amount consumed, PAXG received, tx hash, and price at conversion.
7. **Manager only:** `convert-savings` is restricted to Manager role. Learner, Co-parent, Family, Advisor all denied.
8. **README documents the flow:** Full Claude orchestration sequence documented with parent-facing example.

### Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| Functionality | 40% | Convert tool, multi-asset display, backward compat, PAXG release handling |
| Auth / Security | 20% | Manager-only access, conversion validation (sufficient balance), audit integrity |
| Design / UX | 25% | Multi-asset savings display clarity, gold educational messaging, PAXG release UX |
| Originality | 15% | Ledger-only pattern (AllowanceAgent records, Claude executes), multi-asset savings vault for kids |

### Grading Thresholds

- **Pass:** All categories ≥ 70%. No category below 60%.
- **Fail:** Any category below 60%, OR Functionality below 70%.