# Sprint 3.7 — Research: URL Design + Subgoal Matcher + Polish

## Problem

Two real engineering deliverables and one polish item carry forward from prior sprints:

**URL design pass (deferred from Sprint 3.6):** today's invite URLs look like configuration endpoints (`allowme.dev/verify?invite=HERM-LEARN-RH6Z&role=learner`) rather than destinations. The queryparam form leaks implementation details — `verify` is a route name, `invite` is a field name, `role` is a redundant queryparam since the role is recoverable from the invite record. A laymen parent reading the URL parses it as "looks technical, might or might not be safe to share." A path-shaped URL (`allowme.dev/join/HERM-LEARN-RH6Z`) reads as a destination the kid is being invited to visit.

**Subgoal auto-matching (deferred from Sprint 3.0.3.x):** today, when a learner logs an achievement via `verify-achievement`, the matcher walks goal categories only. Subgoals — which Sprint 3.0.4 added to the schema and Sprint 3.0.5 made bootstrappable — never auto-complete. The parent has to manually mark each subgoal complete via `configure-policy`, which is exactly the context-switch friction the agent-native architecture was supposed to eliminate. The kid earns "Read about Ancient Greece" achievement, the subgoal "Ancient Greece reading" stays open, and the feedback loop that makes the kid feel responsive to their own learning never closes.

**Polish items:** founder bio in `why.md` (closes a brand-trust gap flagged by the design-lead critique), and walkthrough GIF placeholder cleanup (cosmetic but lands in the same surface area).

Sprint 3.7 ships all three as a focused 6-8 hour sprint, then the design-completeness arc that began with Sprint 3.6 reaches actual completion.

## Why these three together

Three alternatives were considered and rejected:

**Ship URL design + subgoal matcher as separate micro-sprints.** Rejected because: (1) the two deliverables touch different code surfaces with no overlap, so sequencing them doesn't reduce risk, (2) the planning overhead of two sprints is higher than one, (3) the polish items don't fit either standalone sprint cleanly — bundling them with one or the other is more honest.

**Defer URL design pass to Sprint 4.0.** Rejected because: (1) URL design is the kind of work that gets perpetually deferred if not scheduled — every sprint has "more urgent" work, (2) shipping pilot families against URLs that read as configuration-endpoints carries a real first-impression cost, (3) the change is small (route handler refactor + invite-member tool response update) and the leverage is high.

**Combine URL design with the broader landing-page docs.** Rejected because: (1) docs work follows Sprint 3.7 anyway (depends on closure-attested screenshots), (2) URL change is an engineering deliverable, docs are a writing deliverable, (3) keeping them separate respects the different cognitive modes the two require.

The chosen cut — three deliverables, one focused sprint — is the minimum that closes the design-completeness arc and unblocks honest pilot deployment.

## Locked decisions

### Decision 1 — URL design pass: Option B (path with full code, role from invite record)

**Decision:** Move from `allowme.dev/verify?invite=CODE&role=ROLE` to `allowme.dev/join/CODE`. Role is looked up at redemption time from the invite store, not from the URL.

**Why Option B over Option A (short codes with role-in-path):**

1. **Zero risk to existing invite-code infrastructure.** Option A would require shortening codes from `HERM-LEARN-RH6Z` to `HRMZ` or similar — that's a code-generation change with collision-avoidance implications and audit-log readability trade-offs. Option B leaves invite codes untouched.

2. **Role-from-URL is redundant.** The invite record in `data/families/{id}/invites.json` already stores the role for every invite. Reading it from the URL is a duplicate channel that creates the risk of mismatch (URL says learner, record says co-parent). Looking up role from the record at redemption is the single source of truth.

3. **Backward compatibility is trivial.** Both `/verify?invite=...&role=...` and `/join/:code` route to the same handler, so any old URL in the wild continues to work. The new tool response uses the new form going forward.

