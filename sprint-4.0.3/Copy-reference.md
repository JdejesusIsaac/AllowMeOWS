# Sprint 4.3 — Copy reference: check-progress, check-savings, settle-balance

> Load-bearing UX deliverable. Every string the user sees as part of
> the ledger / settlement change is specified here verbatim. This
> document is the source of truth; engineering implementations in
> `src/tools/*.ts` reference these strings, not the other way around.

This is also the document to hand to a copywriter, designer, or pilot
parent for review before any of it ships.

## 0. How to read this document

Each block is a complete response for a specific surface + state +
role + auto-settle combination. Variables in `{braces}` are
substituted at render time. Numbers in examples (`$3.50`, `5 days`,
etc.) are illustrative — substitute real values.

The **kid-facing** copy is the load-bearing one. Get this right and
the sprint succeeds. Get it wrong and parents file support tickets.

## 1. Design principles

The seven principles that govern every string in this document:

1. **Earning is the headline. Settlement is a footnote.** The kid's
   week is about what they accomplished, not what's pending in a
   ledger. The motivational number leads; the transparency number
   trails.

2. **"Earned" never decreases.** Once Maya earns $4.23, that number
   stays $4.23 in `check-progress` even after settlement. Settlement
   moves money between *display sections* (pending → wallet); it does
   not undo earning.

3. **No alarm language for pending balances.** Pending is normal,
   expected, scheduled. Words like "missing," "delayed," "stuck,"
   "issue," "wait" are banned for the default pending case. Save them
   for the actual failure cases (§7-§8).

4. **Action is offered, not demanded.** "Run settle-balance" is
   suggested; "you must run settle-balance" is never used. The kid
   has agency; the parent has agency; the auto-settle policy has
   agency.

5. **Failure messages are role-appropriate.** A kid who hits an
   allowlist block sees "ask a parent." A parent who hits the same
   block sees "configure-policy to authorize this wallet." Same
   failure, two messages.

6. **No engineering metaphors leak.** Words banned in user-facing
   copy: "ledger," "blockchain," "transaction," "broadcast,"
   "on-chain," "off-chain," "batch," "txhash" (display as "receipt"
   if shown at all). Words allowed: "earned," "saved," "pending,"
   "settled," "in your wallet," "moved to wallet."

7. **Numbers always have currency.** "$4.23" not "4.23"; "$0.00" not
   "0". Cents-precision throughout. Micros precision (6 decimals) is
   internal; UI rounds to cents.

## 2. Glossary

User-facing terms (used in copy):

| Term | Meaning |
|------|---------|
| **earned** | Total awarded for verified achievements this week (or all-time, depending on view). Never decreases. |
| **in your wallet** | USDC currently held in the child's wallet address on-chain, ready to spend. |
| **pending settlement** | Earnings recognized but not yet moved to the wallet on-chain. Cleared by running settle-balance. |
| **locked** | Savings deposits inside the vault that haven't matured yet. Unavailable to release. |
| **released** | Savings deposits that matured and are queued to move to the wallet. |
| **savings vault** | The locked-savings address. Holds money the child has saved but can't spend yet. |
| **streak** | Consecutive days with verified achievements. Multiplier applied to earnings. |
| **multiplier** | Streak bonus applied to base earning amount (e.g., 1.2× at 5+ days). |
| **settle** | The act of moving pending earnings from the ledger to the wallet on-chain. |

Internal terms (never appear in user copy):

- LedgerEntry, broadcast, txHash, batchId, allowlist, policy engine,
  RBAC, micros, address, signing, multicall.

## 3. check-progress — kid-facing (default, manual settle)

### 3.1 Steady-state, mid-week, pending balance > 0

