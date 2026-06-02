# Quickstart Page — Docs Contract (Deliverable 1)

**Status:** v1.0 + **CA-D1** + **Addendum A** (per-role entry sequence, 2026-06-01). Derived from [`onboarding-plan.md`](../onboarding-plan.md) §2 and the Base MCP quickstart template. See [`contract-amendment-CA-D1.md`](contract-amendment-CA-D1.md) and [`contract-amendment-CA-D1-addendum-A.md`](contract-amendment-CA-D1-addendum-A.md).
**Inputs:** `onboarding-plan.md` v1 (IA §1, Quickstart spec §2, primer §3, sequencing §4, open decisions §5, exclusions §6); the deployed AllowMe build (current connection reality: Claude custom-connector, ChatGPT dev-mode app).
**Deliverable type:** Docs — a single page (`Get Started with AllowMe`). No code, no schema, no product behavior.
**Doc class:** **Accuracy-critical onboarding.** The load-bearing failure mode is *documenting something that does not exist yet* (a fiction-trap, §6) — it burns reviewer trust and produces dead-end setup steps for real families. The rubric (§5) is weighted toward Accuracy / No-fiction accordingly.
**Scope discipline:** This contract grades **only** the Quickstart page (`onboarding-plan.md` §2). Deliverables 2–6 (safety primer, earned-vs-settled concept, "What is AllowMe", guides, reference) are out of scope and the Evaluator MUST NOT penalize their absence (§8).

---

## 1. Problem framing (recorded inline)

**Problem statement.** AllowMe has no public onboarding. A family arriving from a referral has no documented path to connect AllowMe to their assistant and complete a first session. Base solved the equivalent problem for a single crypto-fluent adult; AllowMe must solve it for a *family across five roles* with *low assumed crypto fluency*, while AllowMe is still a **custom connector (Claude) / dev-mode app (ChatGPT)** — not a directory-listed app.

**"What is" statement.** Entry is **role-specific on `allowme.dev/verify`**: Manager signs in with Base first (F7/F8); adult invitees use invite code/link then Base sign-in & join; learners join without a wallet. **Connect** paths: **Claude** — deep-link pre-filled with the role's `?setup=CODE` magic link (F1/F5); **ChatGPT** — settings shortcut (F2) plus dev-mode steps; bare `allowme.dev/mcp` is never the connect URL. No App Directory listing, no published skill (A2), no OAuth 2.1 auth-server docs.

**Solution thesis.** A Base-style Quickstart that (a) shows the *family loop* in a demo before asking anyone to set anything up, (b) forks by **role first**, then by **client** nested underneath, (c) documents the connection mechanics *exactly as they exist today*, and (d) ends with role-specific copy-paste prompts that make the first interaction succeed.

**Definition of done (D1).** The rendered Quickstart page satisfies **C1–C15** (§4), Change F happy-path scope (§6.1), zero fiction-traps (§6), and the structural tree (§7). Copy aligns with `onboarding-plan.md` §2 and the shipped verify page (C14) — never invented.

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

Fifteen criteria, each verifiable from the **rendered page + its source** alone.

### Accuracy / No-fiction (32% rubric weight)

**C4 — Connection steps match current reality, verbatim.** After the role-specific verify entry (Change D), the Claude tab leads with **HF2a** (pre-filled modal) using the role's **`?setup=CODE` magic link** — Manager included (F5; Addendum A supersedes bare MCP for connect). Manual custom-connector steps are fallback. ChatGPT tab: **HF2b** shortcut + full dev-mode steps with magic link as MCP Server URL. *CA-D1 + Addendum A.*

**C13 — Role-determined entry sequence and connection URL.** **Manager:** Step 1 = `allowme.dev/verify` → Sign in with Base (only role with entry Base sign-in); Step 2 = connect with **your** post-verify magic link (`?setup=…`). **Adult invitees** (co-parent, family-viewer, advisor): Step 1 = invite code or forwarded link → Look up invite → Sign in with Base & join; Step 2 = connect with invite magic link. **Learner:** Step 1 = open parent's link → join without wallet; connect via Open in Claude / magic link. Bare `https://allowme.dev/mcp` is **never** the connect URL for any role.

**C14 — Quickstart ↔ verify-page consistency.** Entry steps, invite-code path, adult vs learner join, "magic link", and "Open in Claude" match `public/verify.html`. Quickstart conforms to verify, not the reverse.

**C16-scope (Change F) — Happy path only.** The quickstart documents the shortest path to first success per role. It MUST NOT include RBAC-denial demos, error-path teaching, infra steps (`restart`, `audit.json`, container persistence), or treasury faucet as a universal numbered step (Manager may note one-time funding). See §6.1.

**C11 — Zero fiction.** The page contains **none** of the HF1, HF3–HF5 items in §6, and satisfies **HF2a/HF2b** (not the revoked blanket HF2). Specifically: no directory install; no ChatGPT button captioned as one-click connect; Claude deep-link present on every role path with role-correct URL; no unpublished skill as real (A2); no OAuth 2.1 auth-server setup; no future-state path presented as available today. *Gate — see §6.*

