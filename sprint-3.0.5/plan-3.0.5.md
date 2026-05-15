# Sprint 3.0.5 — Verify-Page Bootstrap Form Extension

## What this sprint ships

The verify-page bootstrap form (`public/verify.html`) learns to ask for what Sprints 3.0.2, 3.0.3, and 3.0.4 added to the backend:

- **Per-child wallet address** (optional) — BYO-wallet path that auto-feeds the Sprint 3.0.2 allowlist
- **Per-child learning goals** (0-5 per child) — each with topic, category, optional subgoals (0-5), optional deadline
- **Post-submit allowlist transparency panel** — shows admin + each child's wallet so the security model is legible

No schema changes. No backend changes. No new tools. UI-only.

The sprint exists because pilot families cannot use Sprint 3.0.3/3.0.4 features through the documented onboarding path until the bootstrap form exposes them.

## Why this is the right cut

Three alternatives were considered and rejected:

**A separate "configure goals" page that parents visit after bootstrap.** Rejected because (1) it introduces a new step in a flow the magic-link UX was specifically designed to compress, (2) it bifurcates "family setup" into "create family" + "configure family" which is the exact friction parents complain about in other allowance apps, (3) it requires building a new page anyway, with worse retention than asking in-flow.

**Skip the form work entirely and document "use Claude to configure goals after bootstrap."** Rejected because (1) it perpetuates the gap, (2) docs that route parents to a context-switch they didn't ask for are read as documentation of a missing feature, (3) Sprint 3.0.3 dogfooding showed that goals set at bootstrap get used; goals deferred often don't get configured.

**A larger redesign that addresses multiple verify-page UX issues.** Rejected because (1) scope creep, (2) verify-page is shipping its purpose today (bootstrap works, magic-link works, invite preview works); the gap is narrow and the fix should be narrow.

The chosen cut — extend the existing form with the missing fields, no other UX work — is the minimum that unblocks learner-mode testing, honest docs, and pilot deployment.

## Feature summary

Sprint 3.0.5 ships:

