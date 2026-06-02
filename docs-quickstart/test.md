# Quickstart Page — Verification Checks (test.md, Deliverable 1)

> Sibling artifact to the Quickstart docs contract (§12). Converts the
> fifteen acceptance criteria C1–C15, Change F scope guard, entry-sequence checks T-D,
> hard-fails HF1 + HF2a/HF2b + HF3–HF5 (CA-D1 + Addendum A), and
> the structural tree (§7) into concrete, inspectable checks the
> Evaluator runs against the **rendered page + its source only** — never
> the planning docs or author rationale (contract §9 rule 5).
>
> Each check is written so a human or an agent can execute it and get a
> binary pass/fail, the way the sprint test docs map criteria to runnable
> assertions. Where a check is mechanical (a grep, a structural parse),
> it's marked **[MECH]**; where it requires reading judgment, it's marked
> **[READ]** and the judgment is constrained as tightly as possible.
>
> **Confirmed inputs (no longer assumptions):**
> - A2: no published skill → Step 3 is "coming soon," HF3 active.
> - A5: docs domain `docs.allowme.dev`; MCP URL `https://allowme.dev/mcp`.
> - A6: five roles — Manager, Co-parent, Learner, Advisor, Family-viewer
>   — tiered (Manager/Co-parent/Learner full; Advisor/Family-viewer
>   minimal). Family-viewer capabilities pinned to the shipped `family`
>   RBAC.

## 0. How to run this

The Evaluator grades against two inputs only: the **rendered page** and
its **source file(s)**. For each check below, the column "How to verify"
gives the exact operation. Mechanical checks should be run first (they're
cheap and catch the highest-weight failures); reading checks follow.

Grouped by rubric category so the Evaluator can assemble the scorecard
directly. A check failing flips its criterion; a criterion failing
applies the §10 grading rule (some are hard-fail gates, some are
weighted).

## 1. Coverage map

| Criterion | Checks | Rubric category | Gate? |
|-----------|--------|-----------------|-------|
| C4 — connection verbatim | T-C4-1 … T-C4-6 | Accuracy 32% | Fail-gate (§10) |
| C11 — zero fiction | T-HF1, T-HF2a, T-HF2b, T-HF3 … T-HF5 | Accuracy 32% | Hard-fail gate (§6) |
| C12 — links resolve | T-C12-1 … T-C12-3 | Accuracy 32% | Soft-fail eligible |
| C13 — entry sequence + URL | T-D-1 … T-D-4, T-C13-1 … T-C13-3 | Accuracy 32% | Fail-gate |
| C14 — verify-page consistency | T-C14-1 … T-C14-4 | Accuracy 32% | Fail-gate |
| Change F — happy path only | T-F-1 … T-F-2 | Accuracy 32% | Fail-gate |
| C15 — Base sign-in explainer | T-C15-1 … T-C15-3 | Copy 23% | Fail-gate |
| C1 — demo-first | T-C1-1 … T-C1-4 | Structure 25% | Fail-gate |
| C2 — role primary fork | T-C2-1 … T-C2-3 | Structure 25% | Fail-gate |
| C3 — client nested | T-C3-1 … T-C3-2 | Structure 25% | Fail-gate |
| C10 — component validity | T-C10-1 … T-C10-2 | Structure 25% | Weighted |
| C6 — prompts + approval line | T-C6-1 … T-C6-4 | Copy 23% | Weighted |
| C8 — kid path child-safe | T-C8-1 … T-C8-5 | Copy 23% | Fail-gate |
| C7 — safety leads | T-C7-1 … T-C7-2 | Safety 12% | Soft-fail eligible |
| C9 — bilingual-ready | T-C9-1 … T-C9-3 | Bilingual 8% | Soft-fail eligible |

## 2. Accuracy / No-fiction checks (35%)

### Hard-fail gates — HF1, HF2a/HF2b, HF3–HF5 (C11, CA-D1)