**C12 — Internal links and references resolve.** Every cross-link (to primer/concepts/guides/reference pages, the privacy page, the skill asset) either resolves to a real target or is marked "coming soon"; no dangling anchors. The MCP URL and domain are consistent with A5 throughout. *Source: §1 IA, §5 open decision 5.*

### Structure / Information architecture (25% rubric weight)

**C1 — Demo-first ordering.** A demo of the *family loop* renders **before** any numbered setup step. The demo shows: a kid logs an achievement → a parent verifies → the kid runs check-progress and sees the earned / in-wallet / pending breakdown → the kid runs settle-balance and pending moves to the wallet. Static annotated screenshots satisfy this (A3); a single transaction demo does NOT (must be the family loop, not "send 5 USDC"). *Source: §2.1.*

**C2 — Role fork is the primary fork.** A role selector appears as the first decision after the demo, ahead of any client choice. It covers the confirmed role set (A6) with the plain-language entry labels from §2.2 ("I'm a parent setting up for my family", "I was invited by my partner", "I was invited by my parent", "I help a family with their finances", and the Family-viewer entry per A6). *Source: §2.2.*

**C3 — Client fork nested under role.** Client choice (A7) is presented **inside** each role path, never as a sibling-or-above fork. Selecting a role then reveals that role's client tabs. *Source: §2.2–§2.3, §7.*

**C10 — Mintlify component correctness.** Steps use `<Steps>`; the role fork and the nested client fork use `<Tabs>`/`<Tab>` (A1); the page builds without unclosed/misnested components. The structural tree matches §7. *Source: A1, §7.*

### Copy / UX clarity (23% rubric weight)

**C6 — Try-it prompts are role-specific with approval framing.** Manager: set-up, verify, check, **distribute** (approval line on distribute). Co-parent: verify + check only — **no distribute** (RBAC; do not stage denial). Learner: §2.5 no-jargon set; approval line on "Move my earnings". Family-viewer / Advisor: read-only prompts only. *Addendum A §3.*

**C8 — Kid/Learner path is child-safe.** Shortest path: Step 1 open parent's link (no Base sign-in, no code typing if link forwarded); Step 2 try-it. No jargon, no family-creation, no numbered wallet setup. Connect folded into verify success / Open in Claude.

**C15 — Manager Base sign-in explainer.** The Manager path explains *why* Base sign-in is step one, in plain language (parent wallet = family owner; funds only go where parent approves). No undefined "trust root", "EOA", "seed phrase". Explainer **only** on Manager path (F7 three-path model).

### Safety framing (12% rubric weight)

**C7 — Family-control safety story leads.** The page surfaces the family-control framing ("parents control what kids can do; kids earn and settle within those rails; money can only go to authorized destinations") at or near the top — shown via the demo's approval moment and stated in copy — rather than deferring the entire safety story to the primer. The approval/allowlist control is *shown*, not only told. *Source: §0 "Lead with the family-control safety story", §2.1.*

### Bilingual readiness (8% rubric weight)

**C9 — ES-419 structural readiness.** The page structure supports an es-419 translation track dropping in cleanly (per A4): strings are not baked into images that block translation, the component tree is duplicable per-locale, and no copy hard-codes English-only structure. EN ships first; ES need not be present. *Source: §0 "Bilingual from day one", §5 open decision 3.*

---

## 5. Rubric (Accuracy-critical onboarding class)

| Category | Weight | Definition | Locked criteria |
|----------|--------|------------|-----------------|
| Accuracy / No-fiction | **32%** | Connection verbatim; verify entry + magic-link URLs; happy-path scope; zero fiction; links | C4, C11, C12, **C13, C14**, Change F |
| Structure / IA | **25%** | Demo-first; role fork; per-role step sequences (§7); client nested under role | C1, C2, C3, C10 |
| Copy / UX clarity | **23%** | Role prompts + approval framing; child-safe learner; Manager Base explainer | C6, C8, **C15** |
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
- **HF2 — REVOKED** (replaced by HF2a/HF2b per CA-D1). The blanket ban on deep-link buttons was incorrect for Claude (F1/F3).
- **HF2a — Claude deep-link (PERMITTED and EXPECTED).** Every role path includes a well-formed `claude.ai/customize/connectors?…` link with URL-encoded `connectorUrl` containing the role's **`?setup=CODE` magic link** (Manager and invitees). Manual steps are fallback. **Fail:** manual-only, malformed link, bare `/mcp` without `setup=` on connect steps.
- **HF2b — ChatGPT settings shortcut (PERMITTED only if honestly captioned).** A link to `chatgpt.com/#settings/Connectors` is allowed only when captioned as a shortcut to settings (not one-click connect) and the full dev-mode manual steps remain required immediately below. **Fail:** ChatGPT button implies pre-fill/completion, or manual steps removed/demoted on the strength of the button.
- **HF3 — Unpublished skill documented as real.** Step 3 presenting a downloadable/persistent skill as available when none is published (gated by A2). → §2.4 ("Don't document a skill that isn't published — that's the same fiction trap"), §5 open decision 1.
- **HF4 — OAuth 2.1 authorization-server docs.** Any authorization-server setup instructions. → §6 (Sprint 5.0 / Distribution Readiness work).
- **HF5 — Future-state-as-current.** Any connection mechanic that does not exist in the deployed build presented as currently available. → §0, §6.

