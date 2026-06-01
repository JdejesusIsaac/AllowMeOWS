# Quickstart Page — Docs Contract (Deliverable 1)

**Status:** Derived from [`onboarding-plan.md`](../onboarding-plan.md) §2 and the Base MCP quickstart template (https://docs.base.org/ai-agents/quickstart). Pending user confirmation of the flagged assumptions in §11.
**Inputs:** `onboarding-plan.md` v1 (IA §1, Quickstart spec §2, primer §3, sequencing §4, open decisions §5, exclusions §6); the deployed AllowMe build (current connection reality: Claude custom-connector, ChatGPT dev-mode app).
**Deliverable type:** Docs — a single page (`Get Started with AllowMe`). No code, no schema, no product behavior.
**Doc class:** **Accuracy-critical onboarding.** The load-bearing failure mode is *documenting something that does not exist yet* (a fiction-trap, §6) — it burns reviewer trust and produces dead-end setup steps for real families. The rubric (§5) is weighted toward Accuracy / No-fiction accordingly.
**Scope discipline:** This contract grades **only** the Quickstart page (`onboarding-plan.md` §2). Deliverables 2–6 (safety primer, earned-vs-settled concept, "What is AllowMe", guides, reference) are out of scope and the Evaluator MUST NOT penalize their absence (§8).

---

## 1. Problem framing (recorded inline)

**Problem statement.** AllowMe has no public onboarding. A family arriving from a referral has no documented path to connect AllowMe to their assistant and complete a first session. Base solved the equivalent problem for a single crypto-fluent adult; AllowMe must solve it for a *family across five roles* with *low assumed crypto fluency*, while AllowMe is still a **custom connector (Claude) / dev-mode app (ChatGPT)** — not a directory-listed app.

**"What is" statement.** Today the only way to connect is the manual custom-connector (Claude) or Developer-Mode app-creation (ChatGPT) flow. There is no "Add to Claude" button, no App Directory listing, no published packaged skill (assumption A2), and no OAuth 2.1 authorization-server documentation. Any docs that imply otherwise are fiction.

**Solution thesis.** A Base-style Quickstart that (a) shows the *family loop* in a demo before asking anyone to set anything up, (b) forks by **role first**, then by **client** nested underneath, (c) documents the connection mechanics *exactly as they exist today*, and (d) ends with role-specific copy-paste prompts that make the first interaction succeed.

**Definition of done (D1).** The rendered Quickstart page satisfies every criterion C1–C12 (§4), contains zero hard-fail fictions (§6), and conforms to the structural component tree (§7). Every user-visible string is either lifted from `onboarding-plan.md` §2 or flagged as an assumption (§11) — never invented.

---

## 2. Scope

**In scope** — the Quickstart page (`onboarding-plan.md` §2), five sub-surfaces:

1. **Demo block** (§2.1) — the family-loop demo, placed above all setup steps.
2. **Role fork** (§2.2) — a role selector as the primary fork.
3. **Per-client connect** (§2.3) — client tabs nested under each role, documenting current reality.
4. **Skill step** (§2.4) — the optional install-skill step, gated on whether a skill is actually published (A2).
5. **Try-it prompts** (§2.5) — role-specific starter prompts with approval framing.

**Out of scope (deliberate — Evaluator MUST NOT penalize, see §8):**
- The pre-quickstart primer pages (§3.1 "What is AllowMe?", §3.2 "How families use it", §3.3 safety primer) — Deliverable 2+.
- Concepts pages (earned-vs-settled, savings vault, authorized destinations) — Deliverable 3.
- Per-task Guides and the Reference/tool-list — Deliverables 5–6.
- The ES-419 *translation itself* — only the *structural readiness* for it is in scope (C9, A4).
- The animated React demo component — static is acceptable for v1 (A3).

---

## 3. Deliverables

| ID | Deliverable | Source | Criterion |
|----|-------------|--------|-----------|
| DEL1 | Demo block rendering the family loop (log achievement → verify → check-progress → settle-balance) above the steps | §2.1 | C1 |
| DEL2 | Role selector as the primary fork, covering the confirmed role set (A6) | §2.2 | C2, C8 |
| DEL3 | Client tabs (A7) nested **inside** each role path | §2.3 | C3, C10 |
| DEL4 | Connection copy for Claude (custom connector) + ChatGPT (dev-mode), verbatim to current reality with dev-mode caveat | §2.3 | C4, C11 |
| DEL5 | Skill step — Option-1 (on-the-fly) / Option-2 (persistent) **only if** a skill is published; else "coming soon"/omitted | §2.4 | C5, C11 |
| DEL6 | Role-specific try-it prompts with the approval-framing line on every money-moving prompt | §2.5 | C6 |
| DEL7 | Family-control safety framing surfaced on the page (lead, not buried) | §2.5, §0 | C7 |
| DEL8 | Bilingual-ready structure (ES-419 track can drop in) | §0, A4 | C9 |

---

## 4. Acceptance criteria

Twelve criteria, each verifiable from the **rendered page + its source** alone (no reliance on planning docs or author intent — mirrors the Evaluator's "deployed build only" rule).

### Accuracy / No-fiction (35% rubric weight)

**C4 — Connection steps match current reality, verbatim.** The Claude tab documents the **custom-connector** flow (Customize → Connectors → Add custom connector; Name `AllowMe`; Remote MCP server URL `https://allowme.dev/mcp` [A5]; Add → Connect → sign in). The ChatGPT tab documents the **Developer-Mode app** flow (Settings → Apps → Advanced settings → enable Developer Mode → Create → New App modal with Name/Description/MCP Server URL/Authentication OAuth → risk-warning checkbox → Create → sign in). Both steps match `onboarding-plan.md` §2.3 step-for-step. The ChatGPT tab explicitly states the dev-mode caveat. *Source: §2.3.*

**C11 — Zero fiction.** The page contains **none** of the HF1–HF5 items in §6. Specifically: no "Install from directory", no "Add to Claude/ChatGPT" deep-link button, no documentation of a skill that isn't published (A2), no OAuth 2.1 authorization-server setup, and no future-state connection path presented as available today. *This criterion is a gate — see §6 and §8.*

**C12 — Internal links and references resolve.** Every cross-link (to primer/concepts/guides/reference pages, the privacy page, the skill asset) either resolves to a real target or is marked "coming soon"; no dangling anchors. The MCP URL and domain are consistent with A5 throughout. *Source: §1 IA, §5 open decision 5.*

### Structure / Information architecture (25% rubric weight)

**C1 — Demo-first ordering.** A demo of the *family loop* renders **before** any numbered setup step. The demo shows: a kid logs an achievement → a parent verifies → the kid runs check-progress and sees the earned / in-wallet / pending breakdown → the kid runs settle-balance and pending moves to the wallet. Static annotated screenshots satisfy this (A3); a single transaction demo does NOT (must be the family loop, not "send 5 USDC"). *Source: §2.1.*

**C2 — Role fork is the primary fork.** A role selector appears as the first decision after the demo, ahead of any client choice. It covers the confirmed role set (A6) with the plain-language entry labels from §2.2 ("I'm a parent setting up for my family", "I was invited by my partner", "I was invited by my parent", "I help a family with their finances", and the Family-viewer entry per A6). *Source: §2.2.*

**C3 — Client fork nested under role.** Client choice (A7) is presented **inside** each role path, never as a sibling-or-above fork. Selecting a role then reveals that role's client tabs. *Source: §2.2–§2.3, §7.*

**C10 — Mintlify component correctness.** Steps use `<Steps>`; the role fork and the nested client fork use `<Tabs>`/`<Tab>` (A1); the page builds without unclosed/misnested components. The structural tree matches §7. *Source: A1, §7.*

### Copy / UX clarity (20% rubric weight)

**C6 — Try-it prompts are role-specific with approval framing.** Each role path ends with copy-paste starter prompts scoped to that role's permissions (Manager set-up prompts; Kid no-jargon prompts; Co-parent/Advisor scoped). Every money-moving prompt carries the line: *"AllowMe will show you exactly what will happen and ask you to approve before anything moves."* *Source: §2.5.*

**C8 — Kid/Learner path is child-safe.** The Kid path is the shortest, contains no financial jargon, includes no wallet-setup step, and is invite-only (no family-creation affordance). Its prompts match the §2.5 kid set ("How am I doing this week?", "How much have I earned?", "Move my earnings to my wallet", "How much is in my savings?"). *Source: §2.2, §2.5.*

### Safety framing (12% rubric weight)

**C7 — Family-control safety story leads.** The page surfaces the family-control framing ("parents control what kids can do; kids earn and settle within those rails; money can only go to authorized destinations") at or near the top — shown via the demo's approval moment and stated in copy — rather than deferring the entire safety story to the primer. The approval/allowlist control is *shown*, not only told. *Source: §0 "Lead with the family-control safety story", §2.1.*

### Bilingual readiness (8% rubric weight)

**C9 — ES-419 structural readiness.** The page structure supports an es-419 translation track dropping in cleanly (per A4): strings are not baked into images that block translation, the component tree is duplicable per-locale, and no copy hard-codes English-only structure. EN ships first; ES need not be present. *Source: §0 "Bilingual from day one", §5 open decision 3.*

---

## 5. Rubric (Accuracy-critical onboarding class)

| Category | Weight | Definition | Locked criteria |
|----------|--------|------------|-----------------|
| Accuracy / No-fiction | **35%** | Connection steps match current reality verbatim; zero fiction-traps; links resolve | C4, C11, C12 |
| Structure / IA | **25%** | Demo-first; role-as-primary-fork; client nested under role; valid Mintlify components | C1, C2, C3, C10 |
| Copy / UX clarity | **20%** | Role-specific prompts with approval framing; child-safe kid path | C6, C8 |
| Safety framing | **12%** | Family-control story leads and is shown, not buried | C7 |
| Bilingual readiness | **8%** | Structure ready for es-419 drop-in | C9 |
| Originality | (reviewed) | Role-first fork (Base's improvement); family-loop demo over single-tx demo; shown-not-told safety | reviewed in evaluation |

**Why Accuracy gets 35%:** AllowMe is pre-directory and pre-skill. The single most damaging docs failure is sending a real family down a setup path that doesn't exist (an "Install from directory" button, a skill that isn't published). It also directly determines whether the eventual App Directory reviewer trusts the docs. Every fiction-trap is a fail-gate, not a deduction.

**Why Structure gets 25%:** The role-first fork is the deliberate improvement over Base (`onboarding-plan.md` §0). If client is the primary fork, or the demo follows the steps, the page has reverted to the Base template the plan explicitly adapts away from.

**Why Safety is only 12% here:** The *load-bearing* safety page is the primer (§3.3, Deliverable 2), out of scope. The Quickstart only needs to *lead* with and *show* the control story — full coverage is graded in D2's contract.

---

## 6. Hard-fail list (fiction-traps)

Presence of **any** of the following is an automatic Fail (gates C11). Each cites its source so the Evaluator can verify against the plan, not opinion.

- **HF1 — App Directory install flow.** Any "Install from the ChatGPT/Claude directory" path. → `onboarding-plan.md` §6, §2.3, §0 "Document the CURRENT connection reality".
- **HF2 — Deep-link install buttons.** Any "Add to Claude" / "Add to ChatGPT" one-click button. → §2.3 (note: "no deep-link button yet… document the manual add"), §6.
- **HF3 — Unpublished skill documented as real.** Step 3 presenting a downloadable/persistent skill as available when none is published (gated by A2). → §2.4 ("Don't document a skill that isn't published — that's the same fiction trap"), §5 open decision 1.
- **HF4 — OAuth 2.1 authorization-server docs.** Any authorization-server setup instructions. → §6 (Sprint 5.0 / Distribution Readiness work).
- **HF5 — Future-state-as-current.** Any connection mechanic that does not exist in the deployed build presented as currently available. → §0, §6.

**Non-fail companion rule (allowed):** It IS permitted to note "coming soon: directory install / one-click add / packaged skill" as clearly future-tense, provided it is not presented as an available step and does not appear inside the numbered Connect/Install steps.

---

## 7. Structural requirements — the role → client fork

The page MUST realize this component tree (Mintlify, per A1). The role fork is outermost; client tabs are nested per role.

```
Page: "Get Started with AllowMe"
├─ <demo>                         # family loop, BEFORE steps (C1)
├─ <Steps>
│  ├─ Step 1: Choose your role
│  │  └─ <Tabs> (role)            # PRIMARY fork (C2)
│  │     ├─ <Tab "Manager">       # longest path; family bootstrap
│  │     ├─ <Tab "Co-parent">     # invited; join flow
│  │     ├─ <Tab "Kid/Learner">   # shortest; child-safe (C8)
│  │     ├─ <Tab "Advisor">       # scoped permissions
│  │     └─ <Tab "Family viewer"> # per A6 — confirm inclusion
│  ├─ Step 2: Connect AllowMe
│  │  └─ (within each role Tab) <Tabs> (client)   # NESTED fork (C3)
│  │     ├─ <Tab "Claude">        # custom connector (C4)
│  │     ├─ <Tab "ChatGPT">       # dev-mode app + caveat (C4)
│  │     ├─ <Tab "Claude Code">   # CLI add
│  │     ├─ <Tab "Codex">         # CLI add
│  │     └─ <Tab "Cursor">        # CLI add
│  ├─ Step 3: Install the skill   # optional; gated by A2 (C5/HF3)
│  └─ Step 4: Try it              # role-specific prompts (C6)
└─ (safety framing surfaced in demo + copy — C7)
```

Rules:
- Role Tabs MUST enclose client Tabs, not vice versa (C3). A flat client-only fork is a structural fail (reverts to Base).
- The Kid/Learner role Tab MUST NOT contain a wallet-setup or family-creation step (C8).
- Steps 3–4 sit at page level after the per-role Connect, OR are repeated per role if the prompts differ — the try-it prompts MUST be role-specific regardless (C6).

---

## 8. Out-of-scope reminders (Evaluator MUST NOT penalize)

- Absence of the primer pages §3.1/§3.2/§3.3 (Deliverable 2+).
- Absence of concepts (earned-vs-settled, savings vault, allowlist) — Deliverable 3.
- Absence of per-task Guides and the Reference/tool-list — Deliverables 5–6.
- Absence of an *actual* es-419 translation (only structural readiness is graded — C9).
- Absence of an animated demo component (static screenshots satisfy C1 — A3).
- Absence of a directory-install / deep-link / skill path — their absence is *required* (§6), never penalized.

---

## 9. Hand-off rules

1. Generator authors the page per this contract + `onboarding-plan.md` §2. Generator does NOT self-evaluate.
2. **Current-reality rule:** if a connection mechanic's current state is uncertain at author time, the Generator runs a 5-minute verification against the live Claude/ChatGPT connect flow before writing the step — and if still unverifiable, marks it "coming soon" rather than guessing (avoids HF5).
3. **Copy is sourced, not invented:** every user-visible string traces to `onboarding-plan.md` §2 or to a resolved assumption in §11. New copy required by a gap becomes a new flagged assumption, not silent invention.
4. **Assumptions gate the build:** the Generator MUST NOT begin until the §11 assumptions are confirmed/corrected by the user — A2 (skill published?) and A6 (role set) materially change which sections ship.
5. Evaluator (Phase 3) grades the **rendered page + source** against C1–C12, §6, §7 only — never the planning chatter or author rationale.

---

## 10. Grading thresholds

- **Pass:** all of C1–C12 satisfied; each rubric category at ≥75% of its weight; zero §6 fiction-traps.
- **Fail:** any §6 fiction-trap present (C11). OR C4 connection steps diverge from current reality. OR C1 demo absent / placed after steps. OR C2/C3 fork order wrong (client primary, or role not the outer fork). OR C8 kid path exposes wallet-setup/family-creation.
- **Soft-fail (Pass-with-followup):**
  - C9 bilingual-readiness partially met (e.g., one image embeds English text) AND all Accuracy + Structure criteria clean → Pass with a translation-readiness ticket.
  - C7 safety framing present but stated-only (not shown in the demo) AND everything else clean → Pass with a demo-annotation ticket.
  - C12 a single internal link points to a not-yet-built page that is correctly labeled "coming soon" → Pass (this is expected during the docs build-out).

---

## 11. Documented assumptions (confirm before the Generator runs)

Written research-doc style. Correct any of these and I will fold the correction into the criteria above.

### A1 — Docs stack
**Status:** CONFIRMED — Mintlify (Tabs / Steps / Cards). Structural criteria (C10, §7) target Mintlify components.

### A2 — Published skill
**Status:** ASSUMED — **no** `SKILL.md` / packaged skill is published today. Consequence: C5 ships Step 3 as "coming soon" (or omits it), and HF3 is active. *Correct if a skill exists* — then Step 3 becomes a real deliverable (Option-1 on-the-fly + Option-2 persistent per §2.4) and the skill asset URL must be supplied.

### A3 — Demo medium
**Status:** ASSUMED — static annotated screenshot sequence for v1 (plan §5 recommendation), animate later. C1 accepts static.

### A4 — Localization
**Status:** ASSUMED — EN-only v1, structured for es-419 drop-in; ES ships second (plan §5 recommendation). C9 grades readiness, not presence.

### A5 — Domain + MCP URL
**Status:** ASSUMED — docs at `docs.allowme.dev`; MCP server URL `https://allowme.dev/mcp` (from plan §2.3). Confirm both for C4 verbatim copy and C12 link resolution.

### A6 — Role set in the selector
**Status:** ASSUMED — **discrepancy in the source.** Plan §2.2 lists four selector entries (Manager / Co-parent / Kid / Advisor); IA §1 lists five roles including **Family viewer**. Assumed: Family-viewer gets a minimal Quickstart path (read-only: check-progress, view receipts). *Confirm the exact selector role list* — this changes DEL2/C2/§7.

### A7 — Client list
**Status:** ASSUMED — Claude, ChatGPT, Claude Code, Codex, Cursor (from §2.3). The CLI clients (Claude Code/Codex/Cursor) are flagged in the plan as developer/advisor-audience, not parent-facing; assumed they appear only under the Manager/Advisor role paths, not the Kid path. *Confirm.*

### A8 — Earned-vs-settled version labeling
**Status:** ASSUMED — **discrepancy in the source.** The plan repeatedly labels settle-balance / earned-vs-settled as "Sprint 4.3"; in this repository that work shipped as **Sprint 4.0.3** (just deployed to `main`/Railway). Assumed: the demo (C1) reflects the *current shipped behavior* regardless of the plan's label. *Confirm the version label to use in any user-visible copy* (likely none — users don't see sprint numbers).

---

## 12. Status

- Contract version: 1.0
- Approval: **pending user confirmation of §11 assumptions** (A2 and A6 are blocking — they change which sections ship).
- Generator entry point on approval: DEL1 (demo block) → DEL2 (role selector) → DEL3/DEL4 (nested connect) → DEL5 (skill, gated) → DEL6/DEL7/DEL8.
- Evaluator entry point on hand-off: this contract + the rendered page + its source only.
- Sibling artifact (not in this deliverable): a `docs-quickstart/test.md` mapping C1–C12 to concrete inspectable checks can follow next.