These run first. **Any** HF fail is an automatic Fail (contract §6, §10).

| Check | Target | How to verify | Pass = |
|-------|--------|---------------|--------|
| **T-HF1** | App Directory install | **[MECH]** grep (case-insensitive): `directory`, `app store`, `install from`. Each hit must NOT present directory-install as available today. | No directory-install as an available step |
| **T-HF2a** | Claude deep-link (REQUIRED) | **[MECH]** On **every** role path's Claude tab: grep `claude.ai/customize/connectors?modal=add-custom-connector` with `connectorName=AllowMe`. **All roles** use `setup=` in encoded `connectorUrl` (Addendum A — Manager magic link too). Bare `%2Fmcp` without `setup=` on connect/deep-link = **fail**. Manual-only = **fail**. | Deep link present; setup-coded URL per role |
| **T-HF2b** | ChatGPT shortcut (if present) | **[MECH+READ]** If `chatgpt.com/#settings/Connectors` link exists: (a) caption is shortcut-style ("Open ChatGPT connector settings"), NOT one-click connect; (b) full dev-mode manual steps remain **required** immediately below, not demoted to fallback. Pre-fill-implying caption or steps removed = **fail**. | Honest shortcut OR no ChatGPT button |
| **T-HF3** | Unpublished skill as real | **[MECH+READ]** grep `skill`, `SKILL.md`, `.zip`, `Download skill`. Hits only in future-tense "coming soon", not in numbered steps as doable today. | No installable skill today |
| **T-HF4** | OAuth 2.1 auth-server | **[MECH]** grep `authorization server`, `OAuth 2.1`, `PKCE`, `token endpoint`, `/.well-known/oauth`. (`Authentication: OAuth` in ChatGPT dev-mode step is allowed.) | No auth-server setup |
| **T-HF5** | Future-state-as-current | **[READ]** Every numbered-step mechanic exists in deployed build. | Zero unverifiable mechanics |

**Revoked:** **T-HF2** (blanket deep-link ban) — replaced by T-HF2a/T-HF2b per CA-D1.

**Companion (allowed):** future-tense "coming soon: directory / one-click ChatGPT connect / packaged skill" outside numbered steps.

### Change D — per-role entry sequence (C13)

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-D-1** | **[MECH+READ]** Manager nested steps: Step 1 references `allowme.dev/verify` + **Sign in with Base** before Connect. | Manager verify-first |
| **T-D-2** | **[MECH+READ]** Learner path Step 1: open parent link / join on verify — **no** "Sign in with Base" as step one. | Learner no entry Base |
| **T-D-3** | **[MECH+READ]** Co-parent, Family-viewer, Advisor Step 1: invite code (`Have an invite code?`) or forwarded link + **Sign in with Base & join** (adult invitee). | Adult invitee verify entry |
| **T-D-4** | **[MECH]** Manager path has Step "Set up your family" (or equivalent) before final Try it; invitee paths have **no** family-setup step. | Role-correct step count |

### C13 — role-determined connection URL

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C13-1** | **[MECH]** Manager connect steps use `https://allowme.dev/mcp?setup=SETUP-…` (magic link), not bare `https://allowme.dev/mcp`. | Manager setup-coded URL |
| **T-C13-2** | **[READ]** All invitee paths describe `?setup=CODE` **magic link** for connect. | Invitee magic link |
| **T-C13-3** | **[MECH]** No role tab instructs bare `https://allowme.dev/mcp` as the connect URL (grep all role sections). | No bare MCP connect URL |

### Change F — happy-path scope

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-F-1** | **[MECH]** Grep quickstart for `restart`, `audit.json`, `denied`, `RBAC`, `persistence`, `container`. Hits must NOT present these as user numbered steps. | No QA/infra steps |
| **T-F-2** | **[READ]** No path stages permission-denial or error-path as a teaching step. Co-parent has no distribute prompt. | Happy path only |