4. **The path-shaped URL reads as a destination.** `allowme.dev/join/HERM-LEARN-RH6Z` parses naturally as "visit this URL to join the family." `allowme.dev/verify?invite=...&role=...` parses as "this is a technical endpoint with parameters." That distinction is the whole point of the design pass.

**What this is NOT:** not a short-URL service, not a vanity domain, not a per-kid subdomain. Just a cleaner path structure on the existing domain.

### Decision 2 — Subgoal matcher: conservative confidence threshold

**Decision:** Auto-complete subgoals only on high-confidence matches. Specifically: substring match OR fuzzy match ≥0.85 similarity (using Jaccard or equivalent normalized score). Below that threshold: no auto-completion, parent must mark manually via `configure-policy`.

**Why conservative:**

1. **Asymmetric cost.** A missed match has trivial cost — parent marks subgoal complete manually with one extra `configure-policy` call. A false positive has high cost — the kid sees a subgoal flip to ✓ in their `check-goals` response, gets excited, then sees it flip back to ○ when the parent un-marks it via configure-policy. That whiplash undermines the entire trust premise of the system.

2. **Conservative is forgiving of the matcher's limits.** The current `findMatchingGoalIndex` uses category-name exact match. Extending to subgoal-topic fuzzy match is meaningful but not bulletproof. A conservative threshold means the matcher is allowed to be wrong sometimes — it just stays silent when uncertain rather than acting incorrectly.

3. **Parent override is always available.** Conservative auto-matching plus manual override gives the parent the final say. Aggressive auto-matching with parent override creates a dynamic where the parent is always *reverting* the system's decisions, which feels worse than the parent *making* the decisions.

4. **Pilot data will inform tuning.** The threshold (0.85) is a starting point. After 10-20 real families have used the matcher, the false-positive vs false-negative rate is measurable. Sprint 4.0+ can tune. Don't pre-engineer.

**Implementation:**
- Matcher returns three possible states per subgoal: `match-confident` (auto-complete), `match-ambiguous` (suggest to parent in response copy, do not auto-complete), `no-match` (silent)
- Ambiguous matches surface in the verify-achievement response card: "Possible subgoal match: 'Ancient Greece reading'. Mark it complete? Ask your parent to update via configure-policy."
- Audit entry `subgoal-auto-completed` with `matchConfidence`, `subgoalTopic`, `achievementDescription`, `matchType: "substring" | "fuzzy"`

### Decision 3 — Polish items included, scoped tight

**Decision:** Sprint 3.7 includes the founder bio in `why.md` and the walkthrough GIF placeholder cleanup. Both are <30 min each and round out the design narrative.

**Why included:**

1. **Founder bio closes a real brand-trust gap.** The current `why.md` has mission and pilot stance but no personal context. A parent reading "Built by Juan Isaac, a security researcher and Coinbase Developer Platform Ambassador who teaches AI literacy workshops in NYC, motivated by..." has a meaningfully different impression of the product than one reading anonymous mission copy. Trust signals attach to faces and stories, not just to mission statements.

2. **GIF placeholder cleanup is cheap and removes a visible roughness.** The "Drop walkthroughs/claude.gif here" text from Image 1 is fine as a development affordance but unprofessional for pilot families. Either hide when no GIF exists, or style as a subtle skeleton-state until GIF loads. ~15 min CSS.

3. **Bundling polish with engineering work keeps the sprint mentally cohesive.** A "polish-only" sprint feels low-stakes and can drag. Including polish alongside real engineering keeps the focus tight.

**What polish is NOT:** not a copy rewrite of all four kid-facing tools, not a brand-color refresh, not a logo update. Two specific items only.

## Constraints

### URL design is purely additive

The new `/join/:code` route is added; the old `/verify?invite=...&role=...` route stays working. No URL breaks. The invite-member tool returns the new short URL form going forward, but any tool consumer or hard-coded link with the old form continues to function.

### No schema changes

`src/schemas.ts` is untouched. Subgoal matcher adds one new audit-log action enum value (`subgoal-auto-completed`) — that's a non-breaking enum extension, not a schema change in the breaking sense.