```markdown
**Maya's week so far**

Earned this week: $4.23 / $15.00 ▓▓▓░░░░░░░
Streak: 5 days 🔥 (1.2x multiplier)

💰 **In your wallet:** $3.50 ready to spend
⏳ **Pending settlement:** $0.73 — run **settle-balance** to move it to your wallet

**Categories**
reading      $2.50 / $6.00 ▓▓▓▓░░░░░░
movement     $1.00 / $5.25 ▓▓░░░░░░░░
creativity   $0.73 / $3.75 ▓░░░░░░░░░

👉 Log something today to keep your streak going. Need to cash out? Run **settle-balance**.
```

### 3.2 Steady-state, pending balance is $0

When everything is settled, the pending row disappears entirely. The
copy should never say "Pending: $0.00" — that's noise.

```markdown
**Maya's week so far**

Earned this week: $4.23 / $15.00 ▓▓▓░░░░░░░
Streak: 5 days 🔥 (1.2x multiplier)

💰 **In your wallet:** $4.23 ready to spend

**Categories**
reading      $2.50 / $6.00 ▓▓▓▓░░░░░░
movement     $1.00 / $5.25 ▓▓░░░░░░░░
creativity   $0.73 / $3.75 ▓░░░░░░░░░

👉 Log something today to keep your streak going.
```

### 3.3 Streak broken

Streak line changes from celebratory to neutral. The pending/wallet
rows are unchanged.

```markdown
**Maya's week so far**

Earned this week: $2.00 / $15.00 ▓░░░░░░░░░
Streak: ended — log today to start a new one

💰 **In your wallet:** $2.00 ready to spend

(...categories, footer...)

👉 A fresh start is always one verified achievement away.
```

### 3.4 First-time view (no achievements yet this week)

```markdown
**Maya's week so far**

Earned this week: $0.00 / $15.00 ░░░░░░░░░░
Ready when you are.

💰 **In your wallet:** $1.50 from previous weeks

👉 Tell a parent what you accomplished and they can verify it.
```

(No pending row. No categories breakdown. No settle-balance prompt —
nothing to settle.)

## 4. check-progress — kid-facing (auto-settle enabled)

When `autoSettleWeekly: true`, the pending line replaces the action
prompt with a countdown.

### 4.0.1 Mid-week, pending balance > 0, auto-settle on, next Sunday in 3 days

```markdown
**Maya's week so far**

Earned this week: $4.23 / $15.00 ▓▓▓░░░░░░░
Streak: 5 days 🔥 (1.2x multiplier)

💰 **In your wallet:** $3.50 ready to spend
⏳ **Pending settlement:** $0.73 — auto-settles Sunday (in 3 days)

(...categories...)

👉 Log something today to keep your streak going.
```

The footer drops the settle-balance prompt because auto-settle handles
it. The kid can still run settle-balance manually if they want their
money sooner; the copy just doesn't push for it.

### 4.0.2 Auto-settle on, less than 24 hours to next Sunday

```markdown
⏳ **Pending settlement:** $0.73 — auto-settles tonight
```

When less than 24h: "tonight" or "tomorrow morning" (UTC-aware
phrasing — calculated at render time).

### 4.0.3 Auto-settle on, just-ran (post-Sunday, pending is $0)

Pending row disappears entirely; wallet shows the freshly-settled
amount.

## 5. check-progress — manager-facing

The manager view differs in three ways: (1) shows the auto-settle
toggle status, (2) includes gas-estimate info, (3) makes the
configure-policy reference explicit.

### 5.1 Manager view, pending balance > 0, auto-settle off

```markdown
**Maya's week so far**

Earned this week: $4.23 / $15.00 ▓▓▓░░░░░░░
Streak: 5 days 🔥 (1.2x multiplier)

💰 **In Maya's wallet:** $3.50 spendable
⏳ **Pending:** $0.73 earned but not yet moved to wallet

**Settlement options:**
- Run **settle-balance** now to push pending → wallet (~$0.02 gas, one transaction)
- Enable weekly auto-settle via **configure-policy** to settle every Sunday automatically

**Categories**
reading      $2.50 / $6.00 ▓▓▓▓░░░░░░
movement     $1.00 / $5.25 ▓▓░░░░░░░░
creativity   $0.73 / $3.75 ▓░░░░░░░░░
```

