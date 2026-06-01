# AllowMe — Docs & Onboarding Plan

> Planning artifact for AllowMe's public docs and onboarding flow.
> Modeled structurally on the Base MCP quickstart
> (https://docs.base.org/ai-agents/quickstart) — which is the right
> template — but adapted for the three ways AllowMe differs from Base:
> it onboards a *family across roles* (not one adult), its safety story
> is *parental control + child agency within rails* (not just
> transaction approval), and its audience has *low assumed crypto
> fluency* (not high).
>
> Scope: this plan covers docs writable DURING the Sprint 4.4 soak
> window — i.e. documenting AllowMe's CURRENT state (custom-connector /
> ChatGPT dev-mode connection), not the future App Directory install
> flow. The directory-install path is added later, after the
> Distribution Readiness program.

## 0. What we're copying from Base, and what we're changing

### Copy wholesale (Base got these right)

- **Demo-first structure.** The page opens with an interactive/animated
  demo of the assistant doing real work, BEFORE any setup steps. Seeing
  the outcome first is what earns the reader's patience for the steps.
- **Steps component: Connect → Install skill → Try it.** Three numbered
  steps, each self-contained. This is the spine.
- **Per-client Tabs.** Base forks Connect and Install-skill by client
  (Claude / ChatGPT / Claude Code / Cursor / etc). AllowMe keeps this —
  the connection mechanics genuinely differ per client.
- **"Try it" prompt menu.** A set of copy-paste starter prompts at the
  end so the reader's first interaction succeeds.
- **The skill-on-the-fly vs persistent-skill split.** Base offers
  "paste this prompt to read the SKILL.md live" OR "install the
  persistent skill." AllowMe should offer the same two paths.
- **Approval-modal demo.** Base animates the Base Account approval modal
  so the safety story is *shown*, not told. AllowMe shows its own
  equivalents (allowlist gate, settle-balance preview).

### Change deliberately (Base's choices don't fit AllowMe)

- **Fork by ROLE, not just by client.** Base's reader is one adult.
  AllowMe's reader is one of: Manager, Co-parent, Learner (kid),
  Family viewer, Advisor. Each has a different first session. The docs
  need a role selector as the primary fork, with client-tabs nested
  underneath.
- **Add a "What is AllowMe / what is a wallet" pre-layer.** Base assumes
  crypto fluency. AllowMe's audience explicitly includes families with
  low crypto fluency (the mission). A plain-language primer comes
  BEFORE the quickstart — skippable for the fluent, essential for the
  target user.
- **Lead with the family-control safety story.** Base's safety pitch is
  "you approve every transaction." AllowMe's is "parents control what
  kids can do; kids earn and settle within those rails; nobody can move
  money to an unapproved destination." This is a stronger story and it's
  the one the ChatGPT App Directory reviewers will scrutinize. Lead
  with it.
- **Bilingual from day one (EN/ES).** AllowMe's audience is bilingual
  (Washington Heights / Bronx, Caribbean diaspora). Base is English-only.
  The docs structure must support an ES-419 translation track, even if
  ES ships after EN.
- **Document the CURRENT connection reality.** AllowMe is a custom
  connector (Claude) and a dev-mode app (ChatGPT) today — NOT a
  directory-listed app. The connection steps document that. No
  "Add to Claude" deep-link button or "Install from directory" flow
  until those actually exist.

## 1. Information architecture

Proposed top-level structure for `docs.allowme.dev` (or wherever it
lands):

```
Overview
  What is AllowMe?              ← plain-language, no crypto assumed
  How families use it           ← the role model explained simply
  Is my money / my kid safe?    ← the safety story, lead with this

Quickstart
  Get Started with AllowMe      ← the Base-style demo + steps page
    → role fork: Manager / Co-parent / Kid / Family / Advisor
      → client fork (nested): Claude / ChatGPT / Claude Code / ...

Guides  (the per-task pages, Base-style)
  Create your family            (Manager)
  Invite a co-parent or kid     (Manager)
  Set allowance rules           (Manager — configure-policy)
  Verify an achievement         (Manager / Co-parent)
  Check progress                (all roles)
  Settle balances               (Manager / Kid)        ← Sprint 4.3
  Manage savings                (Manager / Kid)
  Join a family you were invited to   (Co-parent / Kid)
  Learning Mode sessions        (Kid)                  ← Sprint 4.0

Concepts
  Roles & permissions           ← the 5-role RBAC, explained
  Earned vs. settled            ← Sprint 4.3 mental model, load-bearing
  The savings vault             ← locked / released / pending
  Authorized destinations       ← Sprint 3.0.2 allowlist, in plain words
  Approvals & control           ← who approves what

Reference
  Tool list                     ← every MCP tool, what it does, who can call it
  Privacy & data                ← promote docs/PRIVACY.md (Sprint 4.2)
  Troubleshooting / FAQ
```

