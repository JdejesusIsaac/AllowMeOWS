# Docs Contract Amendment CA-D1 — Addendum A: Corrected entry sequence

> **Status:** Planner ruling, addendum to CA-D1. Amends the Quickstart docs contract
> + [`test.md`](test.md). Applies to regen on `docs/onboarding-v1-addendum-a` (from `main`).
>
> **Origin:** The live quickstart omitted verify-first entry and treated Manager
> connect as bare `allowme.dev/mcp`. This addendum specifies per-role entry sequences
> (Change D), Manager Base-sign-in explainer (Change E), and happy-path scope (Change F).
>
> **Confirmed facts (verified against shipped `public/verify.html`):**
> - **F5.** The **magic link** (`https://allowme.dev/mcp?setup=SETUP-XXXX-XXXX`) is
>   issued to the **Manager** after Base sign-in (verify success / "Welcome back").
> - **F6.** The **invite code** (e.g. `SOFI-LEARN-X7K2`) is what invitees receive;
>   they enter it under "Have an invite code?" or open a forwarded invite link.
> - **F7 (revised — three-path model).** **Manager:** entry `Sign in with Base` on
>   verify. **Adult invitees** (co-parent, family-viewer, advisor): invite preview
>   then **Sign in with Base & join**. **Learners:** join without wallet (no Base).
> - **F8.** Manager Base sign-in establishes the family trust root (allowlist, keys,
>   identity for `configure-policy`).

## Changes

| ID | Change | Criteria |
|----|--------|----------|
| **D** | Per-role entry sequence before connect | C13 (concrete), C14 |
| **E** | "Why Base sign-in" explainer on Manager path only | **C15** (new) |
| **F** | Happy-path scope guard — no QA/sad-path/infra in quickstart | Structure + Accuracy |

CA-D1 HF2a/HF2b, C13 (URL rules), C14 stand. **Supersedes** CA-D1 wording that Manager
connects with bare `https://allowme.dev/mcp` — Manager uses post-verify **magic link**
with `?setup=…` for HF2a and all connect steps.

**Amendment version:** CA-D1 Addendum A v1.0.