### 5.2 Manager view, auto-settle on

```markdown
**Maya's week so far**

(...earning/wallet/categories — same as 5.1...)

⏳ **Pending:** $0.73 — auto-settles Sunday 00:00 UTC (in 3 days)
✅ Auto-settle is enabled. Run **settle-balance** if you'd like to settle sooner.
```

### 5.3 Manager view, family-wide (multiple children)

When the manager calls check-progress without a `childName`, the view
aggregates:

```markdown
**This week — family overview**

| Child | Earned | In wallet | Pending |
|-------|--------|-----------|---------|
| Maya | $4.23 / $15.00 | $3.50 | $0.73 |
| Diego | $2.10 / $10.00 | $1.85 | $0.25 |

**Total pending across family:** $0.98
Run **settle-balance** to process all pending in one batch.
```

## 6. check-savings — updated copy

### 6.1 Kid-facing, with pending settlement

```markdown
**Maya's savings vault**

**Locked:** $1.50 ▓▓▓░░░░░░░ (1.2x streak when deposited)
   Unlocks: 12 days from now

**Released (in wallet):** $2.00 ready to spend

⏳ **Pending settlement:** $0.30 — earned, not yet moved to vault

👉 Mature savings show as **released**. Run **settle-balance** to move pending into the vault, or wait for the next auto-settle.
```

### 6.2 Kid-facing, no pending

```markdown
**Maya's savings vault**

**Locked:** $1.50 ▓▓▓░░░░░░░ (1.2x streak when deposited)
   Unlocks: 12 days from now

**Released (in wallet):** $2.00 ready to spend

👉 Mature savings show as **released**. Ask a parent (or run **settle-balance** yourself) when ready.
```

### 6.3 Kid-facing, savings just matured (pending release)

When `release-savings` was called but the release entry hasn't settled
yet:

```markdown
**Maya's savings vault**

**Locked:** $0.00 — nothing locked right now

**Released (in wallet):** $2.00 ready to spend

⏳ **Pending release to wallet:** $1.50 — run **settle-balance** to move it

🎉 Some savings just matured! Run settle-balance to move them to your wallet.
```

### 6.4 Manager-facing

Same structure with policy reference appended:

```markdown
**Maya's savings vault**

(...locked / released / pending...)

**Vault address:** 0x1234...5678
**Lock period:** 30 days
**Streak multiplier at deposit time:** preserved per entry

To change the lock period or savings percentage for future deposits, run **configure-policy**.
```

## 7. settle-balance — successful response

### 7.1 Single-child, single-destination success (kid-facing)

```markdown
**Settled $0.73 for Maya**

✅ Wallet: $0.73 moved to your wallet
   Receipt: 0xabc1...d4f2

**New balances:**
- 💰 In your wallet: $4.23 ready to spend
- ⏳ Pending: $0.00 ✨

You're all caught up!
```

### 7.2 Single-child, two-destination success (kid-facing)

```markdown
**Settled $1.03 for Maya**

✅ Wallet: $0.73 moved (receipt: 0xabc1...d4f2)
✅ Savings vault: $0.30 moved (receipt: 0x9e8f...12bc)

**New balances:**
- 💰 In your wallet: $4.23 ready to spend
- 🔒 Locked in savings: $1.80
- ⏳ Pending: $0.00 ✨

Two transactions, one settlement. Nice.
```

### 7.3 Family-wide success (manager-facing)

```markdown
**Settled $2.15 across the family**

| Child | Wallet | Savings vault | Total |
|-------|--------|---------------|-------|
| Maya | $0.73 | $0.30 | $1.03 |
| Diego | $0.85 | $0.27 | $1.12 |

**Receipts:**
- 0xabc1...d4f2 ($1.58 → child wallets, 2 destinations batched)
- 0x9e8f...12bc ($0.57 → savings vaults, 2 destinations batched)

Gas spent: ~$0.04. All pending balances are clear.
```

