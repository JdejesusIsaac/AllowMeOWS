# Sprint 3.0.5 — Research

## Problem

Three sprints have shipped backend functionality that the verify-page bootstrap form cannot configure:

- **Sprint 3.0.2** — destination allowlist with per-child wallet binding. Bootstrap form has no field for kids' external wallet addresses, forcing post-bootstrap reconfigure via Claude.
- **Sprint 3.0.3** — `learningGoals` schema extension, `check-goals` tool, kid-facing copy fixes. Bootstrap form has no learning-goals input, so every new family ships with empty goals and the friendly-empty-state copy fires for everyone instead of being a true edge case.
- **Sprint 3.0.4** — subgoals (max 20 per goal) and optional ISO datetime deadline on `LearningGoalSchema`. Same problem — bootstrap form doesn't expose these.

Net effect: the backend work is functionally invisible to anyone who hasn't been in the build sessions. A pilot family completing the verify-page flow lands in Claude with no goals, no kid wallets, no allowlist transparency — and would need to context-switch back into Claude to call `configure-policy` a second time to actually use what 3.0.3/3.0.4 added. That's exactly the friction the magic-link UX was designed to eliminate.

This sprint closes the gap with a UI-only extension. No schema changes. No backend changes. No new tools. The verify-page bootstrap form learns to ask for what the backend already accepts.

## Why now (and why not earlier)

The natural question: why didn't the 3.0.3 and 3.0.4 sprints update the form when they extended the schema?

Two reasons, neither flattering:

1. **The work was scoped as "backend extension" without an accompanying UI deliverable.** Sprint 3.0.3 plan called for the `check-goals` tool but assumed goals would be configured via conversational `configure-policy` calls in Claude. That assumption was correct for dogfooding (which is how the work got tested) and wrong for pilot families (who follow the verify-page documented flow).
2. **The bootstrap form felt complete at the time it shipped.** Sprint 3.0 v4 deliberately ended the magic-link UX work as a focused, demoable artifact. Adding fields would have grown scope. The trade-off was made consciously; the consequence (this sprint) is the bill coming due.

Both observations are worth recording so the same pattern doesn't repeat in Sprint 3.5+. The rule going forward: **any schema extension that changes parent-facing data also extends the bootstrap UI in the same sprint, or explicitly defers it to a same-quarter UI sprint, with the deferral documented.** Sprint 3.0.5 is the recovery; future sprints should not need a recovery.

## Locked decisions

### Decision 1 — Option A: learning goals are nested per-child

The verify-page form already groups per-child fields (name, budget, savings %, categories) in a single visual block. Learning goals follow the same pattern — nested inside each child's block, immediately after the categories input, before the "Add another child" button.

**Why Option A:**
1. **Mirrors the data model.** `ChildConfig.learningGoals[]` is per-child in the schema; the form should reflect the same structure.
2. **Reads naturally to parents.** "What is Aiden working on?" is a question about Aiden, not about goals-in-general. A flat goals section that requires assigning a child via dropdown would invert that reading.
3. **Discoverable category mapping.** The `LearningGoal.category` field must match an already-configured category on the child. With goals nested under the child, the category dropdown can be populated from the categories the parent just configured in the same block — no cross-referencing.

**Rejected: Option B (top-level goals section with child selector).**
- Flatter form, but the data flow is less intuitive
- Parents have to remember to assign each goal to a kid
- Category dropdown becomes context-dependent in a way that's harder to validate before submit
- Mirrors a hypothetical "goal-library shared across kids" model that doesn't exist in the schema

### Decision 2 — Goals are optional and limit to 5 per child

The form lets a parent add 0 to 5 goals per child. Default state: 0 goals (empty), with a discreet "+ Add learning goal" button. No goals required to submit.

