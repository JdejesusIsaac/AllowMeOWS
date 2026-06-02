# Quickstart Page — Generator Progress (Deliverable 1)

> Harness v3 progress artifact. The Evaluator does NOT read this.

## Status

- **Deliverable:** `docs-quickstart/quickstart.mdx` + `public/quickstart.html`
- **State:** **CA-D1 Addendum A regen** (per-role verify-first entry, C15, magic-link connect URLs, Change F happy-path). Pending Evaluator.
- **Contract:** v1.0 + CA-D1 + Addendum A

## Addendum A checkpoints

- **Change D (C13):** Manager Step 1 = verify + Sign in with Base; adult invitees = invite code/link + Base & join; Learner = link + Join (no Base). Manager Step 3 Set up family; invitees no family-setup step.
- **Change E (C15):** Manager-only "Why do I sign in with a wallet first?" Note.
- **C13 URL:** All connect paths use `?setup=SETUP-XXXX-XXXX` magic link (Manager included); no bare `allowme.dev/mcp` as connect URL.
- **Change F:** No QA/RBAC-denial/infra steps; co-parent Try it has no distribute.
- **CA-D1 preserved:** HF2a/HF2b on all client tabs; Family-viewer ChatGPT inline dev-mode steps (DOCS-QS-2 closed).

## Mechanical self-check

- `allowme.dev/verify` linked on every role entry step.
- Five Claude deep-links; all encoded URLs include `setup=`.
- T-F-1 grep: no `restart`, `audit.json`, `denied`, `RBAC`, `persistence`, `container` in quickstart source.

## Deploy

- Ships via `GET /quickstart` + `railway up` after merge to `main`.
