# Kid Dashboard — design proposal

A graphical, kid-facing dashboard for AllowanceAgent. Today the kid-facing surface is Markdown rich cards rendered inside Claude (Sprint 3.6: `check-progress`, `check-savings`, `check-goals`). This proposes a visual layer on top of the **same data the existing MCP tools already return** — no new backend, no change to how AllowMe works.

> Status: design prototype with mock data. Not wired to the server. Contributed on branch `shageenth/kid-dashboard-design` for discussion.

## What's here

| File | What it is |
|---|---|
| `kid-dashboard-builders.html` | Self-contained visual prototype (open in a browser). Builders age band, 8–11. |
| `PRODUCT-DESIGN-PACKAGE.md` | The product-design package: problem statement, personas, user stories, flows, IA, Figma-ready prompt, acceptance criteria, success metrics. |

## It maps onto tools that already exist

Every element on the dashboard is data the server already produces. This is a render layer, not new logic.

| Dashboard element | Source tool | Field(s) |
|---|---|---|
| "Money you've earned" | `check-progress` | `totalEarnedMicro` / wallet `walletBalanceMicro` (spendable) |
| "+$1.50 this week" | `check-progress` | earned this week vs `weeklyBudgetMicro` |
| Pending (earned, not yet settled) | `check-progress` | `pendingLedgerMicro` (the earned-vs-settled ledger, Sprint 4.0.3) |
| Goal card + progress | `check-goals` / `check-progress` | `learningGoals`, subgoal status, category budgets |
| Savings vault ($5 → $7.50, days left) | `check-savings` | locked amount, `multiplierAtDeposit`, release dates |
| Streak chip | `check-progress` | `streak.currentStreak`, `streak.multiplier` |
| Badges / tiers | (derivable) | streak/goal milestones |
| "Why you earned this" | Learning Mode | session receipt (`generateTemplateReceipt`) + `resolveConfidenceFlag` (the "ok"/"low" signal) |

Notably, the **"why you earned this"** panel is just a kid-friendly surfacing of what Learning Mode already computes — the receipt plus the confidence flag (`learning-mode.ts`). The low-confidence signal (median turn interval < 5s) is the same anti-gaming check; here it becomes the honest "a grown-up double-checked the last one" line.

## Two ways to ship it (same data either way)

1. **MCP App (recommended, MCP-native).** Ship this as an interactive UI resource the way the product already ships Markdown cards. The dashboard renders inline in Claude/ChatGPT, reading the tool results. This fits the existing architecture and Sprint 3.6's rich-card direction.
2. **Standalone web dashboard.** A small web app reading the same data over HTTP for kids who don't drive Claude directly (the younger Path A children).

Both consume the existing tool output. The expensive part (data, policy, ledger, RBAC) already exists.

## Design language

Claymorphism (soft inflated cards, candy-pastel palette, rounded display font), per current kids'-app and fintech-for-kids conventions. Money shown in **USD** (matches USDC on Base), no wallet addresses or tx hashes in the child's view. Progress framed as "almost there," the vault as growth (not loss), a kind streak with a calm "all done today," and plain-language reward explanations. Full rationale, age-banding (Sprouts 5–7 / Builders 8–11 / Founders 12–16), accessibility (WCAG 2.1 AA), and metrics are in `PRODUCT-DESIGN-PACKAGE.md`.

## Out of scope here

No `src/` changes. This is design only — for review before any implementation work.