**Why optional:**
- Backward compat with the existing form behavior (today's form has no goals; families submit without them).
- A parent who wants to set goals later via Claude `configure-policy` can do so. The form shouldn't force a pedagogical decision at bootstrap time.
- Empty-goals state is the existing `check-goals` empty-state copy from Sprint 3.0.3, which works fine. Not configuring goals is a legitimate end state, not a missing step.

**Why cap at 5:**
- The `LearningGoalSchema` itself has no cap (any reasonable number is valid).
- A bootstrap form with 20 goals per child is unwieldy UX and signals a different product (curriculum management, not allowance).
- 5 is roughly the limit before form fatigue sets in for the parent.
- A parent who genuinely needs more can add additional goals post-bootstrap via Claude.

If pilot data shows parents wanting more than 5 at bootstrap, Sprint 3.5 lifts the cap. Don't pre-engineer.

### Decision 3 — Subgoals capped at 5 per goal in the form (schema allows 20)

Same logic as Decision 2. The schema cap of 20 is a guardrail against curriculum-scale data; the form cap of 5 is a UX guardrail against form fatigue.

A parent who legitimately needs 20 subgoals (catching up multiple grade levels with fine-grained progression) can configure them via Claude after bootstrap.

### Decision 4 — Deadline field uses native `<input type="date">`

The `LearningGoal.deadline` schema field is `z.string().datetime()` (full ISO-8601 datetime). The form uses HTML5 `<input type="date">` which produces `YYYY-MM-DD`. The form's submit handler converts to ISO datetime by appending `T00:00:00.000Z` before posting.

**Why native date input:**
- No JavaScript date picker library needed
- Mobile-native date picker on iOS/Android (the actual usage devices)
- Accessible by default
- Matches the conversational format parents naturally think in ("August 15") better than a datetime picker

**Why the appended time:**
- The schema expects datetime, not date
- Midnight UTC is the conventional "end of this date" for deadline purposes
- Sprint 3.0.4 `check-goals` already computes `daysUntilDeadline` from this value, no behavior change

### Decision 5 — Per-child wallet address is optional, validated client-side

The form adds a `Kid's wallet address (optional)` field per child, after the name input. If supplied, validated client-side using a simple regex (`/^0x[a-fA-F0-9]{40}$/`); deeper validation happens server-side via the existing `tryNormalizeWallet` helper from Sprint 3.0 v4.

**Why client-side validation:**
- Immediate feedback to the parent before submit (no round-trip to discover a typo)
- Doesn't replace server-side validation — defense-in-depth, not the primary check
- Simple regex is sufficient for shape; checksum validation is server-side per existing Sprint 3.0 v4 patterns

**Why optional:**
- If parent omits, AllowMe creates an OWS-managed wallet for the kid (existing Sprint 2.9.1 behavior). No regression.
- If parent supplies, the address goes into `ChildConfig.walletAddress` and gets auto-added to the Sprint 3.0.2 allowlist by the configure-family core logic.
- Mirrors the BYO-wallet vs managed-wallet design already in the schema.

### Decision 6 — Post-submit allowlist transparency panel

After successful family creation, before showing the magic-link MCP URL, the form renders a brief confirmation panel listing:

- The admin wallet (from SIWE)
- Each child's wallet (whether supplied by parent or auto-created by AllowMe)
- A note explaining these are the only addresses the treasury can transfer to
- A pointer to updating the allowlist via Claude `configure-policy`

**Why this is here, not deferred:**
- Sprint 3.0.2's security model only matters if parents understand it. Today the allowlist is enforced but invisible.
- The moment of bootstrap is the only moment the parent has full cognitive context on what addresses exist. Showing the list later (e.g., on dashboard) requires building a dashboard.
- It's a small UI addition (~30 min) that pays back across every pilot family conversation about "what stops a stranger."

### Decision 7 — No "add goals later" hint replaces in-form goal entry

The post-submit success state already contains language like "you can update goals later via Claude." This is fine to keep — it's accurate and useful. What it must NOT become is a substitute for asking at bootstrap time.

The temptation: skip the in-form goals section, point parents at Claude post-submit, ship faster. Rejected because:
- Asking at bootstrap captures the parent at their highest-context moment
- Post-submit "now go to Claude and call configure-policy" is the exact context-switch friction the magic-link UX was designed to eliminate
- Pilot data from Sprint 3.0.3 dogfooding shows that goals configured at bootstrap get used; goals configured later often don't get configured at all

## Constraints

### Backward compatibility — absolute requirement

The `POST /api/configure-family` endpoint signature does not change. The backend already accepts `learningGoals?`, `subgoals?`, `deadline?`, and `walletAddress?` as optional fields (Sprint 3.0.3 and 3.0.4 made these additions). The form posts a richer payload using the same endpoint contract.

**Test:** an integration test that posts the *old* form's payload shape (no goals, no kid wallet) succeeds and produces a valid family. This is the regression bar.

### No schema changes

`src/schemas.ts` is not touched. Every field the form posts is already accepted by the Zod validators. This is the strongest signal that Sprint 3.0.5 is purely additive — if a schema change were required, the work would be a different sprint.

### No new tools

No new MCP tool surface. No new HTTP endpoints. The entire diff is in `public/verify.html` (and any shared JS/CSS the verify-page already loads) plus minor test updates.

### No new audit-log actions

Audit-log entries that already fire (`family-created-via-verify-page`, `authorized-destinations-updated`) cover the new form's outputs. No new action enum values needed.

### Existing test suite passes

All 363 tests post-Sprint-3.0.2 continue to pass. The verify-page tests (HE1-HE8) assert against API contract and behavior, not form HTML structure, so they're unaffected by UI additions. Any test that did assert on form HTML needs updating to reflect the new fields without changing the underlying assertion intent.

## What this sprint is NOT

To preempt scope-creep questions during execution:

- **Not a verify-page redesign.** The temptation to clean up adjacent UX (friendlier categories validator, more prominent testnet toggle, fancier success state) is real. Resist. Sprint 3.5+ if needed.
- **Not a goal-recommendation engine.** "Suggested goals for a 7-year-old" or "popular goals other families set" are not in scope. Parents type their own.
- **Not a subgoal-mastery-tracker.** Subgoals get a `completed` boolean only. The matcher that flips subgoals on `verify-achievement` is Sprint 3.0.3.x or 3.5 work per the prior session.
- **Not a wallet picker / wallet discovery UX.** The kid wallet field is a plain text input. No "scan QR" or "connect wallet" widget.
- **Not a real-time form validation library.** Simple inline error messages on blur are sufficient. No React Hook Form, no Formik, no validation-message rendering library.
- **Not a multi-language form.** English-only for Sprint 3.0.5. Spanish parent-page is Sprint 3.5+ per the docs sequencing.
- **Not a goal-deadline notification system.** Form captures deadline; surfacing it is `check-goals` (already shipped). Push notifications when deadlines approach are Sprint 4.0 infrastructure work.
- **Not a "preview your goals before submit" step.** Parent can see what they entered in the form itself; a separate review step adds friction.

## Open questions before code

Three confirmations:

**Q1: Goals cap at 5, subgoals cap at 5 — confirmed?**
Alternative is no cap (let parent add unlimited, trust them). Recommendation: cap, for UX-load reasons. Caps are guardrails, not schema constraints — pilot data can adjust later.

**Q2: Deadline field — date-only UI (no time) — confirmed?**
Form uses `<input type="date">` and converts to midnight UTC on submit. Alternative is `<input type="datetime-local">` which exposes time-of-day. Recommendation: date-only. Parents think in dates, not datetimes; the time-of-day precision is misleading for a goal that's really "by end of day August 15."

**Q3: Post-submit allowlist transparency panel — confirmed?**
Alternative is shipping without the panel (defer to Sprint 3.5+ dashboard). Recommendation: ship now. Small addition, large pedagogical payoff for the security model.

All three are independent decisions; differences are localized and don't cascade.

## Forward compatibility

Two things to note for future sprints:

**Sprint 4.0 Coinbase Smart Wallet migration:** the per-child wallet field captured today becomes the seed for the Sprint 4.0 sub-account address (if Approach B is chosen later) or the spend-permission recipient list (Approach A). Either way, capturing wallet addresses at bootstrap is forward-compat work, not just present-day UX.

**Sprint 3.0.3.x subgoal auto-matching:** when `verify-achievement` learns to fuzzy-match against subgoal topics (deferred from 3.0.3), the subgoals captured by this form become the matching corpus. Capturing them at bootstrap means the matcher has data to work with from day one of any pilot family.

Sprint 3.0.5 is the unblock for both Sprint 3.5 dogfooding (your son's actual goal flow) and Sprint 4.0 architectural follow-on.

## References

- Sprint 3.0 v4 plan: `sprint-3.0/plan-3.0-v4.md` (defined verify-page, /api/configure-family endpoint, Decision 11 family-creation form)
- Sprint 3.0.2 plan: `sprint-3.0.2/plan-3.0.2.md` (allowlist auto-populate from `caller.walletAddress` + each `ChildConfig.walletAddress`)
- Sprint 3.0.3 (informal — `check-goals` tool spec, copy diffs)
- Sprint 3.0.4 (informal — subgoals + deadline schema extension)
- Live form screenshot: 2026-05-13 verify-page showing the field gap
- Existing form file: `public/verify.html`
- Zod validators: `src/schemas.ts` (`LearningGoalSchema`, `SubgoalSchema`, `ChildConfigSchema`, `FamilyConfigSchema`)