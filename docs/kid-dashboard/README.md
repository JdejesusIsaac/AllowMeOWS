# Kid Dashboard — design proposal

A graphical, kid-facing dashboard for AllowanceAgent. Today the kid-facing surface is Markdown rich cards rendered inside Claude (Sprint 3.6: `check-progress`, `check-savings`, `check-goals`). This proposes a visual layer on top of the **same data the existing MCP tools already return** — no new backend, no change to how AllowMe works.

> Status: design prototype with mock data. Not wired to the server. Contributed on branch `shageenth/kid-dashboard-design` for discussion.

## What's here

Open `index.html` in a browser to browse all three age bands.

| File | What it is |
|---|---|
| `index.html` | Landing page linking the three age-band prototypes + the design package. |
| `kid-dashboard-sprouts.html` | Prototype — Sprouts age band, 5–7 (no dollars/settlement; stars + one lesson). |
| `kid-dashboard-builders.html` | Prototype — Builders age band, 8–11 (the reference design). |
| `kid-dashboard-founders.html` | Prototype — Founders age band, 12–16 (full detail: settle control, study plan, gold). |
| `kid-dashboard.css` | Shared claymorphism design system (fonts + tokens) used by all three. |
| `PRODUCT-DESIGN-PACKAGE.md` | The product-design package: problem statement, personas, user stories, flows, IA, Figma-ready prompt, acceptance criteria, success metrics. |

### One engine, three skins

A 5-year-old and a 14-year-old are cognitively different users. Same underlying data, three developmentally-distinct renders:

| Band | Ages | What changes |
|---|---|---|
| Sprouts | 5–7 | No dollar amounts, no settlement, no categories. One goal as collectible stars; one lesson; gentle. (Under-7s can't reliably rank money value or grasp the future.) |
| Builders | 8–11 | Earned-vs-settled, weekly categories, savings vault, goal steps, plain-language reward reasons. The sweet spot — build first. |
| Founders | 12–16 | Adds a settle-now control, the Learning Mode study plan (sessions + phase), savings multiplier, and gold (PAXG) diversification. |

## It maps onto tools that already exist

Every element on the dashboard is data the server already produces. This is a render layer, not new logic.

| Dashboard element | Source tool | Field(s) |
|---|---|---|
| "Money you've earned" | `check-progress` | `totalEarnedMicro` / wallet `walletBalanceMicro` (spendable) |
| "+$1.50 this week" | `check-progress` | earned this week vs `weeklyBudgetMicro` |
| Pending (earned, not yet settled) | `check-progress` | `pendingLedgerMicro` (the earned-vs-settled ledger, Sprint 4.0.3) |
| Goal card + progress | `check-goals` / `check-progress` | `learningGoals`, subgoal status, category budgets |
| Savings vault (locked, boost, days left) | `check-savings` | `totalUsdcLocked`, `multiplierAtDeposit` (the streak multiplier at deposit, not a flat rate), `lockUntil` / `daysRemaining` (90-day default lock), optional PAXG gold position |
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