The **Quickstart** page is the Base-equivalent and the priority
deliverable. Everything else can follow.

## 2. The Quickstart page — section by section

This is the page that mirrors the Base MCP quickstart. Structure:

### 2.1 Demo (top of page, before steps)

Base animates a chat doing "Send 5 USDC." AllowMe's demo should show
the *family* flow, not a single transaction. The strongest single demo:

> A kid logs a reading achievement → the parent verifies it → the kid
> runs check-progress and sees "Earned this week: $4.23 · In your
> wallet: $3.50 · Pending: $0.73" → the kid runs settle-balance →
> "$0.73 moved to your wallet."

That one animation tells the whole AllowMe story: kids earn, parents
verify, money settles on approval, and the earned-vs-settled distinction
(Sprint 4.3) is visible. It also shows the safety rails without a
lecture.

If a single animation is too much for v1, a static annotated
screenshot sequence works — the point is *show the family loop before
asking anyone to set up*.

### 2.2 Step 1 — Choose your role

This is the AllowMe-specific fork that Base doesn't have. A role
selector:

- **I'm a parent setting up for my family** → Manager path
- **I was invited by my partner** → Co-parent path
- **I was invited by my parent** → Kid path
- **I help a family with their finances** → Advisor path

Each role's path then nests the client tabs (Claude / ChatGPT / etc).
The Manager path is the longest (they bootstrap the family). The Kid
path is the shortest and most carefully worded (child-safety: no wallet
setup, invite-only, no financial jargon).

### 2.3 Step 2 — Connect AllowMe (per client, nested under role)

Document the CURRENT connection reality. Per the Base template's Tabs,
but with AllowMe's actual URLs and the dev-mode caveat.

**Claude tab (custom connector — current state):**

```
1. Open Customize → Connectors → Add custom connector
2. Fill in:
   - Name: AllowMe
   - Remote MCP server URL: https://allowme.dev/mcp
3. Click Add
4. Click Connect, then complete sign-in
```

Note: no "Add to Claude" deep-link button yet (that requires the
connector to be set up for deep-linking; document the manual add).
Works in Claude.ai and Claude Apps.

**ChatGPT tab (developer-mode app — current state, matches your
screenshot):**

```
1. Open Settings → Apps → Advanced settings
2. Enable Developer Mode if prompted
3. Click Create to open the New App modal
4. Fill in:
   - Name: AllowMe
   - Description: Family allowance and savings on Base
   - MCP Server URL: https://allowme.dev/mcp
   - Authentication: OAuth
5. Check "I understand and want to continue" on the risk warning
6. Click Create
7. Complete sign-in to authorize
```

This matches exactly what Image 5 shows (allowme as a DEV app under
Apps → Advanced settings). When the App Directory submission lands
later, ADD an "Install from directory" path above this; don't remove
the dev-mode path (it stays useful for testing).

**Claude Code / Codex / Cursor tabs:** same shape as Base —
`claude mcp add --transport http allowme https://allowme.dev/mcp` and
equivalents. These are for the developer/advisor audience, not parents.

### 2.4 Step 3 — Install the AllowMe skill (optional but recommended)

Mirror Base's two-option split:

- **Option 1 (no install):** paste a prompt pointing the assistant at
  `https://allowme.dev/skill/SKILL.md` (if/when you publish one). The
  assistant reads onboarding on the fly.
- **Option 2 (persistent skill):** download `allowme-skill.zip`, upload
  via Customize → Skills (Claude) or Settings → Skills (ChatGPT).

NOTE: this step depends on AllowMe actually publishing a SKILL.md and
a packaged skill. If those don't exist yet, Step 3 is "coming soon" or
omitted from v1. Don't document a skill that isn't published — that's
the same fiction trap as documenting directory-install before
submission. Flag for decision: does AllowMe have a published skill?

### 2.5 Step 4 — Try it (role-specific starter prompts)

Base gives generic prompts. AllowMe's should be role-specific:

**Manager starter prompts:**
```
Set up a new family called the Garcias
Invite my daughter Maya as a learner
Set Maya's weekly allowance to $15 with 20% going to savings
Verify that Maya read for 30 minutes today
```

**Kid starter prompts (carefully worded, no jargon):**
```
How am I doing this week?
How much have I earned?
Move my earnings to my wallet
How much is in my savings?
```

**Co-parent / Advisor prompts:** scoped to their permissions.

Every money-moving prompt should note: "AllowMe will show you exactly
what will happen and ask you to approve before anything moves" — the
Base-equivalent of "every write action requires approval," but framed
as family control.

## 3. The pre-quickstart primer (AllowMe's addition to the Base model)

