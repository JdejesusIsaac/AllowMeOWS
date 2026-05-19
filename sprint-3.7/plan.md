# Sprint 3.7 — URL Design + Subgoal Matcher + Polish

## What this sprint ships

Three deliverables that close the design-completeness arc that began with Sprint 3.6:

1. **URL design pass** — invite URLs move from `allowme.dev/verify?invite=CODE&role=ROLE` to `allowme.dev/join/CODE`. Old URLs continue to work (backward-compat).
2. **Subgoal auto-matching** — when a learner verifies an achievement, the matcher checks subgoal topics and auto-completes high-confidence matches. Conservative threshold (≥0.85 fuzzy similarity OR substring match).
3. **Polish** — founder bio paragraph in `why.md`, walkthrough GIF placeholder cleanup on verify success state.

No core schema changes. One new audit-log action enum value (`subgoal-auto-completed`). One new npm dependency (`string-similarity`). Total scope: ~6-8 hours, one focused day or two half-day sessions.

## Why this cut is right

Sprint 3.7 addresses the last remaining design-completeness items from the design-lead critique that didn't fit in Sprint 3.6's scope. After 3.7, the product reaches the 8+ design rating the critique projected. Three deliverables grouped in one sprint because:

- They share an "interface polish" theme that justifies cohesive planning
- They're small enough individually that separate sprints would be sprint-overhead-heavy
- They don't conflict — no shared code surfaces, no race conditions

The optional alternatives (defer URL design to Sprint 4.0, ship matcher as its own micro-sprint, skip polish) were considered and rejected per research-3.7.md.

## Architecture decisions

### Decision 1 — URL design: Option B (path-based with role-from-record)
**Decision:** New route `/join/:code` added to verify routes. Role is looked up from the invite record at redemption time, not parsed from URL. Old `/verify?invite=...&role=...` route stays working for backward compat.

**Why:** Zero risk to invite-code infrastructure. Role-from-URL was redundant (already in invite record). Path-shaped URLs read as destinations, not endpoints. See research-3.7.md Decision 1.

### Decision 2 — Subgoal matcher: conservative threshold
**Decision:** Substring match OR fuzzy match ≥0.85 similarity → auto-complete subgoal. Below threshold but ≥0.65 → surface as "possible match, not auto-completed" in response copy. Below 0.65 → silent no-match.

**Why:** Asymmetric cost favors conservative. Parent override always available. Pilot data tunes thresholds in Sprint 4.0+.

### Decision 3 — Polish items included, tight scope
**Decision:** Founder bio paragraph (3-4 sentences) added to `why.md`. GIF placeholder cleanup via CSS that hides the "Drop walkthroughs/*.gif here" text when the GIF file is missing.

**Why:** Closes brand-trust gap. Removes visible roughness. <30 min each.

### Decision 4 — `string-similarity` npm dependency
**Decision:** Add `string-similarity` package for fuzzy match scoring. Pure JS, no native deps, 3.7KB.

**Why:** Mature, well-tested, no maintenance overhead. Hand-rolled Jaccard adds 30 lines of code we'd own and have to test ourselves.

### Decision 5 — No data migration for old invites
**Decision:** Existing invites in the wild with the old `/verify?invite=...&role=...` URL form continue to redeem via the legacy route. No backfill, no URL rewriting.

**Why:** Backward compat is already provided by keeping the old route. Migrating old invites would require URL rewriting that adds zero value (they already work).

---

## Implementation steps

### Workstream W1: URL design pass (~2-3 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W1.1 | Add `/join/:code` route handler in `app/verify-routes.ts` (or wherever the routing lives). Look up invite record by code; if found, resolve role from record and proceed with same logic as legacy `/verify` handler | Medium | 45m |
| W1.2 | Update `invite-member.ts` tool response to return the new URL form (`allowme.dev/join/HERM-LEARN-RH6Z`) in the `verifyUrl` field. The `invite-code` field stays unchanged | Low | 15m |
| W1.3 | Update `message_compose` SMS template to use the new URL form | Low | 10m |
| W1.4 | Update verify-page HTML if any client-side code parses queryparams (the new form has no queryparams; client just renders state from server-rendered template) | Low-Medium | 30m |
| W1.5 | Tests U1-U4 (per test-3.7.md): new URL form works, old URL form still works (backward compat), role-from-record correctly resolves, malformed code returns clean error | Medium | 45m |

