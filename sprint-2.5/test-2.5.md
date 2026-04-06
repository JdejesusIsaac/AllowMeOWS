# AllowanceAgent — test.md (Sprint 2.5)

## Unit Tests

| # | Test | Expected | Category |
|---|------|----------|----------|
| G1 | Existing savings entries default to `asset: "USDC"` | No schema validation error on load | Functionality |
| G2 | convert-savings with sufficient USDC balance | USDC entries marked converted, PAXG entry created with correct fields | Functionality |
| G3 | convert-savings with insufficient USDC balance | Error: "Insufficient USDC savings. Available: $X" | Design/UX |
| G4 | convert-savings for nonexistent child | Error: "Child not found" | Design/UX |
| G5 | check-savings groups by asset | USDC and PAXG positions shown separately with correct totals | Functionality |
| G6 | check-savings with USDC only (no PAXG) | Shows USDC position only, no PAXG section | Functionality |
| G7 | Audit entry created for savings-converted | Action, amounts, txHash, priceAtConversion all logged correctly | Functionality |
| G8 | convert-savings is Manager only | Learner, Co-parent, Family, Advisor all denied | Auth/Security |

---

## E2E Test: Savings Diversification Flow

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| E1 | Configure family with Maya ($15/week, 20% savings) | Family config created | Functionality |
| E2 | Simulate distribution → $3.00 savings deposit (USDC, locked 90 days) | Savings entry created with asset: "USDC" | Functionality |
| E3 | Simulate second distribution → another $3.00 (total $6.00 locked) | Two USDC entries, total $6.00 | Functionality |
| E4 | Convert $3.00 to PAXG via convert-savings | Original USDC entry marked converted, new PAXG entry with txHash + priceAtConversion | Functionality |
| E5 | check-savings shows both positions | $3.00 USDC locked + 0.000644 PAXG ($3.00 at conversion price) | Design/UX |
| E6 | release-savings on mixed assets | USDC entry releases normally (multiplier applied). PAXG entry returns orchestration message, not direct transfer. | Design/UX |

---

## Test Count Summary

| Suite | Count |
|-------|-------|
| Unit tests (G1-G8) | 8 |
| E2E diversification flow (E1-E6) | 6 |
| **Sprint 2.5 new tests** | **14** |
| **Carried from Sprint 2 + remediation** | **151** |
| **Total after Sprint 2.5** | **165** |