### 7.4 Manager-facing single child

```markdown
**Settled $1.03 for Maya**

✅ Wallet (0x1234...5678): $0.73 — receipt 0xabc1...d4f2
✅ Savings vault (0x9876...4321): $0.30 — receipt 0x9e8f...12bc

Gas spent: ~$0.02. Maya's pending balance is now $0.00.
```

## 8. settle-balance — dry-run preview

### 8.1 Dry-run with pending balance

```markdown
**Settlement preview for Maya**

Pending to settle:

| Destination | Amount | Entry count |
|-------------|--------|-------------|
| Child wallet | $0.73 | 3 entries (reading, movement, creativity) |
| Savings vault | $0.30 | 1 entry (savings deposit) |

**Total:** $1.03 across 2 transactions
**Estimated gas:** ~$0.02 (paid from family treasury)

Run again with `dryRun: false` to execute, or wait for auto-settle on Sunday.
```

### 8.2 Dry-run with empty pending

```markdown
**Settlement preview for Maya**

Nothing to settle right now. All earnings are already in Maya's wallet.

💰 Current balance: $4.23 spendable
```

## 9. settle-balance — failure responses

### 9.1 Allowlist blocked (kid-facing)

```markdown
**Settlement on hold**

Your wallet isn't on the authorized destinations list yet. A parent needs to add it before you can settle.

Your pending balance is safe — nothing was lost.

**Pending preserved:** $0.73
**What to do:** Ask a parent to run **configure-policy** and add your wallet to the authorized destinations.
```

### 9.2 Allowlist blocked (manager-facing)

```markdown
**Settlement blocked by policy**

The following destinations are not authorized:

| Child | Destination | Wallet address |
|-------|-------------|----------------|
| Maya | child-wallet | 0x1234...5678 |

**Pending balances preserved:**
- Maya: $0.73 ($0.43 wallet, $0.30 savings)

**Fix:** Run **configure-policy** to add `0x1234...5678` to the authorized destinations list. Then run **settle-balance** again.

Why this happened: the destination allowlist (Sprint 3.0.2) prevents settlement to unauthorized addresses. This is a feature, not a bug — it stops accidental transfers to wrong wallets.
```

### 9.3 Partial failure (one destination succeeded, one failed) — kid-facing

```markdown
**Partial settlement for Maya**

✅ Wallet: $0.73 moved successfully (receipt: 0xabc1...d4f2)
⚠️ Savings vault: couldn't move $0.30 right now — we'll try again next time

**New balances:**
- 💰 In your wallet: $4.23 ready to spend
- ⏳ Pending: $0.30 (savings — will retry on next settle)

Don't worry — your earnings are safe. Run **settle-balance** again in a few minutes.
```

### 9.4 Partial failure (manager-facing)

```markdown
**Settlement partially succeeded**

✅ Maya wallet (0x1234...5678): $0.73 settled — receipt 0xabc1...d4f2
❌ Maya savings vault: $0.30 failed — reason: insufficient_gas

**Pending after this run:**
- Maya: $0.30 (savings — retry pending, attempt 1 of 3)

**Suggested action:** Top up the family treasury with a small amount of ETH for gas, then run **settle-balance** again. The failed entry will retry automatically.

If this is the 3rd consecutive failure, the entry will be marked **abandoned** and require manual review.
```

### 9.5 Total failure (kid-facing)

```markdown
**Couldn't settle right now**

Something stopped the settlement from going through. Your pending balance is safe — nothing was lost.

**Pending preserved:** $1.03
**What to do:** Try again in a few minutes, or ask a parent to check.
```

### 9.6 Total failure (manager-facing)

```markdown
**Settlement failed**

All settlement attempts failed:

| Destination | Reason |
|-------------|--------|
| Maya wallet | rpc_timeout |
| Maya savings vault | rpc_timeout |

**Pending preserved:** $1.03 (Maya — retry pending, attempt 1 of 3)

This looks like a temporary RPC issue. Wait a few minutes and run **settle-balance** again. The system will retry the failed entries automatically.

If failures continue across 3 attempts, the entries will be marked abandoned and a notification will be sent.
```