### C14 — quickstart ↔ verify-page consistency

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C14-1** | **[READ]** Manager flow: verify → Base sign-in → magic link on success → connect. | Manager aligns with verify |
| **T-C14-2** | **[READ]** Adult invitee: invite code/link → preview → Base & join. Learner: link → join without wallet. | Invitee flows align |
| **T-C14-3** | **[MECH]** Terminology: "magic link", "invite code", "Open in Claude" consistent with verify page. | Consistent terms |
| **T-C14-4** | **[READ]** Claude deep-link = verify "Open in Claude" (pre-filled modal). | Deep-link consistent |

### C4 — connection steps match current reality, verbatim

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C4-1** | **[MECH]** Claude tab: deep-link and/or manual path with "Customize", "Connectors", "Add custom connector"; Name `AllowMe`; URL = role **magic link** (`?setup=…`); Add → Connect → sign-in. | Present; setup URL |
| **T-C4-2** | **[MECH]** ChatGPT tab contains, in order: "Settings", "Apps", "Advanced settings", "Developer Mode", "Create", "New App"; fields Name / Description / MCP Server URL / Authentication=OAuth; "I understand and want to continue"; "Create"; sign-in. | All present, in order |
| **T-C4-3** | **[MECH]** ChatGPT tab contains an explicit dev-mode caveat (e.g. "developer-mode app", "not yet in the directory"). | Caveat present |
| **T-C4-4** | **[MECH]** Connect URLs use `https://allowme.dev/mcp?setup=` pattern (placeholder `SETUP-XXXX-XXXX` OK); no bare connect URL; no `www`, no typos. | Setup-coded URLs |
| **T-C4-5** | **[MECH]** Manager/Advisor CLI tabs use setup-coded URL in examples (e.g. `…/mcp?setup=SETUP-XXXX-XXXX`). | CLI uses magic link |
| **T-C4-6** | **[READ]** No connection step diverges from the deployed connect flow. If any step is uncertain, it must be marked "coming soon" rather than asserted (contract §9 rule 2). | Zero divergence from live flow |

### C12 — internal links and references resolve

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C12-1** | **[MECH]** Enumerate every internal link/anchor. Each resolves to a real page OR is labeled "coming soon". | No dangling links |
| **T-C12-2** | **[MECH]** Domain references consistent with `docs.allowme.dev`; no stray placeholder domains. | Consistent domain |
| **T-C12-3** | **[MECH]** Privacy-page link and any skill-asset link either resolve or are "coming soon". | Resolves or labeled |

*Soft-fail (contract §10):* a single internal link to a not-yet-built
page that IS correctly labeled "coming soon" → Pass (expected during
build-out).

## 3. Structure / IA checks (25%)

### C1 — demo-first ordering

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C1-1** | **[MECH]** The demo block appears in source **before** the first `<Steps>` / first numbered step. | Demo precedes steps |
| **T-C1-2** | **[READ]** The demo depicts the **family loop**: (a) kid logs an achievement, (b) parent verifies, (c) kid runs check-progress and sees earned / in-wallet / pending, (d) kid runs settle-balance and pending moves to wallet. All four beats present. | All 4 beats present |
| **T-C1-3** | **[READ]** The demo is NOT a single-transaction "send 5 USDC"-style demo. If it shows only one isolated money movement with no earn→verify→settle arc, fail. | Family loop, not single tx |
| **T-C1-4** | **[MECH]** Static annotated screenshots satisfy this (A3) — an animated component is NOT required. Presence of static images depicting the loop passes. | Static or animated both OK |

### C2 — role fork is the primary fork

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C2-1** | **[MECH]** The first decision after the demo is a role selector (role `<Tabs>`), appearing before any client choice in source order. | Role fork is first |
| **T-C2-2** | **[MECH]** Five role entries present: Manager, Co-parent, Learner (Kid), Advisor, Family-viewer (A6). | All five present |
| **T-C2-3** | **[READ]** Entry labels are the plain-language §2.2 forms ("I'm a parent setting up for my family", "I was invited by my partner", "I was invited by my parent", "I help a family with their finances", plus the Family-viewer entry). | Plain-language labels |