The Sprint 3.6 amended C10 ("schema allows exactly the two audit enum additions") set the precedent for this — Sprint 3.7 adds one more audit action, no other schema changes.

### Test coverage protected

All Sprint 3.6 + closure tests must remain green. Sprint 3.7 adds:
- URL design tests U1-U4 (per test-3.7.md)
- Subgoal matcher tests AM1-AM7
- One snapshot test for the founder bio content
- Total: +12 tests, taking the count from 377+ to 389+

### Forward-compat with Sprint 4.0

URL design and subgoal matcher both survive Sprint 4.0's Coinbase Smart Wallet migration without changes — they're surface-layer work that the architecture migration doesn't touch.

## What this sprint is NOT

To preempt scope creep:

- **Not a URL shortening service.** No `/j/X4Y` micro-paths. The new URL form keeps the full invite code; it just moves from queryparam to path.
- **Not a per-family subdomain rollout.** `aiden.allowme.dev` style URLs were discussed in the design-lead critique but are Sprint 4.0+ infrastructure work.
- **Not a goal-recommendation engine.** Subgoal matcher only matches against subgoals that already exist; it doesn't suggest new ones.
- **Not a multi-language matcher.** English-only subgoal matching; Spanish auto-matching is Sprint 4.0+.
- **Not retroactive subgoal completion.** Matcher applies to new achievements going forward; doesn't backfill against historical achievements.
- **Not parent confirmation flow.** Ambiguous matches surface to the kid as informational text, not as a parent-approval queue. Sprint 3.8+ if pilot data warrants.
- **Not founder-bio video, founder-bio photo, or founder-bio social links.** Just 2-3 sentences of text in `why.md`.
- **Not a redesign of the verify success page.** GIF placeholder is the only change to that surface.

## Open questions before code

Three confirmations:

**Q1: Subgoal matcher fuzzy library — `string-similarity` (3.7KB, mature) or hand-rolled Jaccard (~30 lines, zero dependencies)?**
Recommendation: `string-similarity`. Mature, well-tested, used in production by many. The bundle cost is trivial relative to the maintenance cost of a hand-rolled implementation.

**Q2: Founder bio length — 2 sentences (tight), 3-4 sentences (moderate), or longer (rejected as scope creep)?**
Recommendation: 3-4 sentences. Mission + credentials + motivation. Not a personal essay; a professional bio paragraph.

**Q3: Match confidence threshold of 0.85 — too conservative, just right, or too lenient?**
Recommendation: 0.85 is starting point. Tune in Sprint 4.0 against pilot data. The number itself matters less than the conservative-vs-aggressive philosophy, which is locked.

## Forward compatibility

**Sprint 4.0 Coinbase Smart Wallet migration:** the new URL form is unaffected by the architectural migration. Smart Wallet treasury is a backend change; URL structure is a frontend/routing change. Independent surfaces.

**Sprint 4.0 paymaster:** the subgoal matcher's audit-log entries (`subgoal-auto-completed`) become useful signals for understanding kid engagement patterns at scale. No schema coupling.

**Sprint 4.0 Postgres migration:** subgoal matcher reads from the family config (which is per-family, indexed by familyId — clean Postgres migration shape) and writes to the audit log (already structured for Postgres). No data-shape coupling.

## References

- Sprint 3.0.4 — subgoals + deadline schema (the foundation)
- Sprint 3.0.5 — bootstrap form captures subgoals (so they exist to match against)
- Sprint 3.6 — design-completeness pass (the parent sprint of the polish items here)
- Sprint 3.6 closure — `sprint-3.6-closure.md` (the execution session that should run before this sprint)
- Design-lead critique — 2026-05-18 (URL design and founder bio recommendations)
- `string-similarity` npm package: https://www.npmjs.com/package/string-similarity
- Current `findMatchingGoalIndex` implementation in `src/core/goal-matching.ts` or equivalent (verify path during Step 0)