### Workstream W2: Subgoal auto-matching (~3-4 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W2.1 | `npm install string-similarity --save` and confirm import | Low | 5m |
| W2.2 | Extend `src/core/goal-matching.ts` (or wherever the current matcher lives): add `findMatchingSubgoal(achievement, child)` returning `{goalIndex, subgoalIndex, confidence, matchType}` or null | High | 60m |
| W2.3 | Wire into `verify-achievement.ts`: after the achievement is verified, run subgoal matcher; if `confidence ≥ 0.85`, set subgoal `completed: true` and persist; emit `subgoal-auto-completed` audit entry | Medium | 30m |
| W2.4 | If `0.65 ≤ confidence < 0.85`, do NOT auto-complete but include "possible subgoal match" in the verify-achievement response card | Medium | 20m |
| W2.5 | Add `subgoal-auto-completed` to AuditEntrySchema action enum in `src/schemas.ts` (single line addition; non-breaking) | Low | 5m |
| W2.6 | Tests AM1-AM7 (per test-3.7.md): exact match auto-completes, fuzzy match above 0.85 auto-completes, fuzzy match in 0.65-0.85 range surfaces hint but doesn't auto-complete, no-match below 0.65 stays silent, audit entry recorded, false-positive prevention case, parent manual completion still works | High | 60m |

### Workstream W3: Polish (~45 min)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W3.1 | Add 3-4 sentence founder paragraph to `public/copy/why.md`. Tone: professional, mission-focused, brief. Touches: name, security-researcher / CDP-Ambassador credentials, motivation (financial literacy + AI education), pilot context (NYC charter schools) | Low | 20m |
| W3.2 | CSS pass in `public/verify.html`: when `/walkthroughs/*.gif` 404s or is missing, render a lighter-gray skeleton with text like "Walkthrough video — coming soon" instead of "Drop walkthroughs/claude.gif here" | Low-Medium | 25m |

### Workstream W4: Documentation + smoke (~30 min)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W4.1 | README.md — add Sprint 3.7 section to roadmap | Low | 10m |
| W4.2 | Railway production smoke per progress-3.7.md V1-V4 | Medium | 20m |

---

## Time allocation

| Phase | Hours | Cumulative |
|-------|-------|-----------|
| W1 — URL design pass | 2.5 | 2.5 |
| W2 — Subgoal matcher | 3.0 | 5.5 |
| W3 — Polish | 0.75 | 6.25 |
| W4 — Docs + smoke | 0.5 | 6.75 |

**Total: ~6.75 hours.** One focused day or two half-day sessions of 3-3.5 hours each. The subgoal matcher (W2) is the time-bomb — if the matching logic surfaces edge cases that need careful handling, that workstream can grow. Polish (W3) can be cut if time pressure builds without compromising the sprint's value.

## Dependencies and risks

| Dependency | Risk | Mitigation |
|-----------|------|------------|
| Sprint 3.6 closure session complete (GIFs recorded, V1-V6 smoke passed) | Medium | Run closure session BEFORE Sprint 3.7 starts. If closure surfaces a regression, fix before continuing. |
| `string-similarity` npm package installable | Low | Mature package, no native deps. Quick `npm install` verifies. |
| Current `findMatchingGoalIndex` implementation exists and is readable | Low | Confirmed in Sprint 3.0.3 and 3.0.5; structure preserved in repo. |
| Old `/verify` route is not aggressively cached by Railway CDN | Low | Both routes share infrastructure; cache headers should be uniform. Verify in smoke. |
| Subgoal matcher false-positive rate higher than expected in practice | Medium | Conservative threshold (0.85) is the primary mitigation. Pilot data triggers tuning in Sprint 4.0. |
| Audit log gets noisy with `subgoal-auto-completed` entries for active learners | Low | Audit log is already verbose by design. Filtering tools in Sprint 4.0+. |
| Founder bio reads as marketing-speak | Medium | Draft, sleep on it, edit. If unsure, paste to a trusted reader for tone check. |
| Existing test suite stays green | Medium | All deliverables additive; no breaking schema changes. Run full suite after each W. |

## Fallback approaches

- **W2 subgoal matcher edge cases:** if false-positive rate is high in unit tests, raise threshold to 0.90 and document in research-3.7.md as tuning data. Don't ship with known false-positive risk.
- **W1 backward-compat tests fail:** the legacy `/verify?invite=...&role=...` route must continue to work. If a test fails, fix the route handler immediately — backward-compat is non-negotiable.
- **W3 founder bio writing block:** if the bio draft feels off, ship without it. The polish is optional; Sprint 3.8 absorbs.
- **W3 GIF placeholder cleanup looks worse:** if the new skeleton state is more visually awkward than the current placeholder, ship without it. Status quo > visual regression.

---

## Sprint Contract — Sprint 3.7

### Success criteria

