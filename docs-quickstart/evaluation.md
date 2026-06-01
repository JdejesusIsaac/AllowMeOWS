# Quickstart Page — Evaluation Report (Phase 3, CA-D1)

**Verdict: PASS (with follow-up tickets).**
**Contract:** v1.0 + **CA-D1** (connection mechanics correction).
**Evaluator inputs:** `contract.md` + `test.md` + `quickstart.mdx` + `public/quickstart.html` (deployed `/quickstart` mirror). `progress.md` and Generator reasoning were **not** read.
**Build check:** `npx mint@latest broken-links` — MDX parses; 4 demo images + 3 internal routes unresolved (see C12).

---

## Scorecard

| Rubric category | Weight | Score | Criteria |
|-----------------|--------|-------|----------|
| Accuracy / No-fiction | 35% | **33 / 35** | C4 ✓ (one thin tab), C11 ✓, C12 soft, **C13 ✓**, **C14 ✓** |
| Structure / IA | 25% | **25 / 25** | C1 ✓, C2 ✓, C3 ✓, C10 ✓ |
| Copy / UX clarity | 20% | **20 / 20** | C6 ✓, C8 ✓ |
| Safety framing | 12% | **12 / 12** | C7 ✓ |
| Bilingual readiness | 8% | **8 / 8** | C9 ✓ |
| **Total** | 100% | **98 / 100** | every category ≥ 75% of weight |

All **hard-fail gates** clean (HF1, **HF2a**, **HF2b** on paths that include ChatGPT steps, HF3–HF5, C8, C1 ordering, C2/C3 fork). Zero fiction-traps. → **Pass** per contract §10.

**Delta from pre-CA-D1 eval:** Prior report incorrectly treated Claude deep-links as HF violations. CA-D1 regen satisfies **HF2a** on all five role paths and **HF2b** on Manager / Co-parent / Learner / Advisor ChatGPT tabs.

---

## Hard-fail gates (HF1, HF2a/HF2b, HF3–HF5)

| Check | Result | Evidence |
|-------|--------|----------|
| **T-HF1** | PASS | `directory` / App Directory only in future-tense `<Note>` and dev-mode caveats — not as an available install step. |
| **T-HF2a** | PASS | Five well-formed `claude.ai/customize/connectors?modal=add-custom-connector&connectorName=AllowMe&connectorUrl=…` links in `quickstart.mdx` (lines 77, 166, 216, 261, 323); same five in `quickstart.html`. Manager: bare `%2Fmcp` (no `setup=`). Invitees: encoded `setup=SETUP-XXXX-XXXX`. Manual paste fallback present under each. |
| **T-HF2b** | PASS* | Manager, Co-parent, Learner, Advisor: `chatgpt.com/#settings/Connectors` captioned as shortcut only; full dev-mode numbered steps immediately below. *Family-viewer ChatGPT tab is a cross-ref only — see DOCS-QS-2 (not a fiction trap; steps exist elsewhere on the page). |
| **T-HF3** | PASS | Skill only in future-tense coming-soon note; no numbered install step. |
| **T-HF4** | PASS | No auth-server / OAuth 2.1 / PKCE docs; `Authentication: OAuth` only in connector fields. |
| **T-HF5** | PASS | Numbered mechanics match custom-connector / dev-mode / CLI reality. |

**Revoked T-HF2** (blanket deep-link ban) — correctly not applied.

---

## CA-D1 criteria (new)

| Criterion | Checks | Result |
|-----------|--------|--------|
| **C13** — role-determined URL | T-C13-1 … 3 | **PASS.** Manager Claude deep-link + manual URL use bare `https://allowme.dev/mcp`. Co-parent, Learner, Advisor, Family-viewer use `?setup=SETUP-XXXX-XXXX` in copy, deep-links, and CLI examples. Explicit “not bare `allowme.dev/mcp`” on invitee paths. |
| **C14** — verify-page consistency | T-C14-1 … 3 | **PASS.** “magic link” terminology matches `public/verify.html` (“Your magic link”, “Open in Claude”). Invitee flow: parent sends link → deep-link or paste → connect. Deep-link behavior aligned with verify “Open in Claude”. |
| **C4** — connection verbatim | T-C4-1 … 6 | **PASS** (one gap). Claude/ChatGPT/CLI steps complete on Manager, Co-parent, Learner, Advisor. **Family-viewer ChatGPT** tab omits enumerated dev-mode steps (cross-ref to Co-parent) — follow-up, not fiction. |
| **C11** — zero fiction | HF suite | **PASS.** |

---

## Other criterion results

- **C1 (demo-first) — PASS.** `## See it in action` + `<CardGroup>` (lines 20–57) precedes first `<Steps>` (line 63). All four family-loop beats in copy/captions (log → verify → earned/in-wallet/pending → settle).
- **C2 (role primary fork) — PASS.** Five roles with §2.2 plain-language tab titles; role `<Tabs>` first decision after demo.
- **C3 (client nested) — PASS.** Client `<Tabs>` inside each role `<Tab>`; no top-level client fork.
- **C10 (components) — PASS.** Valid Mintlify tree; role encloses client; Learner has no wallet/family-creation. Skill step omitted per A2 (coming-soon note satisfies C5/HF3).
- **C6 (prompts + approval) — PASS.** Role-specific try-it blocks; exact approval line on Manager (settle framing) and Learner (“Move my earnings”). Co-parent/Advisor/Family-viewer have no money-moving prompts — T-C6-2 vacuously satisfied.
- **C8 (kid path) — PASS.** No jargon; invite-only; §2.5 prompts verbatim; Claude deep-link + magic link (not bare MCP typing).
- **C7 (safety) — PASS.** Top `<Note>` + demo verify/settle beats show control story.
- **C9 (bilingual) — PASS.** Copy in MDX/components; es-419 comment; no ES required.
- **C12 (links) — SOFT-FAIL (Pass-with-followup).** Next-step cards labeled “Coming soon”. Four demo PNGs missing under `/images/quickstart/` (T-C12-1 partial). Privacy href present.

---

## Dual-source parity

`quickstart.mdx` and `public/quickstart.html` agree on CA-D1 mechanics (five Claude deep-links, ChatGPT shortcut captions, magic-link invitee URLs). Either source satisfies the contract for `/quickstart` deployment; Mintlify publish should track `quickstart.mdx`.

---

## Follow-up tickets (do not block Pass)

**DOCS-QS-1 — Produce the four demo screenshots** (unchanged).
- Paths: `/images/quickstart/demo-{1..4}-*.png`
- Repro: `cd docs-quickstart && npx mint@latest broken-links`

**DOCS-QS-2 — Inline ChatGPT dev-mode steps on Family-viewer tab.**
- **What:** Family-viewer ChatGPT panel says “steps same as Co-parent” without the numbered Settings → Developer Mode → New App flow (mdx ~328, html ~339–340).
- **Expected:** Same enumerated steps as Co-parent/Advisor tabs immediately under the settings shortcut (T-C4-2, T-HF2b strict reading).
- **Impact:** Accuracy sub-score only; not a fiction-trap.

---

## Status

- Evaluation: **complete** for CA-D1 regen.
- Verdict: **PASS (98/100)**.
- Blocking gates: **all clean**.
- Before public publish: DOCS-QS-1 (images); recommend DOCS-QS-2 (Family-viewer ChatGPT copy).
- Independence: contract + test + build only; `progress.md` not read.