**Non-fail companion rule (allowed):** It IS permitted to note "coming soon: directory install / one-click add / packaged skill" as clearly future-tense, provided it is not presented as an available step and does not appear inside the numbered Connect/Install steps.

### §6.1 Change F — happy-path scope (gates accuracy + structure)

**Barred from numbered quickstart steps:** RBAC-denial demonstrations; unknown-child / error-path teaching; container restart, audit-file inspection, persistence tests; treasury faucet as a universal prerequisite (Manager: optional one-time **note** only).

**Fail:** any barred item presented as a user step. Co-parent paths simply omit distribute/invite prompts — never stage "try X → denied."

---

## 7. Structural requirements — per-role entry sequences

Demo-first (C1), then outer Step "Choose your role" with nested **per-role** `<Steps>` (Addendum A). Client `<Tabs>` nest inside Connect steps (C3).

```
Page: "Get Started with AllowMe"
├─ <demo>                              # C1 — before any steps
├─ <Steps>
│  └─ Step 1: Choose your role
│     └─ <Tabs> (role)                 # C2
│        ├─ <Tab Manager>
│        │  └─ <Steps>
│        │     ├─ Step 1: Sign in with Base (+ C15 explainer) → verify
│        │     ├─ Step 2: Connect AllowMe → <Tabs> Claude|ChatGPT|CLI
│        │     ├─ Step 3: Set up your family (configure-policy; treasury note)
│        │     └─ Step 4: Try it (verify, check, distribute + approval line)
│        ├─ <Tab Co-parent> / Family-viewer / Advisor>  # adult invitee
│        │  └─ <Steps>
│        │     ├─ Step 1: Open your invite (code or link → Base & join)
│        │     ├─ Step 2: Connect → <Tabs> client
│        │     └─ Step 3: Try it (RBAC-scoped; no distribute for co-parent)
│        └─ <Tab Learner>              # C8 — shortest
│           └─ <Steps>
│              ├─ Step 1: Open link parent sent (no Base; join on verify)
│              └─ Step 2: Try it (+ connect via Open in Claude on success)
└─ safety framing (C7); coming-soon skill note (C5/HF3)
```

Rules:
- Role Tabs enclose client Tabs (C3). Learner Tab: no family-creation, no Manager Base sign-in (C8, C15).
- Manager is the **only** path with "Sign in with Base" as Step 1 entry on verify landing.
- Skill step omitted or "coming soon" per A2 (HF3).

---

## 8. Out-of-scope reminders (Evaluator MUST NOT penalize)

- Absence of the primer pages §3.1/§3.2/§3.3 (Deliverable 2+).
- Absence of concepts (earned-vs-settled, savings vault, allowlist) — Deliverable 3.
- Absence of per-task Guides and the Reference/tool-list — Deliverables 5–6.
- Absence of an *actual* es-419 translation (only structural readiness is graded — C9).
- Absence of an animated demo component (static screenshots satisfy C1 — A3).
- Absence of a directory-install or installable-skill path — required (§6), never penalized. **Claude deep-link (HF2a) must be present** — its absence is penalized.

---

## 9. Hand-off rules

1. Generator authors the page per this contract + `onboarding-plan.md` §2. Generator does NOT self-evaluate.
2. **Current-reality rule:** if a connection mechanic's current state is uncertain at author time, the Generator runs a 5-minute verification against the live Claude/ChatGPT connect flow before writing the step — and if still unverifiable, marks it "coming soon" rather than guessing (avoids HF5).
3. **Copy is sourced, not invented:** every user-visible string traces to `onboarding-plan.md` §2 or to a resolved assumption in §11. New copy required by a gap becomes a new flagged assumption, not silent invention.
4. **Assumptions gate the build:** the Generator MUST NOT begin until the §11 assumptions are confirmed/corrected by the user — A2 (skill published?) and A6 (role set) materially change which sections ship.
5. Evaluator (Phase 3) grades the **rendered page + source** against **C1–C15**, §6 (HF2a/HF2b), §6.1 (Change F), §7 only.

---

## 10. Grading thresholds

- **Pass:** all of **C1–C15** satisfied; Change F clean; each rubric category ≥75%; zero §6 fiction-traps.
- **Fail:** any HF hit; C4/C13/C14 fail; C15 missing on Manager OR Base sign-in on Learner Step 1; C1/C2/C3 fail; C8 fail; Change F violation (QA steps in quickstart).
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

- Contract version: **1.0 + CA-D1 + Addendum A v1.0**
- Generator entry: per-role verify-first steps; C15 explainer; magic-link connect URLs (all roles); Change F strip; HF2a/HF2b preserved.
- Evaluator entry: this contract + [`test.md`](test.md) + rendered page + source.
- Sibling artifacts: [`contract-amendment-CA-D1.md`](contract-amendment-CA-D1.md), [`contract-amendment-CA-D1-addendum-A.md`](contract-amendment-CA-D1-addendum-A.md).