Base has nothing before the quickstart. AllowMe needs a short,
plain-language primer for the low-crypto-fluency audience. Three short
pages:

### 3.1 "What is AllowMe?" (no crypto words)

One screen. "AllowMe helps your family turn good habits — reading,
chores, learning — into real savings your kids can see and grow. You
set the rules. Your kids earn. You approve. The money is real and it's
theirs." No "blockchain," no "USDC," no "wallet" in the first
paragraph. Those come later, defined gently.

### 3.2 "How families use it" (the role model, simply)

A diagram: Parent (sets rules, verifies, approves) → Kid (earns,
checks progress, settles) → Savings (grows over time). Co-parent and
Advisor as optional add-ons. This is the 5-role RBAC explained without
the term "RBAC."

### 3.3 "Is my money and my kid safe?" (lead the safety story)

This is the page that does the most work — for parents AND for
eventual App Directory reviewers. Plain-language coverage of:

- **You approve every money movement.** Nothing moves without a parent
  (or, for their own earnings, the kid) confirming.
- **Money can only go to destinations you've authorized.** (Sprint
  3.0.2 allowlist, in plain words.) Even if something went wrong,
  funds can't be sent somewhere you didn't approve.
- **Kids can't do parent things.** (RBAC.) A kid can check their
  progress and move their own earnings; they can't change the rules,
  invite people, or touch a sibling's money.
- **Earnings are clearly separated from spendable money.** (Earned vs.
  settled, Sprint 4.3.) Kids see what they've earned and what's
  actually in their wallet — no confusion, no hidden balances.
- **Your data.** Link to the privacy page (Sprint 4.2 docs/PRIVACY.md
  promoted to public).

## 4. Deliverables and sequencing (fits the soak window)

Ordered by value, all doable during the Sprint 4.4 soak without
touching the ledger schema:

1. **Quickstart page (§2)** — the Base-equivalent. Highest priority.
   Demo + role fork + per-client connect + try-it prompts. Documents
   current connection reality (custom connector / dev-mode).
2. **Safety primer (§3.3)** — "Is my money and my kid safe?" Second
   priority because it's load-bearing for both parents and the eventual
   directory submission. Much of the content already exists in the
   Sprint 4.3 copy doc and the Sprint 4.2 privacy work; this is
   assembly, not invention.
3. **Concepts: Earned vs. settled (§1)** — the Sprint 4.3 mental model
   is the one most likely to generate confusion (the "where's my
   money" trap from the Sprint 4.3 copy work). A dedicated concept page
   pre-empts support tickets. Pull directly from copy-4.3.md.
4. **What is AllowMe / How families use it (§3.1, §3.2)** — the
   plain-language primer. Lower priority than the quickstart only
   because a motivated user can get through the quickstart without it;
   but essential for the actual target audience.
5. **Guides (per-task pages)** — flesh out after the quickstart spine
   exists. Each maps to one MCP tool or one role-task.
6. **Reference: tool list + privacy** — assemble from existing sprint
   artifacts.

## 5. Open decisions before drafting copy

1. **Does AllowMe have a published SKILL.md / packaged skill?** If yes,
   Step 3 (§2.4) is real. If no, Step 3 is omitted or "coming soon" for
   v1. (Don't document an unpublished skill.)
2. **Docs platform.** Base uses a Mintlify-style setup (Tabs, Steps,
   Cards components). What is AllowMe's docs stack? The role-fork +
   nested-client-tabs structure needs a docs framework that supports
   tabbed/stepped components. If you're on plain Markdown, the structure
   simplifies (sequential sections instead of interactive tabs).
3. **EN-only v1, or EN+ES from the start?** Recommend EN-first,
   ES-structured (write so translation drops in cleanly), ES ships
   second. But confirm.
4. **Demo: animated or static?** Base uses a custom animated React
   component. That's a real build. A static annotated screenshot
   sequence delivers 80% of the value for 10% of the effort. Recommend
   static for v1, animate later if the page earns the investment.
5. **Domain.** `docs.allowme.dev`? Confirm where this lives so internal
   links resolve.

## 6. What this plan deliberately excludes

- **App Directory install instructions** (ChatGPT or otherwise) — not
  until the Distribution Readiness program ships the submission. Today's
  reality is dev-mode / custom-connector, and that's what gets
  documented.
- **"Add to Claude" / "Add to ChatGPT" deep-link buttons** — those
  require connector setup AllowMe hasn't done. Manual-add steps only.
- **OAuth 2.1 authorization-server docs** — that's Distribution
  Readiness (Sprint 5.0) work. Current connection uses AllowMe's
  existing auth; document that.
- **Anything that touches the Sprint 4.4 ledger schema or production
  behavior** — this is docs work, deliberately chosen because it's
  safe during the soak freeze.
```