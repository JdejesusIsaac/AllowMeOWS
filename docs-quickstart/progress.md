# Quickstart Page — Generator Progress (Deliverable 1)

> Harness v3 progress artifact. The Generator updates this; the Evaluator does
> NOT read it (grades `quickstart.mdx` + `contract.md` + `test.md` only).

## Status

- **Deliverable:** `docs-quickstart/quickstart.mdx` — the Quickstart page (Get
  Started with AllowMe). Scoped to `onboarding-plan.md` §2 only.
- **State:** Draft v1 complete; pending Evaluator pass against `test.md`.
- **Inputs confirmed:** A2 (no skill → coming-soon, HF3 active), A5
  (`docs.allowme.dev` / `https://allowme.dev/mcp`), A6 (five roles, tiered),
  A7 (CLI clients only under Manager + Advisor), A3 (static demo OK), A4
  (EN-first, ES-structured).

## Checkpoints

- **DEL1 demo (C1, C7):** family-loop `<CardGroup>` (log → verify →
  check-progress → settle) placed before `<Steps>`; shows the §2.1
  earned/in-wallet/pending values and the "$0.73 moved to your wallet" settle
  beat. Safety lead via top `<Note>` + the demo's approval moment.
- **DEL2 role fork (C2, C8):** five `<Tab>` roles with plain-language labels;
  role fork is the first decision after the demo. Learner path is child-safe
  (no wallet-setup, no family-creation, invite-only, §2.5 prompts).
- **DEL3/DEL4 connect (C3, C4, C10):** client `<Tabs>` nested inside each role.
  Claude custom-connector + ChatGPT dev-mode steps verbatim to §2.3 with
  dev-mode caveat. CLI tabs (Claude Code/Codex/Cursor) only under Manager +
  Advisor (A7). MCP URL exact in all 16 occurrences.
- **DEL5 skill (C5, HF3):** no per-step skill; single future-tense coming-soon
  `<Note>` outside numbered steps.
- **DEL6 try-it (C6):** role-specific prompts; approval line verbatim on the
  money-moving prompts (Manager settle note, Learner "Move my earnings").
- **DEL8 bilingual (C9):** copy in MDX (not images), es-419 duplication comment.

## Mechanical self-check (not a rubric evaluation)

- Component open/close balance: Tabs 6/6, Tab 21/21, Steps 6/6, Step 11/11,
  CardGroup 2/2, Card 8/8, Frame 4/4, Note 7/7.
- HF1–HF5 trip-strings: zero hits. "directory"/"one-click add" appear only in
  the allowed future-tense coming-soon note.
- `https://allowme.dev/mcp`: 16 identical occurrences, no variants.

## Render scaffold

- `docs-quickstart/docs.json` added (Mintlify `mint` theme, nav group
  "Quickstart" → `quickstart`). Validated: well-formed JSON, slug resolves to
  `quickstart.mdx`. Makes T-C10-1 ("page builds") runnable via `mint dev` /
  `mint broken-links` from `docs-quickstart/`.

## App-served rendering (decision: serve from the Bun app, not Mintlify)

- `public/quickstart.html` — self-contained HTML/CSS/JS rendering of
  `quickstart.mdx` (source of truth), in the landing-site design language.
  Role tabs (outer) / client tabs (nested) via scoped vanilla JS; connect copy
  verbatim; approval line on both money-moving prompts.
- `app/server.ts` — `GET /quickstart` route added (mirrors landing pattern,
  read-once at startup, before static middleware). Dockerfile already copies
  `public/`, so it ships with `railway up` (no Dockerfile change).
- **DOCS-QS-1 resolved for this rendering:** the demo is rendered as inline
  chat-bubble mockups (all four family-loop beats), so there are no broken
  placeholder images. Verified locally: `GET /quickstart` → HTTP 200; `tsc`
  clean; 21 data-tab targets ↔ 21 panel ids.
- Live at `allowme.dev/quickstart` after the next deploy.

## Open / needs-asset

- **Demo images** `/images/quickstart/demo-{1..4}-*.png` are referenced as
  placeholders with descriptive alt text + visible captions; real annotated
  screenshots must be produced before publish (the family-loop beats are
  readable from copy regardless, per A3).
- **Next-step links** to `/safety`, `/concepts/earned-vs-settled`,
  `/guides/set-allowance-rules` are intentionally labeled "coming soon"
  (Deliverables 2/3/5, out of scope here) — C12 soft-fail-eligible by design.

## Failed Approaches

- (none yet)