1. **New URL form works end-to-end.** Generate a fresh invite; URL is `allowme.dev/join/CODE` (no queryparams); tap URL on phone; verify-page renders correctly with correct family/role/name; redemption produces magic-link URL.
2. **Old URL form still works.** Any URL in the wild using `/verify?invite=...&role=...` continues to redeem. Backward-compat enforced by U2 test.
3. **Role-from-record resolution works.** A learner invite with no role queryparam redeems as learner because the invite record stores role.
4. **Subgoal auto-completes on confident match.** Achievement description "Read about Ancient Greece for 30 min" against subgoal topic "Ancient Greece reading" → subgoal flips to `completed: true`; audit entry recorded with `confidence ≥ 0.85`.
5. **Ambiguous match surfaces hint, does not auto-complete.** Achievement "Read a chapter today" against subgoal "Ancient Greece reading" → confidence between 0.65 and 0.85 → response card includes "possible subgoal match" line but subgoal stays `completed: false`.
6. **No-match cases stay silent.** Achievement "Did math homework" against subgoal "Ancient Greece reading" → confidence below 0.65 → no auto-completion, no hint surfaced.
7. **Subgoal auto-complete audit entries.** Every auto-completion writes `subgoal-auto-completed` with `actor`, `subgoalTopic`, `achievementDescription`, `matchConfidence`, `matchType`.
8. **`check-goals` reflects subgoal completion correctly.** After auto-completion, learner asking "what are my goals?" sees `✓` for the completed subgoal.
9. **Founder bio paragraph present in `why.md` and renders in brand modal.** Modal content includes mission + credentials + motivation. MODAL1 test extended with founder-bio-line assertion.
10. **GIF placeholder cleanup applied.** Either GIFs are present (closure session shipped them) and play correctly, OR placeholder hidden/skeletonized.
11. **All Sprint 3.6 + 3.6-closure tests still pass.** Including the 363+ baseline and the +14 from 3.6.
12. **No core schema changes.** Only one audit enum extension (`subgoal-auto-completed`).
13. **Mobile smoke passes:** new URL form opens cleanly on iOS Safari + Android Chrome; subgoal auto-completion visible in learner check-goals response on real device.

### Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| Subgoal matcher correctness | 35% | The highest-leverage kid-experience improvement. False positives are reputationally bad; conservative threshold is the central correctness property. |
| URL design + backward compat | 25% | Sprint's central engineering deliverable. Both new and old URLs must work. |
| Test coverage | 15% | +12 new tests must land; existing suite must stay green |
| Polish quality | 10% | Founder bio reads professionally; GIF placeholder cleanup either improves or removes the rough state |
| Production behavior | 15% | New URL renders correctly; subgoal matcher fires on real achievements; audit log clean |

### Grading thresholds

- **Pass:** All criteria 1–13 verified. No category below 75%. Subgoal matcher false-positive rate observed in tests is acceptably low (no AM6 test failure).
- **Fail:** Any of (1)–(13) fails. OR backward-compat U2 test broken. OR subgoal matcher auto-completes on a no-match case (AM6 failure). OR existing test suite regresses.

### Success conditions beyond the rubric

- A pilot family's kid logs an achievement and sees a subgoal auto-complete in the same conversation turn. The feedback loop closes within seconds.
- The new URL form passes the "would a parent paste this to their kid without explanation?" test better than the old URL did.
- The founder bio reads honestly and doesn't trigger marketing-speak detection.

---

## Scope guard — explicitly NOT in Sprint 3.7

1. URL shortening service or per-family subdomain
2. Spanish-language matcher
3. Goal-recommendation engine
4. Retroactive subgoal completion against historical achievements
5. Parent confirmation flow for ambiguous matches
6. Founder-bio video, photo, or social links
7. Verify success page redesign beyond the GIF placeholder cleanup
8. New tools (no `recommend-subgoals`, no `bulk-mark-complete`)
9. New schema fields or canonical-schema changes
10. Coinbase Smart Wallet treasury (Sprint 4.0)
11. Paymaster (Sprint 4.0)
12. Postgres migration (Sprint 4.0)
13. Rich-card refactor of any tool not already covered in Sprint 3.6
14. Walkthrough GIF re-recording or quality improvement (Sprint 3.6 closure work, not 3.7)
15. Landing page docs (parallel workstream that follows 3.7)

## Sequencing

Within Sprint 3.7, recommended order:

1. **Pre-sprint validation** (15 min) — confirm Sprint 3.6 closure complete, baseline tests green
2. **W2.1 first** (5 min) — install string-similarity to verify clean install before designing matcher around it
3. **W1.1, W1.2** (60 min) — URL design pass + tool response update
4. **W1.5** (45 min) — tests U1-U4
5. **W2.2-2.5** (~2 hr) — subgoal matcher core + wiring
6. **W2.6** (60 min) — tests AM1-AM7
7. **W1.3, W1.4** (40 min) — SMS template + verify-page client-side
8. **W3.1, W3.2** (45 min) — polish
9. **W4.1, W4.2** (30 min) — docs + smoke

Total: ~6.75 hours. Two sessions of ~3.5 hours, or one focused 6-7 hour day.

## Pre-sprint checklist

- [ ] Sprint 3.6 closure session complete: GIFs in production, V1-V6 smoke passed, progress-3.6.md updated
- [ ] All Sprint 3.6 + closure tests green (377+ passing)
- [ ] Backup of production data taken
- [ ] `string-similarity` npm package compatibility verified with current Node version
- [ ] Real iOS device available for W4.2 smoke
- [ ] Test wallet still funded for any distribution smoke (probably not needed in 3.7, but available)
- [ ] Q1 confirmed: `string-similarity` library (yes per research)
- [ ] Q2 confirmed: 3-4 sentence founder bio (yes per research)
- [ ] Q3 confirmed: 0.85 starting threshold (yes per research)