- **Optional `walletAddress` input per child** in the family-create form, with inline regex validation (`/^0x[a-fA-F0-9]{40}$/`) and helper text explaining BYO-wallet vs managed-wallet semantics.
- **Optional `learningGoals` section per child**, expandable with "+ Add learning goal" button, capped at 5 goals per child. Each goal has topic (text), category (dropdown populated from the child's configured categories), optional subgoals (up to 5, each with topic + completed default false), optional deadline (HTML5 date input).
- **Post-submit allowlist transparency panel** before the magic-link URL, listing admin wallet + each child's wallet with a one-line explanation of what the allowlist means.
- **Test fixture updates** for any existing verify-page test that asserts on form HTML structure (expected: minimal — most assertions are against API contract).

The diff is in one file plus minor test updates. No new files in `src/`, no new MCP tool registration, no backend modification.

## Problem statement

Three problems frame Sprint 3.0.5:

1. **Bootstrap form doesn't surface Sprint 3.0.3/3.0.4 features.** New families ship with no learning goals because the form doesn't ask. `check-goals` returns the friendly empty state for everyone instead of being the edge case. Section 1 (learner-mode test) cannot be honestly run end-to-end without parents being able to set goals during bootstrap.

2. **BYO-wallet for kids requires post-bootstrap reconfigure.** Sprint 3.0.2 allowlist auto-populates from `ChildConfig.walletAddress`, but the form has no way to capture that address at bootstrap. Parents who want their kid to receive USDC at an external wallet (MetaMask, kid's own Coinbase Wallet) have to bootstrap, then context-switch to Claude to call `configure-policy` and add the wallet. Same friction the magic-link UX was designed to remove.

3. **Allowlist is enforced but invisible.** Parents complete bootstrap with no signal that an allowlist exists, what's on it, or what it means for security. Any pilot-family conversation about "what stops a stranger" or "can you withdraw your money" runs into this opacity immediately.

All three problems are UI-layer. The backend already does the right thing; the verify-page just needs to ask the right questions.

## Architecture decisions

### Decision 1 — Single-file form extension (public/verify.html)
**Decision:** All UI changes live in `public/verify.html` (the single static HTML file from Sprint 3.0 v4 Decision 2). Vanilla JS, no build step, no React. CSS extends existing Tailwind classes already loaded.

**Why:** Sprint 3.0 v4 Decision 2 committed to a single-file verify page with no build step. Sprint 3.0.5 preserves that commitment. Adding React or a bundler for what is fundamentally a form-fields-and-validation feature would be a worse trade than the existing footprint.

### Decision 2 — Per-child nesting for goals (Option A)
**Decision:** Learning goals are nested inside each child's form block, immediately after the categories input and before "Add another child."

**Why:** Mirrors the data model (`ChildConfig.learningGoals[]`), reads naturally as "what is Aiden working on," makes the category dropdown trivially resolvable from the same child's just-configured categories. See research-3.0.5.md Decision 1 for full rationale.

### Decision 3 — Optional fields with sane defaults
**Decision:** All new fields (kid wallet, goals, subgoals, deadlines) are optional. Default state: 0 goals per child, no wallet supplied, no deadlines. Backward-compatible with the existing form behavior — parents can submit the form exactly as today.

**Why:** Backward compatibility is the central correctness constraint of this sprint. The form must accept the old payload shape and produce a valid family. New fields are additive.

### Decision 4 — Caps: 5 goals per child, 5 subgoals per goal
**Decision:** Form caps goals at 5 per child and subgoals at 5 per goal. Schema cap of 20 subgoals from Sprint 3.0.4 remains unchanged; the form cap is a UX guardrail.

**Why:** A bootstrap form with 20 goals per child becomes unwieldy. 5 is approximately where form fatigue sets in. Parents who need more can add post-bootstrap via Claude. If pilot data shows the cap is wrong, Sprint 3.5 adjusts.

### Decision 5 — Native date input for deadline
**Decision:** `<input type="date">` for deadline field. Submit handler appends `T00:00:00.000Z` to convert to the ISO datetime format `LearningGoalSchema.deadline` expects.

**Why:** Native mobile date pickers, accessible by default, parents think in dates not datetimes, matches Sprint 3.0.4 schema acceptance.

### Decision 6 — Allowlist transparency panel between submit and magic-link
**Decision:** After successful family creation, render a brief panel listing admin wallet + each child's wallet, with one-line explanatory text, before showing the magic-link MCP URL.

**Why:** The security model is enforced (Sprint 3.0.2) but invisible (no UI exposure). Pilot families will ask "what stops a stranger" within the first 30 seconds; the answer is the allowlist, and the moment of bootstrap is the only moment to make it visible in-flow.

### Decision 7 — Client-side validation is additive, not authoritative
**Decision:** Form does inline client-side validation (regex for wallet address, required-when-other-field-present for goals, etc.) for immediate feedback. Server-side validation remains the source of truth — Sprint 3.0.2 `tryNormalizeWallet`, Zod `LearningGoalSchema`, configure-family core all do their normal checks.

**Why:** Defense-in-depth, immediate UX feedback. Don't replace server validation; supplement it.

### Decision 8 — No JavaScript dependencies added
**Decision:** Zero new npm packages. The form uses what Sprint 3.0 v4 already loads (Tailwind CDN, `@base-org/account` SDK via esm.sh). All new behavior is vanilla JS.

**Why:** The verify page's small footprint is itself a feature. Mobile load time matters for the bootstrap UX. Adding form libraries (React Hook Form, Formik) for a 5-field extension is over-engineering.

---

## Implementation steps

### Workstream W1: Form field additions (1.5 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W1.1 | Add `walletAddress` input field to per-child block, with helper text and client-side regex validation on blur | Low | 20m |
| W1.2 | Add "Learning goals" section header + "+ Add learning goal" button per child, with state management for goal array | Medium | 30m |
| W1.3 | Render goal row template: topic input, category dropdown (populated from child's categories), "+ Add subgoal" button, "× remove goal" button | Medium | 30m |
| W1.4 | Render subgoal sub-row template under each goal: topic input, "× remove subgoal" button | Low | 15m |
| W1.5 | Add `<input type="date">` for goal deadline with helper text | Low | 10m |
| W1.6 | Cap enforcement: disable "+ Add goal" when 5 goals exist for a child; disable "+ Add subgoal" when 5 subgoals exist for a goal | Low | 15m |

### Workstream W2: Submit payload construction (45 min)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W2.1 | Extend form-to-payload serializer to include `walletAddress` per child (only if non-empty after normalization) | Low | 15m |
| W2.2 | Extend serializer to include `learningGoals` per child: filter out goals with empty topics, append `completed: false` to each goal and subgoal, convert date input to ISO datetime via `${date}T00:00:00.000Z`, omit deadline field if empty | Medium | 30m |

### Workstream W3: Post-submit allowlist transparency panel (30 min)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W3.1 | After successful `/api/configure-family` response, before rendering magic-link URL, render allowlist panel with admin wallet + each child's wallet (from the response body's family config) | Medium | 30m |

### Workstream W4: Client-side validation feedback (30 min)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W4.1 | Wallet address regex check on blur: show inline error "Must be a valid Ethereum address starting with 0x" if non-empty and malformed | Low | 15m |
| W4.2 | Goal validation: if a goal has subgoals OR a deadline OR a category selected, topic becomes required. Show inline error on submit attempt | Low | 15m |

### Workstream W5: Test updates (45 min)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W5.1 | Audit existing `tests/verify-page.test.ts` (or equivalent) for assertions on form HTML structure. Update any that reference the old form's field count or layout | Low | 20m |
| W5.2 | Add a backward-compat test: post the old form's payload shape (no `walletAddress`, no `learningGoals`) to `/api/configure-family`, confirm success and valid family creation. This is the regression bar — if it ever breaks, Sprint 3.0.5 broke its central promise | Medium | 25m |

### Workstream W6: Manual smoke + documentation (30 min)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W6.1 | Manual test on Railway: bootstrap a family with goals via the new form, verify config persistence (`data/families/{id}/family-config.json` has the learning goals), then in Claude call `check-goals` to confirm round-trip | Low | 20m |
| W6.2 | Update README to note Sprint 3.0.5 shipped | Low | 10m |

---

## Time allocation

| Phase | Hours | Focus |
|-------|-------|-------|
| Pre-sprint validation | 0–0.5 | Confirm Sprint 3.0.3/3.0.4 actually shipped, schema fields present |
| W1 — Form field additions | 0.5–2.0 | Wallet + goals + subgoals + deadline fields |
| W2 — Payload serializer | 2.0–2.75 | Wire new fields into POST body |
| W3 — Transparency panel | 2.75–3.25 | Allowlist surface post-submit |
| W4 — Validation feedback | 3.25–3.75 | Inline UX for malformed input |
| W5 — Test updates | 3.75–4.5 | Backward-compat regression test + form-structure assertion updates |
| W6 — Smoke + docs | 4.5–5.0 | Railway manual test + README |

**Total: ~5 hours.** Half-day slice. Includes buffer for the inevitable "the existing serializer assumed something" surprises.

---

## Dependencies and risks

| Dependency | Risk | Mitigation |
|-----------|------|------------|
| Sprint 3.0.3 `LearningGoalSchema` with optional `subgoals` + `deadline` | High if not shipped | Verify in pre-sprint validation. If 3.0.3/3.0.4 schema not actually in `src/schemas.ts`, this sprint is blocked until those land. |
| Sprint 3.0.2 `authorizedDestinations` field on `FamilyConfig` | Medium | Verify in pre-sprint. Allowlist panel renders the field from the API response; if field missing, panel shows nothing graceful. |
| `tryNormalizeWallet` helper in `src/auth/wallet.ts` | Low (shipped Sprint 3.0 v4) | Use as-is. Form does its own regex check; server normalization is authoritative. |
| `@base-org/account` SDK loadability (Sprint 3.0 v4 W2.1 spike) | Already validated | No new SDK work. |
| Mobile date input behavior on iOS Safari | Medium | Real-device test in W6.1. Fallback if broken: text input with placeholder `YYYY-MM-DD` and regex validation. Not pre-built unless smoke surfaces the issue. |
| Form state grows complex enough to want React | Low | Vanilla JS pattern from Sprint 3.0 v4 W2.2 handles array-of-objects state cleanly with simple template-cloning. If state management hurts, defer to Sprint 3.5 React migration. |
| Existing test relies on exact HTML structure | Medium | W5.1 audits before W1 starts. Update tests as needed; don't weaken assertions. |
| Parent enters non-existent category for a goal (mismatch with configured categories) | Low | Category is a dropdown populated from the child's categories — parents pick from the list, can't free-type a category that doesn't exist. |
| Parent submits with form state corruption (e.g., 5 goals visible but state has 6) | Low | Cap enforcement in W1.6 disables buttons at the limit. Defense-in-depth: server validates `LearningGoalSchema.max(5)` if added in Sprint 3.5+ — for 3.0.5, no schema cap, just UI cap. |

## Fallback approaches

- **Mobile date input fails on iOS:** swap to `<input type="text" pattern="\d{4}-\d{2}-\d{2}">` with helper text. Cosmetic regression, no functional impact.
- **Inline subgoal UI is too dense:** ship goals-without-subgoals; defer subgoal UI to Sprint 3.5 micro-iteration. The `check-goals` tool gracefully handles goals with no subgoals.
- **Allowlist transparency panel feels intrusive in the success flow:** make it a collapsible "Show allowlist" disclosure. Same content, less visual weight.
- **Backward-compat test reveals an actual incompatibility (e.g., server now requires `learningGoals` to be present):** stop and fix the schema regression before any UI work continues. Sprint 3.0.5 cannot ship if the old payload shape fails.

---

## Sprint Contract — Sprint 3.0.5

### Success criteria

1. **Bootstrap with goals works end-to-end.** Parent fills form with 1+ child, 1+ goal (with or without subgoals, with or without deadline), submits, gets magic-link URL, opens Claude, calls `check-goals` → returns the configured goals correctly.
2. **Bootstrap without goals still works.** Parent fills form with no goals, submits, gets magic-link URL, family has empty `learningGoals: []` (or undefined) per child, `check-goals` returns the Sprint 3.0.3 empty-state copy.
3. **BYO-wallet path works.** Parent supplies a kid's wallet address at bootstrap, the address ends up in `ChildConfig.walletAddress` and gets auto-added to `authorizedDestinations` per Sprint 3.0.2 Step 6c. Distributions to that kid succeed.
4. **AllowMe-managed wallet path still works.** Parent leaves kid wallet field empty, AllowMe creates an OWS-managed wallet, that wallet's address ends up on the allowlist via auto-add.
5. **Backward-compat regression test passes.** The old form's payload shape (no `walletAddress`, no `learningGoals`) successfully creates a family with empty goals and auto-created kid wallets.
6. **Subgoals persist correctly.** A goal configured with 3 subgoals in the form lands in `ChildConfig.learningGoals[0].subgoals` with all 3 entries, each with `completed: false`.
7. **Deadline persists correctly as ISO datetime.** Date input "2026-08-15" lands in storage as `"2026-08-15T00:00:00.000Z"`. `check-goals` `daysUntilDeadline` computation works against this value.
8. **Allowlist transparency panel renders.** Post-submit success state shows the admin wallet + each child's wallet before the magic-link URL.
9. **Caps enforced.** "+ Add learning goal" disabled when 5 goals exist for a child. "+ Add subgoal" disabled when 5 subgoals exist for a goal.
10. **Inline wallet validation works.** Typing a malformed Ethereum address shows the inline error on blur; valid address removes the error.
11. **Sprint 3.0.2 + 3.0.3 + 3.0.4 backend tests still pass.** Zero regressions in the 363+ existing tests.
12. **Mobile flow works on real iOS device.** Bootstrap completes on iOS Safari with Coinbase Wallet, including the date input, the dropdowns, the dynamic add/remove buttons.

### Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| Functionality | 40% | All new fields persist correctly; backward-compat preserved; bootstrap-to-check-goals round-trip works |
| UX / Form Design | 25% | Per-child nesting reads naturally, dropdown for category is discoverable, caps prevent UI overload, error states are clear |
| Backward Compatibility | 20% | Old payload still accepted; existing test suite green; pre-3.0.5 families continue to work |
| Documentation | 10% | README updated; allowlist transparency panel makes Sprint 3.0.2 model visible |
| Mobile Usability | 5% | Real iOS device test passes; date picker, dropdowns, dynamic buttons all behave |

### Grading thresholds

- **Pass:** All success criteria 1–12 verified. No category below 75%. Backward-compat regression test green. Sprint 3.0.2/3.0.3/3.0.4 test suite green.
- **Fail:** Any of (1)–(11) fails. OR backward-compat regression test fails. OR existing test suite regresses. OR mobile flow blocks on iOS.

### Success conditions beyond the rubric

- A parent can complete bootstrap with goals + subgoals + deadline + BYO-wallet in under 4 minutes on mobile (compared to ~90 seconds for the minimal form). The added depth is opt-in but doesn't require disproportionate effort.
- The allowlist transparency panel reads cleanly enough that a parent who knows nothing about crypto understands "the treasury can only send to these addresses."
- The post-bootstrap experience for your son (Section 1 learner-mode test) now has goals populated, so `check-goals` returns a meaningful response on first ask.

---

## Scope guard — explicitly NOT in Sprint 3.0.5

1. Verify-page visual redesign (categories validator UX, testnet toggle, success-state animations)
2. Goal-recommendation engine or suggested-goals library
3. Subgoal mastery auto-tracking on `verify-achievement` (Sprint 3.0.3.x / 3.5)
4. Wallet picker, wallet discovery, "connect existing wallet" UX
5. React or form-library migration
6. Multi-language form (Spanish version — Sprint 3.5+)
7. Goal-deadline push notifications (Sprint 4.0 infrastructure)
8. Pre-submit "review your family setup" step
9. Goal categories outside the configured per-child categories (no free-text category for goals)
10. Allowlist add/remove UI outside `configure-policy` in Claude
11. Photo upload for child profile or family branding
12. Family privacy settings UI
13. Audit-log viewer in the verify-page
14. Pricing / billing UI
15. "Import goals from a template" feature
16. Bulk goal creation across multiple children at once
17. Goal-progress dashboard
18. Cross-family goal sharing
19. Goal collaboration with co-parents at bootstrap (co-parent is invited post-bootstrap; goal-edit is Manager-only per Sprint 3.0.3)
20. Anything that requires backend changes

---

## Sequencing within Sprint 3.0.x

This sprint is the last 3.0.x slice before Sprint 3.5 (polish, gift-contribute, OWS wiring stretch from 3.0.2, etc.) and Sprint 4.0 (Coinbase Smart Wallet, paymaster, Postgres).

Order of recent sprints:
1. ✅ Sprint 3.0.1 — `learningGoals` schema (shipped)
2. ✅ Sprint 3.0 v4 — Sign-in-with-Base + verify-page (shipped)
3. ✅ Sprint 3.0.2 — destination allowlist (shipped)
4. ✅ Sprint 3.0.3 — kid-facing copy, `check-goals` tool, accept-invite copy (shipped)
5. ✅ Sprint 3.0.4 — subgoals + deadline schema (shipped)
6. **→ Sprint 3.0.5 — verify-page form extension (this sprint)**
7. Sprint 3.5 — polish, OWS executable wiring stretch, Spanish form, dashboard
8. Sprint 4.0 — Smart Wallet treasury, paymaster, Postgres

Sprint 3.0.5 unblocks:
- Honest learner-mode end-to-end testing with your son
- Landing-page docs that match what bootstrap actually delivers
- Pilot family deployment without parent context-switch friction

## How to use this plan

Order of execution within the sprint:
1. **Pre-sprint validation** (30 min) — confirm Sprint 3.0.3/3.0.4 schema actually shipped (`grep` for `subgoals` and `deadline` in `src/schemas.ts`)
2. **W5.2 first** (25 min) — write the backward-compat regression test BEFORE any form changes. Run it; confirm it passes against the existing form payload shape. This is the safety net.
3. **W1.1** (20 min) — wallet field. Smallest, cleanest addition; smoke-test the form-modification pattern.
4. **W1.2–W1.6** (~90 min) — goals + subgoals + deadline.
5. **W2.1–W2.2** (45 min) — payload serializer.
6. **W4.1–W4.2** (30 min) — inline validation.
7. **W3.1** (30 min) — allowlist panel.
8. **W5.1** (20 min) — fix any HTML-structure-asserting tests.
9. **W6.1** (20 min) — Railway smoke test with mobile device.
10. **W6.2** (10 min) — README.

Re-run W5.2 between each W-step. If it ever breaks, stop and fix before continuing.

## Pre-sprint checklist

- [ ] Sprint 3.0.3 + 3.0.4 confirmed shipped (`learningGoals.subgoals` and `learningGoals.deadline` present in `src/schemas.ts`)
- [ ] Sprint 3.0.2 production validation confirmed (allowlist auto-populates on configure-policy)
- [ ] Backup of production `data/` taken before any deploy
- [ ] Confirm `public/verify.html` is the active file path (Sprint 3.0 v4 W2.2)
- [ ] Confirm Tailwind CDN still loads (no broken stylesheet ref)
- [ ] Real iOS device with Coinbase Wallet ready for mobile smoke test
- [ ] Decisions Q1, Q2, Q3 from research-3.0.5.md confirmed (caps, date-only, panel)
- [ ] Test wallet with Base Sepolia ETH + USDC for the W6.1 round-trip