*Note on tiering (A6):* Advisor and Family-viewer get **minimal** paths
(connect → read-only capabilities); Manager/Co-parent/Learner get full
paths. A minimal path is NOT a missing path — Advisor/Family-viewer must
each have at least connect + their actual capabilities. Family-viewer's
capabilities must match the shipped `family` RBAC (read-only:
check-progress, view receipts) — not invented.

### C3 — client fork nested under role

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C3-1** | **[MECH]** Parse the component tree. Client `<Tabs>` are nested **inside** each role `<Tab>`, never as a sibling-or-above fork. | Client nested in role |
| **T-C3-2** | **[MECH]** No flat client-only fork exists at page top level (that would revert to the Base template). | No top-level client fork |

### C10 — Mintlify component correctness

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C10-1** | **[MECH]** Page uses `<Steps>` for the step sequence and `<Tabs>`/`<Tab>` for both forks (A1). All components open/close correctly; no misnesting. | Valid component tree |
| **T-C10-2** | **[MECH]** Tree matches contract §7: per-role nested Steps (Manager 4-step; adult invitee 3-step; Learner 2-step); client Tabs inside Connect; no top-level-only Connect. | Matches §7 |

## 4. Copy / UX clarity checks (20%)

### C6 — try-it prompts are role-specific with approval framing

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C6-1** | **[MECH]** Each role path ends with copy-paste starter prompts. Manager prompts include set-up actions (create family, invite, set allowance, verify). Kid prompts are the §2.5 no-jargon set. | Role-scoped prompts present |
| **T-C6-2** | **[MECH]** Every money-moving prompt (settle, send, move earnings) is accompanied by the exact line: "AllowMe will show you exactly what will happen and ask you to approve before anything moves." | Approval line on every money prompt |
| **T-C6-3** | **[READ]** No prompt is scoped beyond the role's permissions (e.g. a Kid prompt that invites members or changes rules). | No over-scoped prompts |
| **T-C6-4** | **[MECH]** Co-parent Try it has **no** distribute/settle prompt; Manager includes distribute (or settle) with approval framing. | RBAC-scoped prompts |

### C15 — Manager Base sign-in explainer

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C15-1** | **[READ]** Manager path explains why Base sign-in is first (plain language: parent wallet = family owner; approved destinations only). | Explainer present |
| **T-C15-2** | **[READ]** No crypto jargon (trust root, EOA, seed phrase) in explainer. | Low-fluency safe |
| **T-C15-3** | **[MECH]** Explainer appears only in Manager tab — not in Learner or adult-invitee tabs. | Manager-only |

### C8 — kid/learner path is child-safe

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C8-1** | **[MECH]** The Learner/Kid role Tab contains **no** wallet-setup step and **no** family-creation affordance. | No wallet/family-creation in Kid path |
| **T-C8-2** | **[READ]** The Kid path contains no financial jargon (no "USDC", "wallet address", "on-chain", "gas", "blockchain"). Plain language only. | No jargon |
| **T-C8-3** | **[MECH]** The Kid path is invite-only — it describes joining a family, never creating one. | Invite-only framing |
| **T-C8-4** | **[MECH]** Kid prompts match the §2.5 set: "How am I doing this week?", "How much have I earned?", "Move my earnings to my wallet", "How much is in my savings?". | Prompts match set |
| **T-C8-5** | **[MECH]** Learner Step 1 title/copy references opening parent's link; no "Sign in with Base" in Learner section. | Link-first, no Base |

*This is a fail-gate (contract §10): if the Kid path exposes
wallet-setup or family-creation, the whole page fails regardless of other
scores.*

## 5. Safety framing checks (12%)

