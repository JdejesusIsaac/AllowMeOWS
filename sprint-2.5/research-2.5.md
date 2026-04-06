# AllowanceAgent — research.md (Sprint 2.5)

## Phase 0a: Problem Framing

### Problem Statement
The savings vault currently holds only USDC. Parents who want to teach their children about asset diversification — or who want long-term savings protected from dollar inflation — have no way to convert a portion of savings into gold-backed tokens. MoonPay MCP is available as a peer server but there's no tool to coordinate a savings conversion and track the resulting multi-asset position.

### "What Is" Statement
Sprint 2 shipped 151 tests, 11 MCP tools (including connect-fitbit), dual transport (stdio + HTTP), five-role RBAC with child-scoped isolation, Fitbit OAuth, x402 micropayment gating, and the `release-savings` tool. The savings vault correctly locks, applies multipliers, and releases USDC. MoonPay runs as a peer MCP server — Claude can already call MoonPay's swap tools independently. But there's no connection between AllowanceAgent's savings tracking and MoonPay's swap execution. A parent could manually swap USDC for PAXG using MoonPay, but AllowanceAgent wouldn't know about it — the savings ledger would still show USDC.

### Solution Hypothesis
Add one new MCP tool (`convert-savings`) and one schema change (`asset` field on SavingsEntry). The tool tells Claude to orchestrate a MoonPay swap (USDC on Base → PAXG on Ethereum) and records the result in the savings ledger. `check-savings` displays multi-asset positions. No MoonPay code inside AllowanceAgent — Claude orchestrates the swap externally and `convert-savings` records the outcome.

### Scope Boundary

**In scope:**
- `convert-savings` MCP tool (Manager only, free)
- `asset` field on `SavingsEntrySchema` (default: "USDC", also supports "PAXG")
- Updated `check-savings` to display multi-asset breakdown
- Updated `release-savings` to handle PAXG entries (orchestration message, not direct transfer)
- Documentation: how Claude orchestrates the conversion via MoonPay swap

**Out of scope:**
- Automated gold DCA (auto-converting % of every deposit)
- Rebalancing between USDC and PAXG
- PAXG price oracle integration inside AllowanceAgent (Claude fetches price from MoonPay at display time)
- Any MoonPay code dependency in AllowanceAgent
- Onboarding landing page (deferred to deployment)
- Missing Sprint 2 tests (P1-P5 OWS policy, EC1-EC10 edge cases — maintenance pass)

---

## Phase 0b: Technical Research

### 1. PAXG on Ethereum vs Base

PAXG (Paxos Gold) is an ERC-20 on Ethereum mainnet (~$4,660/oz, $2.4B market cap, Q1 2026). Each token represents one troy ounce of London Good Delivery gold held in Brink's vaults. It does NOT natively exist on Base.

A USDC → PAXG conversion from a Base wallet requires a cross-chain swap: USDC on Base → bridge to Ethereum → swap for PAXG. MoonPay's Swaps.xyz aggregator handles cross-chain routes natively.

**Implication for AllowanceAgent:** The PAXG position lives on Ethereum, not Base. The OWS treasury wallet already has an Ethereum address (OWS derives addresses for all supported chains from one mnemonic). `convert-savings` records the Ethereum tx hash and PAXG amount. AllowanceAgent doesn't interact with Ethereum directly — MoonPay handles the swap, Claude reports the result, AllowanceAgent records it.

### 2. How `convert-savings` Actually Works

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
    2. Mark consumed USDC entries as converted (new status)
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

### 3. Schema Changes

**SavingsEntry — add `asset` field:**
```typescript
export const SavingsEntrySchema = z.object({
  id: z.string().uuid(),
  childName: z.string(),
  amount: z.number().int(),               // USDC (6-decimal) or PAXG smallest unit
  asset: z.enum(["USDC", "PAXG"]).default("USDC"),  // NEW
  depositedAt: z.string().datetime(),
  lockUntil: z.string().datetime(),
  released: z.boolean().default(false),
  releasedAt: z.string().datetime().optional(),
  multiplierAtDeposit: z.number().default(1.0),
  convertedFrom: z.string().optional(),    // NEW: original entry ID if converted
  conversionTxHash: z.string().optional(), // NEW: MoonPay swap tx hash
  priceAtConversion: z.number().optional(), // NEW: asset price at conversion time
});
```

All new fields are optional with defaults. Existing entries load without changes.

### 4. Multi-Asset Display in `check-savings`

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

AllowanceAgent stores the conversion-time price for historical comparison. Claude fetches live PAXG price from MoonPay `discover-tokens` at display time — AllowanceAgent does NOT maintain a live price feed.

### 5. PAXG Release Behavior

When `release-savings` encounters a PAXG entry:
- Mark as `released: true` in the ledger
- Do NOT attempt a transfer (AllowanceAgent can't execute Ethereum transactions for PAXG)
- Return message: "Gold release requires MoonPay swap — Claude will handle the conversion"
- Claude then orchestrates: MoonPay swap PAXG→USDC on Ethereum → bridge to Base → transfer to child wallet

USDC entries release as before: multiplier applied, viem transfer to child wallet on Base.

---

## Phase 0.5: Spike Validation

### Spike Question
Can MoonPay CLI execute a USDC (Base) → PAXG (Ethereum) cross-chain swap programmatically, and does it return the received PAXG amount and tx hash in a structured response?

### Spike Code
```bash
mp swap --from USDC --to PAXG --amount 12.50 --chain base --dest-chain ethereum --json
```

### Spike Result
**Needs validation before Sprint 2.5 starts.** If MoonPay's cross-chain routing supports this pair and returns structured output, proceed. If not, fallback: two MoonPay calls (bridge USDC Base→Ethereum, then swap USDC→PAXG on Ethereum). Claude orchestrates both steps sequentially.

---

## Open Questions

| Question | Status | Resolution |
|----------|--------|------------|
| MoonPay USDC(Base) → PAXG(Ethereum) supported? | 🔜 Spike needed | Run `mp swap` command and validate structured output |
| PAXG amount precision | ✅ Resolved | Store as string (e.g., "0.00268") — PAXG is 18-decimal, avoid integer overflow |
| Gold multiplier | ✅ Resolved | No multiplier on PAXG. Educational message: "earns appreciation, not streaks" |
| PAXG release mechanism | ✅ Resolved | AllowanceAgent marks released, Claude orchestrates MoonPay swap back to USDC |
| Schema backward compat | ✅ Resolved | All new fields optional with defaults. Existing entries unaffected. |
| Live price feed | ✅ Resolved | AllowanceAgent stores conversion-time price only. Claude fetches live price from MoonPay at display time. |