### 9.7 Nothing to settle

```markdown
**All caught up — nothing to settle**

💰 Maya's wallet: $4.23 ready to spend

No pending earnings right now. Come back after the next achievement is verified!
```

(Friendly, no alarm. Notice the absence of "error" / "fail" /
"problem" — see design principle §1.5.)

### 9.8 Kid tries to settle for sibling (RBAC denied)

```markdown
**Can't settle someone else's balance**

You can run **settle-balance** for your own pending balance, but not for Diego's. A parent can settle for everyone.

To check your own balance, run **settle-balance** without specifying a child name.
```

## 10. distribute-allowance — new copy (Phase C)

After the cutover, `distribute-allowance` no longer broadcasts. The
response copy must make this clear without confusing users who
remember the old behavior.

### 10.1 First-time run after cutover (one-time hint)

This response is shown only the FIRST time a family runs
distribute-allowance after the Phase C deploy. After that, the
hint disappears and §10.2 is used.

```markdown
**Allowance recorded for Maya**

3 achievements credited:
- reading: $2.50
- movement: $1.00
- creativity: $0.73

Split: $3.38 to wallet (80%), $0.85 to savings (20%)

**Pending settlement:** $4.23

💡 **What changed:** Earned amounts are now recorded immediately when you run distribute-allowance, but the on-chain transfer happens when you run **settle-balance** (or weekly via auto-settle). This batches transfers to save on gas.

Run **settle-balance** when you're ready to push pending → wallet.
```

### 10.2 Steady-state (post-first-run)

```markdown
**Allowance recorded for Maya**

3 achievements credited:
- reading: $2.50
- movement: $1.00
- creativity: $0.73

Split: $3.38 to wallet (80%), $0.85 to savings (20%)

**Pending settlement:** $4.23 — run **settle-balance** when ready.
```

### 10.3 Steady-state, no pending achievements

```markdown
**Nothing new to record**

All recent achievements are already credited. Run **check-progress** to see Maya's current week.
```

## 11. Auto-settle messaging

### 11.1 Configuring auto-settle for the first time

When a parent runs `configure-policy { autoSettleWeekly: true }`:

```markdown
**Weekly auto-settle enabled**

From now on, AllowMe will automatically run **settle-balance** for your family every Sunday at 00:00 UTC.

✅ What this means:
- Pending earnings auto-settle weekly without manual action
- You can still run settle-balance manually any time
- Failed settlements retry up to 3 times before requiring review

⚠️ Note: settlement still requires authorized destinations. Make sure all child wallets are added via configure-policy.

Next auto-settle: Sunday at 00:00 UTC (in 3 days)
```

### 11.2 Disabling auto-settle

```markdown
**Weekly auto-settle disabled**

Settlement will no longer happen automatically. Run **settle-balance** manually when ready.

Any pending balances are unchanged — they stay pending until settled.
```

### 11.3 Auto-settle ran successfully (notification — no UI surface today)

This copy is for a future notification surface (email, push) — not in
4.0.3 scope but specified here for consistency.

```markdown
**Auto-settle complete**

Settled $5.23 across your family this week.

| Child | Wallet | Savings |
|-------|--------|---------|
| Maya | $3.50 | $0.73 |
| Diego | $0.85 | $0.15 |

See **check-progress** for details.
```

### 11.4 Auto-settle hit an abandon (3rd failure — notification)

```markdown
**Auto-settle needs review**

Settlement failed 3 times for the following entries:

| Child | Destination | Reason |
|-------|-------------|--------|
| Maya | savings-vault | policy_denied: recipient_not_authorized |

These entries have been marked for review and won't retry automatically. Run **settle-balance** manually after addressing the issue (likely via **configure-policy**).
```

## 12. Migration messaging