### C7 — family-control safety story leads

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C7-1** | **[READ]** At or near the top (in the demo and/or opening copy), the page surfaces the family-control framing: parents control what kids can do; kids earn and settle within rails; money can only go to authorized destinations. | Framing present near top |
| **T-C7-2** | **[READ]** The control story is **shown** (the demo's approval/settle moment depicts it), not only stated in prose. | Shown, not only told |

*Soft-fail (contract §10): safety framing present but stated-only (not
shown in the demo) AND everything else clean → Pass with a
demo-annotation ticket.*

## 6. Bilingual readiness checks (8%)

### C9 — es-419 structural readiness

| Check | How to verify | Pass = |
|-------|---------------|--------|
| **T-C9-1** | **[MECH]** No user-facing copy is baked into images in a way that blocks translation (text that must translate lives in markdown/components, not rasterized into screenshots). | Translatable text not image-locked |
| **T-C9-2** | **[READ]** The component tree is duplicable per-locale (no English-only hard-coded structure that an es-419 version couldn't mirror). | Locale-duplicable |
| **T-C9-3** | **[MECH]** EN ships first; ES need not be present. Absence of ES is NOT penalized (contract §8). | EN present; ES absence OK |

*Soft-fail (contract §10): one image embeds English text AND all
Accuracy + Structure criteria clean → Pass with translation-readiness
ticket.*

## 7. Out-of-scope guard (Evaluator MUST NOT penalize)

Per contract §8, the following absences are **required or expected** and
must not lower any score:

| Check | Confirm |
|-------|---------|
| **T-OOS-1** | Absence of primer pages (§3.1/§3.2/§3.3) — not penalized |
| **T-OOS-2** | Absence of concepts pages (earned-vs-settled, savings vault, allowlist) — not penalized |
| **T-OOS-3** | Absence of Guides / Reference / tool-list — not penalized |
| **T-OOS-4** | Absence of an actual es-419 translation — not penalized (only readiness graded) |
| **T-OOS-5** | Absence of an animated demo — not penalized (static satisfies C1) |
| **T-OOS-6** | Absence of directory-install / installable-skill — not penalized. Claude deep-link (HF2a) **must** be present. |

## 8. Execution order

1. **HF gates first** (T-HF1, T-HF2a, T-HF2b, T-HF3 … T-HF5). Any fail → stop.
   checks, highest-weight failure. Run before anything else.
2. **T-D, C4, C13, C14, T-F, C15, C8** — accuracy/copy fail-gates. Run second.
3. **Structure** (C1, C2, C3, C10) — the remaining fail-gates plus C10
   weighted.
4. **Copy** (C6), **Safety** (C7), **Bilingual** (C9) — weighted /
   soft-fail eligible.
5. **C12 links** + **OOS guard** — finish.
6. Assemble the §5 rubric scorecard; apply §10 thresholds.

## 9. Verdict assembly

- **Fail** if: any HF hit; T-D/T-F fail; C4/C13/C14/C15 fail; demo/fork fail;
  kid path exposes wallet/family-creation or Base sign-in (T-C8-1/T-C8-5).
- **Soft-fail (Pass-with-followup)** per contract §10: C9 partial (one
  image embeds EN text), C7 stated-but-not-shown, or C12 single
  coming-soon link — each with its named ticket, IF all Accuracy +
  Structure fail-gates are clean.
- **Pass** if: all **C1–C15** satisfied; Change F clean; each rubric category ≥75%;
  zero HF fails.

## 10. Status

- test.md version: **1.0 + CA-D1 + Addendum A**
- Pairs with: contract v1.0 + CA-D1 + Addendum A.
- Evaluator uses: this file + the rendered page + its source. Nothing
  else.
- Generator does not read this file as authoring guidance beyond the
  contract it already has — test.md is the Evaluator's instrument, kept
  separate to preserve the Generator/Evaluator independence the program
  relies on.