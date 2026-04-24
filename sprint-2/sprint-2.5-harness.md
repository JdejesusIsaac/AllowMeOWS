# AllowanceAgent — Sprint 2.5 Mini-Harness

## Savings Vault Diversification: USDC → Gold (PAXG) via MoonPay

---

## Phase 0a: Problem Framing

### Problem Statement
The savings vault currently holds only USDC. Parents who want to teach their children about asset diversification — or who want long-term savings protected from dollar inflation — have no way to convert a portion of savings into gold-backed tokens. MoonPay MCP is available as a peer server but there's no tool to coordinate a savings conversion and track the resulting multi-asset position.

### "What Is" Statement
Sprint 2 shipped the `release-savings` tool (Bug #3 fix). The savings vault now correctly locks, applies multipliers, and releases USDC. MoonPay runs as a peer MCP server — Claude can already call MoonPay's swap tools independently. But there's no connection between AllowanceAgent's savings tracking and MoonPay's swap execution. A parent could manually swap USDC for PAXG using MoonPay, but AllowanceAgent wouldn't know about it — the savings ledger would still show USDC.

### Solution Hypothesis
Add one new MCP tool (`convert-savings`) and one schema change (`asset` field on SavingsEntry). The tool tells Claude to orchestrate a MoonPay swap (USDC on Base → PAXG on Ethereum) and records the result in the savings ledger. `check-savings` displays multi-asset positions. No MoonPay code inside AllowanceAgent — Claude orchestrates the swap externally and `convert-savings` records the outcome.

### Scope Boundary

**In scope:**
- `convert-savings` MCP tool (Manager only, free)
- `asset` field on `SavingsEntrySchema` (default: "USDC", also supports "PAXG")
- Updated `check-savings` to display multi-asset breakdown with current gold price
- Documentation: how Claude orchestrates the conversion via MoonPay swap

**Out of scope:**
- Automated gold DCA (auto-converting % of every deposit)
- Rebalancing between USDC and PAXG
- Multi-asset release logic (PAXG release = Claude orchestrates MoonPay swap back to USDC, then transfers. Tracked as separate tx.)
- PAXG price oracle integration inside AllowanceAgent (Claude fetches price from MoonPay discover-tokens at display time)
- Any MoonPay code dependency in AllowanceAgent

---

## Phase 0b: Technical Research

### PAXG on Ethereum vs Base

PAXG is an ERC-20 on Ethereum mainnet. It does not natively exist on Base. A USDC → PAXG conversion from a Base wallet requires a cross-chain swap: USDC on Base → bridge to Ethereum → swap for PAXG. MoonPay's Swaps.xyz aggregator handles cross-chain routes natively.

**Implication for AllowanceAgent:** The PAXG position lives on Ethereum, not Base. The OWS treasury wallet already has an Ethereum address (OWS derives addresses for all supported chains from one mnemonic). The `convert-savings` tool records the Ethereum tx hash and the PAXG amount. AllowanceAgent doesn't need to interact with Ethereum directly — MoonPay handles the swap, Claude reports the result, AllowanceAgent records it.

### How `convert-savings` Actually Works

This is a Claude-orchestrated multi-step flow, NOT a single tool call:

```
Parent: "Convert half of Maya's savings to gold"
    │
    ▼
Claude: check-savings → $25 USDC locked for Maya
    │
    ▼
Claude: determine half = $12.50 USDC
    │
    ▼
Claude → MoonPay discover-tokens: get PAXG price → ~$4,660/oz
    │
    ▼
Claude → MoonPay swap: $12.50 USDC (Base) → PAXG (Ethereum)
    │     MoonPay handles: bridge + swap + routing
    │     Returns: txHash, PAXG amount received (~0.00268 PAXG)
    │
    ▼
Claude → AllowanceAgent convert-savings:
    {
      childName: "Maya",
      fromAsset: "USDC",
      toAsset: "PAXG",
      usdcAmount: 12500000,        // 6-decimal USDC
      receivedAmount: "0.00268",   // PAXG (18-decimal or string)
      txHash: "0xabc...",          // MoonPay swap tx
      priceAtConversion: 4660.00   // USD price per PAXG at time of swap
    }
    │
    ▼
AllowanceAgent internally:
    1. Find Maya's USDC savings entries totaling ≥ $12.50
    2. Mark the consumed USDC entries as converted (new status)
    3. Create new SavingsEntry with asset: "PAXG"
    4. Audit log: "savings-converted" action
    │
    ▼
Claude: "Done. Maya's savings vault now holds $12.50 in USDC and
         0.00268 oz of gold (~$12.50 at today's price). Gold
         doesn't earn the savings multiplier — it earns gold price
         appreciation instead."
```

**Key design: AllowanceAgent is the ledger, MoonPay is the execution engine, Claude is the coordinator.** AllowanceAgent never calls MoonPay. It just records what happened.

### Schema Changes

**SavingsEntry — add `asset` field:**
```typescript
// In schemas.ts
export const SavingsEntrySchema = z.object({
  id: z.string().uuid(),
  childName: z.string(),
  amount: z.number().int(),               // USDC (6-decimal) or PAXG amount in smallest unit
  asset: z.enum(["USDC", "PAXG"]).default("USDC"),  // ← NEW
  depositedAt: z.string().datetime(),
  lockUntil: z.string().datetime(),
  released: z.boolean().default(false),
  releasedAt: z.string().datetime().optional(),
  multiplierAtDeposit: z.number().default(1.0),
  convertedFrom: z.string().optional(),    // ← NEW: original entry ID if this was converted
  conversionTxHash: z.string().optional(), // ← NEW: MoonPay swap tx hash
  priceAtConversion: z.number().optional(), // ← NEW: asset price at conversion time
});
```

**AuditEntry — add action:**
```typescript
// Add to AuditEntrySchema action enum:
"savings-converted"
```

### Display in check-savings

```json
{
  "childName": "Maya",
  "positions": {
    "USDC": {
      "totalLocked": "$12.50",
      "entries": 3,
      "nextRelease": "67 days"
    },
    "PAXG": {
      "totalAmount": "0.00268 oz",
      "currentValue": "$12.49",
      "priceChange": "-0.08%",
      "entries": 1,
      "note": "Gold doesn't earn multiplier — it earns price appreciation"
    }
  },
  "totalValueUsd": "$24.99"
}
```

Claude fetches the current PAXG price from MoonPay `discover-tokens` at display time. AllowanceAgent stores the conversion-time price for historical comparison but does NOT maintain a live price feed.

---

## Phase 0.5: Spike Validation

### Spike Question
Can MoonPay CLI execute a USDC (Base) → PAXG (Ethereum) cross-chain swap programmatically, and does it return the received PAXG amount and tx hash in a structured response that Claude can pass to AllowanceAgent?

### Spike Code
```bash
mp swap --from USDC --to PAXG --amount 12.50 --chain base --dest-chain ethereum --json
```

### Spike Result
**Needs validation before Sprint 2.5 starts.** If MoonPay's cross-chain routing supports USDC(Base) → PAXG(Ethereum) and returns structured output, proceed. If not, fallback: USDC(Base) → bridge to Ethereum → separate swap to PAXG (two MoonPay calls, Claude orchestrates sequentially).

---

## Implementation Steps

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| S1 | **Schema: add `asset` field to SavingsEntry** — Enum: "USDC" (default), "PAXG". Add `convertedFrom`, `conversionTxHash`, `priceAtConversion` optional fields. Update `SavingsEntrySchema` in schemas.ts. Backward compatible — existing entries default to "USDC". | Low | 20m |
| S2 | **Schema: add `savings-converted` to AuditEntry actions** — Single enum addition. | Low | 5m |
| S3 | **MCP tool: `convert-savings`** — Manager only, free. Accepts: childName, usdcAmount, receivedAsset ("PAXG"), receivedAmount (string), txHash, priceAtConversion. Validates: USDC savings entries exist with sufficient balance. Marks consumed USDC entries with `status: "converted"`. Creates new SavingsEntry with `asset: "PAXG"`. Audit logs the conversion. Returns confirmation with before/after position summary. | High | 2.5h |
| S4 | **Update `check-savings`** — Group entries by asset. Show USDC position (locked, multiplier, release dates) and PAXG position (amount in oz, value at conversion price, note about price appreciation). Claude fetches live price externally — AllowanceAgent just reports stored data. | Medium | 1h |
| S5 | **Update `release-savings`** — USDC entries release as before (multiplier applied, transfer to child wallet). PAXG entries: mark as released, but actual PAXG→USDC→child transfer is Claude-orchestrated via MoonPay swap. Tool returns "PAXG release requires MoonPay swap — Claude will handle the conversion." | Medium | 45m |
| S6 | **README: Savings diversification guide** — Document the convert-savings flow with the full Claude orchestration sequence. Include: what the parent says, what Claude does step by step, what AllowanceAgent records. Note that PAXG lives on Ethereum while USDC is on Base. Explain gold doesn't earn multiplier. | Low | 30m |
| S7 | **Unit tests** — Schema backward compat (existing entries default USDC), convert-savings validation (insufficient balance, child not found), check-savings multi-asset grouping, audit entry creation. (8 tests) | Medium | 45m |
| S8 | **E2E test** — Configure family → deposit savings (USDC) → convert half to PAXG → check-savings shows both positions → release USDC (works) → release PAXG (returns orchestration message). (6 steps) | Medium | 1h |

**Sprint 2.5 estimate: ~6.75 hours**

---

## Sprint Contract — Sprint 2.5

### Success Criteria

1. **`convert-savings` records conversion correctly:** USDC entries marked as converted, new PAXG entry created with amount + txHash + priceAtConversion. Total savings value preserved.
2. **`check-savings` shows multi-asset positions:** USDC and PAXG grouped separately. PAXG shows amount in oz + value at conversion price. USDC shows lock dates + multiplier as before.
3. **Backward compatible:** All existing USDC-only savings entries work unchanged. Default `asset: "USDC"` applied automatically.
4. **PAXG release handled gracefully:** `release-savings` identifies PAXG entries and returns a message indicating Claude should orchestrate MoonPay swap for the actual conversion. Does not attempt direct PAXG transfer.
5. **No MoonPay dependency in code:** AllowanceAgent has zero MoonPay imports. `convert-savings` receives swap results as input parameters — Claude did the swap externally.
6. **Audit trail complete:** `savings-converted` action logged with USDC amount consumed, PAXG received, tx hash, and price at conversion.

### Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| Functionality | 40% | Convert tool, multi-asset display, backward compat, PAXG release handling |
| Auth / Security | 20% | Manager-only access, conversion validation (sufficient balance), audit integrity |
| Design / UX | 25% | Multi-asset savings display clarity, gold educational messaging ("earns appreciation not multiplier"), PAXG release UX |
| Originality | 15% | Ledger-only pattern (AllowanceAgent records, Claude executes), multi-asset savings vault |

### Grading Thresholds

- **Pass:** All categories ≥ 70%. No category below 60%.
- **Fail:** Any category below 60%, OR Functionality below 70%.

---

## progress.md — Sprint 2.5

### Approach Taken
Single new MCP tool (`convert-savings`) that records Claude-orchestrated MoonPay swap results into the savings ledger. Schema extended with `asset` field for multi-asset tracking. No MoonPay code dependency. Claude is the coordinator, AllowanceAgent is the ledger, MoonPay is the execution engine.

### Steps Completed
- [ ] S1: Schema — add `asset`, `convertedFrom`, `conversionTxHash`, `priceAtConversion` to SavingsEntry
- [ ] S2: Schema — add `savings-converted` to AuditEntry actions
- [ ] S3: MCP tool — `convert-savings` (Manager only, validates balance, creates PAXG entry)
- [ ] S4: Update `check-savings` — multi-asset grouping (USDC + PAXG positions)
- [ ] S5: Update `release-savings` — PAXG release returns orchestration message
- [ ] S6: README — savings diversification guide with Claude orchestration flow
- [ ] S7: Unit tests (8 tests)
- [ ] S8: E2E test (6 steps)

### Current Blocker
Sprint 2 must ship first. Spike validation (MoonPay USDC→PAXG cross-chain swap) needed before starting.

### Failed Approaches
_None yet._

---

## test.md — Sprint 2.5

### Unit Tests

| # | Test | Expected | Category |
|---|------|----------|----------|
| G1 | Existing savings entries default to `asset: "USDC"` | No schema validation error on load | Functionality |
| G2 | convert-savings with sufficient USDC balance | USDC entries marked converted, PAXG entry created | Functionality |
| G3 | convert-savings with insufficient USDC balance | Error: "Insufficient USDC savings. Available: $X" | Design/UX |
| G4 | convert-savings for nonexistent child | Error: "Child not found" | Design/UX |
| G5 | check-savings groups by asset | USDC and PAXG positions shown separately | Functionality |
| G6 | check-savings with USDC only (no PAXG) | Shows USDC position only, no PAXG section | Functionality |
| G7 | Audit entry created for savings-converted | Action, amounts, txHash, price all logged | Functionality |
| G8 | convert-savings is Manager only | Learner, Co-parent, Family, Advisor all denied | Auth/Security |

### E2E Test: Savings Diversification Flow

**Step 1:** Configure family with Maya ($15/week, 20% savings)
**Step 2:** Simulate distribution → $3.00 savings deposit (USDC, locked 90 days)
**Step 3:** Simulate second distribution → another $3.00 (total $6.00 USDC locked)
**Step 4:** Convert $3.00 to PAXG → `convert-savings(childName: "Maya", usdcAmount: 3000000, receivedAsset: "PAXG", receivedAmount: "0.000644", txHash: "0xtest...", priceAtConversion: 4660.00)`
**Step 5:** `check-savings` → shows $3.00 USDC locked + 0.000644 PAXG ($3.00 at conversion)
**Step 6:** `release-savings` → USDC entry released (multiplier applied). PAXG entry returns: "Gold release requires MoonPay swap — use convert to swap back to USDC first, or ask Claude to handle the conversion."

**Assertions:**
- Step 4: Original USDC entry marked `converted`, new PAXG entry has correct fields
- Step 5: Both assets appear in response, totals correct
- Step 6: USDC releases normally, PAXG does not auto-release (requires orchestration)

### Test Count

| Suite | Count |
|-------|-------|
| Unit tests (G1-G8) | 8 |
| E2E (6 steps) | 6 |
| **Sprint 2.5 total** | **14** |
| **Cumulative (S1 + S2 + S2.5)** | **169** |