### 12.1 First check-progress call after Phase A deploy

No special copy. Phase A is silent (dual-write only). The ledger
populates in the background; user sees nothing different.

### 12.2 First check-progress call after Phase C deploy

The "Pending settlement" row appears for the first time. The
existing copy (§3.1) is sufficient — no special migration banner.

### 12.3 First distribute-allowance call after Phase C deploy

See §10.1 — the one-time hint explains the behavior change.

### 12.4 Pre-existing pending entries from migration

After W9 migrates undistributed achievements into the ledger, the
first check-progress call will show a large "Pending settlement"
number. This is correct but potentially surprising. Mitigation:
release notes communication, and the §10.1 hint in distribute-allowance.

## 13. Error and edge case catalog

### 13.1 Kid runs settle-balance during an in-flight settle (concurrency)

```markdown
**A settlement is already in progress for Maya**

Wait a moment and try again — settlements usually take a few seconds.
```

### 13.2 settle-balance called with childName that doesn't exist

```markdown
**No child named "Maya" in this family**

Available children: Diego, Sofía

Run **check-progress** to see your family's current state.
```

### 13.3 Settle-balance called and entry exceeds wallet ceiling (Sprint 3.0.6 policy)

```markdown
**Settlement exceeds policy limit**

The pending amount for Maya ($150.00) exceeds the per-settlement ceiling set in your family policy ($100.00).

**Options:**
- Increase the ceiling via **configure-policy**
- Or wait for auto-settle (which respects the same ceiling and splits across weeks if needed)

Pending balance preserved: $150.00
```

### 13.4 First run of week-shifted family (timezone edge case)

When a family lives far enough west that their "week" is shifted from
UTC week:

The auto-settle Sunday 00:00 UTC may land on Saturday night local
time. The copy says "weekly" or "approximately Sunday" — never
commits to local time.

```markdown
⏳ Pending settlement: $0.73 — auto-settles approximately every Sunday
```

## 14. Quick-reference cheat sheet

For engineers implementing — the eight strings most likely to appear:

| Surface | String |
|---------|--------|
| Pending > 0, kid, manual | `⏳ **Pending settlement:** $X.XX — run **settle-balance** to move it to your wallet` |
| Pending > 0, kid, auto-settle | `⏳ **Pending settlement:** $X.XX — auto-settles Sunday (in N days)` |
| Pending = 0 | (row omitted entirely) |
| Wallet balance, kid | `💰 **In your wallet:** $X.XX ready to spend` |
| settle-balance success | `**Settled $X.XX for {name}**` followed by destinations + new balances |
| settle-balance empty | `**All caught up — nothing to settle**` |
| settle-balance allowlist | `**Settlement on hold** / **Settlement blocked by policy**` |
| settle-balance partial | `**Partial settlement** for {name}` with ✅ and ⚠️ per destination |

## 15. Localization placeholders

Sprint 4.0.3 ships English only. Future localization should anchor on:

- **Spanish (es-419, neutral Latin American):** for Juan's
  Washington Heights/Bronx audience and the broader Caribbean
  diaspora.
- **Spanish (es-DO, Dominican informal):** parallel track for
  Trillet voice product compatibility.

Translation TODOs are out of scope for 4.0.3 but the copy is structured
so that variable substitution and English phrasings can be replaced
without restructuring the layout.

## 16. Approval and sign-off

This document is the source of truth for Sprint 4.0.3 UX. Approval flow:

1. **Engineering review** (Generator pass) — verify every string in
   the document maps to a test in test-4.0.3.md.
2. **Copy review** (Evaluator pass) — read every string aloud; check
   for tone, role-appropriateness, ban-list compliance.
3. **Pilot family acceptance** — one parent + one kid use the new
   flow for 3 days; report whether copy reads naturally.
4. **Sign-off** — Juan + (optionally) a copywriter or designer.

Only after all four passes is this document considered "final" and the
deployed strings must match it verbatim. Any post-approval change
requires updating this document FIRST, then the code.