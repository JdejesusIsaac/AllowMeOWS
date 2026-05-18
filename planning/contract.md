# Sprint 3.6 — Sprint Contract (Phase 1.5, Carry-Over)

**Status:** Phase 1.5 closed, Phase 2 in progress. Mode A pushback applied (P1–P7 + A1+A2 of the 2026-05-18 review). Round-3 amendment (2026-05-18, Step 0 of Phase 2): **C10 relaxed to allow scoped additive enum entries on `AuditEntrySchema.action` only** — see Decision D2 in [`implementation/progress.md`](../implementation/progress.md). P8 (rubric-convention divergence from `planning/AGENTS.md`) acknowledged and intentionally deferred — Sprint 3.6 is a completion sprint with no novel architecture warranting an Originality category.
**Inputs:** [`research/research.md`](../research/research.md), [`planning/plan.md`](plan.md), [`evaluation/test.md`](../evaluation/test.md) (test specs referenced by the verification-ownership table).
**Sprint type:** UX completeness pass — additive only. No schema changes, no new core services.
**Sprint class:** Design / UX with one security-adjacent component (`resend-invite` rotation) — rubric splits Auth into "RBAC + audit log integrity" at 15% to surface that hybrid weight.

---

## Success criteria

1. **Install walkthrough renders on verify success state.** All three tabs (Claude, ChatGPT, Other) visible and tappable. Each includes either an animated GIF/video or numbered illustrated steps. Mobile responsiveness confirmed on iOS Safari + Android Chrome.
2. **QR code present in `invite-member` response** as either an inline base64 PNG (preferred) or a hosted-PNG URL (fallback if Claude's renderer doesn't display base64 reliably). Scanning the QR with iPhone camera opens the verify URL in Safari without manual URL entry.
3. **Rich response cards render correctly with category-appropriate visual elements.** Each of the four kid-facing tools returns a `summary` markdown card containing the visual elements specific to that tool's data shape:
   - `check-progress`: progress bar (`▓░` Unicode), dollar amount, streak/emoji indicator (`🔥`/`⏳`), next-action callout (`👉`).
   - `check-savings`: locked-vs-released breakdown OR — for new learners with zero savings — friendly empty-state markdown that names the child and avoids raw `$0.00` framing.
   - `check-goals`: goal status indicators (`✓`/`○`/`⏳`) with subgoal nesting where applicable (completed subgoals shown with `✓`).
   - `verify-achievement`: "what changed" delta card with earned delta (`+$X.XX`), streak update, and category completion indicator.
   Cards render in both Claude mobile and ChatGPT mobile (user-attested per V3, V4).
3a. **Structured response fields preserved across all four kid-facing tools.** `check-progress` retains `earned`/`streak`/`categories`/`goals`. `check-savings` retains `lockedAmount`/`releasedAmount`/`multiplier`. `check-goals` retains the `goals[]` array. `verify-achievement` retains `delta`/`newStreak`/`newEarned`. The rich `summary` markdown is additive — it never replaces structured data for downstream tool consumers.
4. **`resend-invite` works end-to-end.** Manager calls it for a child with an existing unredeemed invite; old invite is revoked; new invite issued; audit log shows both events; verify URL with the new code redeems correctly.
5. **`test-connection` returns expected health-check fields.** Caller name, role, family name, family ID, last action timestamp, no errors thrown when reading caller's state.
6. **`view-my-link` returns the caller's existing magic-link URL.** Audit entry `magic-link-viewed` recorded with `actor = caller`. Audit metadata MUST NOT contain the setup code itself (the `SETUP-XXXX` value appears in the response only, never in the persisted audit log). No other member's link leaked.
7. **Brand modals render on verify success page.** "How AllowMe protects your kid's money" and "Why we built this" both open as modals (not new tabs), display markdown-rendered content correctly, dismissible.
8. **Client detection selects appropriate default tab.** iOS Safari opens Claude tab by default. Android Chrome opens Claude tab. Desktop opens Claude tab. ChatGPT WebView surfaces a "you're already in ChatGPT" inline note.
9. **Existing test baseline preserved.** All 416 passing + 1 skipped tests (post-Sprint 3.0.6 baseline, verified via `npx vitest run` on the merge-base) remain green. Target final count: **431 passing + 1 skipped** (416 + 15 new: QR1, RC1-8, CARD1-4, MODAL1, UA1). Snapshot tests updated where the rich-card refactor changes response copy.
10. **No schema changes shipped beyond additive audit-action enum entries.** The only permitted `src/schemas.ts` edit is appending the two new string literals `"invite-revoked"` (C4) and `"magic-link-viewed"` (C6) to the `AuditEntrySchema.action` `z.enum([...])` array. All other schemas — `FamilyConfigSchema`, `ChildConfigSchema`, `MemberSchema`, `InviteSchema`, `AchievementRecordSchema`, `SavingsEntrySchema`, `PolicyConfigSchema`, the audit `details`/`actor`/`txHash`/`amount` shape — are untouched. `InviteSchema.revoked` is NOT added; revocation = remove from the active invites array. Sprint 3.6 is otherwise purely additive at every layer except response formatting. Matches the precedent of every prior sprint that introduced audit-bearing actions (Sprint 3.0 v4 added 5; Sprint 3.0.2 added 4).
11. **`resend-invite` does NOT inadvertently allow non-Manager roles to revoke invites.** RBAC enforced and tested.
12. **Mobile smoke on real iOS device:** install walkthrough video plays, QR code scan works, rich cards render readably on 380px viewport.

---

## Verification ownership

Mode B evaluator reads `planning/contract.md` + deployed build only. The following table maps each criterion to what the evaluator verifies vs what the user attests after merge — closing the auto-vs-manual gap that would otherwise force Mode B to either over-Pass or over-Fail on manual checks.

| Criterion | Evaluator (Mode B) verifies | User attests after merge |
|---|---|---|
| C1 | Tab component + each platform panel (Claude/ChatGPT/Other) present in `public/verify.html` (DOM grep) | iOS Safari + Android Chrome physical render of GIFs/videos, accordion collapse on 380px |
| C2 | `QR1` passes; `inviteQrCode` field present in `invite-member` response | Real-device camera scan opens verify URL in Safari/Chrome |
| C3 | Per-tool elements asserted: `CARD1` (`▓░` + emoji + `$`), `CARD2` (empty-state friendly markdown — names child, no raw `$0.00`), `CARD3` (`✓`/`○`/`⏳` + subgoal nesting), `CARD4` (`+$X.XX` delta + streak + category indicator) | Claude mobile + ChatGPT mobile rendered output |
| C3a | `CARD1`–`CARD4` assert structured fields survive alongside `summary` | — |
| C4 | `RC1` (revoke + reissue + dual audit entries) | — |
| C5 | `RC4`, `RC5` | — |
| C6 | `RC6`, `RC7` (audit-no-leak), `RC8` (cross-member isolation) | — |
| C7 | `MODAL1` (content + forbidden phrases) + DOM grep for modal trigger links in `public/verify.html` | Modal open/dismiss UX on real device |
| C8 | UA-detection JS block present in `public/verify.html` **AND** `UA1` unit test exercising the parser function across the 4 cases (iOS, Android, desktop, in-app WebView) — minimum 4 assertions, one per detection case | Physical-device default-tab confirmation per V7 |
| C9 | `npx vitest run` exit code 0, count = 431 passing + 1 skipped; `npx tsc --noEmit` clean | — |
| C10 | `git diff src/schemas.ts` adds EXACTLY two new enum string literals — `"invite-revoked"` and `"magic-link-viewed"` — to `AuditEntrySchema.action`'s `z.enum([...])`, plus up to 3 explanatory comment lines next to them (mirroring the file's own per-sprint comment convention). Zero edits elsewhere in the file (verified: `git diff --numstat src/schemas.ts` shows `5 0` with all 5 insertions inside the audit-action enum block) | — |
| C11 | `RC2` (non-Manager denied) | — |
| C12 | — | Full V1–V7 mobile smoke per [`evaluation/test.md`](../evaluation/test.md) |

**Pass requires:** every evaluator-verified criterion green AND user attests C1, C2-scan, C3-cross-client, C7-dismiss, C8-defaults, C12-full-smoke before merge. The user-attestation gate is the merge gate, not a Mode B Pass blocker — Mode B reports Pass-pending-attestation when its half is clean.

---

## Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| UX completeness | 35% | The point of the sprint — install walkthrough quality, QR code utility, card readability are the central deliverables |
| Engineering correctness | 25% | New tools (resend, test, view) work without bugs; existing tools' rich-card formatting doesn't regress structured data fields |
| Mobile usability | 15% | Per the kid-focused user population, mobile-first is non-negotiable |
| RBAC + audit log integrity | 15% | `resend-invite` revoke-then-reissue is the security-sensitive operation; must enforce Manager-only AND audit correctly |
| Brand-narrative quality | 10% | The two modals are the trust artifact at the moment of bootstrap — copy must read as honest and contextual, not as marketing |

### Per-category scoring guidance (Mode B anchor)

Without these, the "no category below 75%" Pass threshold below is unenforceable — Mode B would collapse to evaluator judgment. Each category anchors to concrete, observable outcomes.

**UX completeness (35%)**
- **100%:** All 6 deliverables visibly shipped — walkthroughs play, QR scannable, cards readable, modals open, client detection works.
- **75%:** 5 of 6 deliverables ship cleanly; one has a documented fallback (e.g., GIF → static screenshots, base64 → hosted PNG).
- **<75%:** A deliverable is missing or unusably broken on the primary surface.

**Engineering correctness (25%)**
- **100%:** 431 passing + 1 skipped, `npx tsc --noEmit` clean, no new warnings in new code, structured response fields preserved (C3a).
- **75%:** 426+ passing, tsc clean, ≤1 documented flaky test.
- **<75%:** Test regression vs the 416 baseline OR tsc errors OR a new tool throws on a covered input OR a structured response field disappears.

**Mobile usability (15%)**
- **100%:** All 6 deliverables render on 380px without horizontal scroll; manual V1–V7 pass on real iOS.
- **75%:** 5 of 6 render cleanly; documented mobile-specific fallback for the sixth.
- **<75%:** A deliverable is unusable on 380px viewport.

**RBAC + audit log integrity (15%)**
- **100%:** RC2, RC7, RC8 all green; `resend-invite` Manager-only enforced; audit entries match schema for both `invite-revoked` and `invite-issued`; no `SETUP-` codes in audit metadata.
- **75%:** All passing but with one documented edge case (e.g., race-condition note for concurrent resend).
- **<75%:** ANY of: non-Manager can invoke `resend-invite`, audit log misses an entry, audit metadata leaks a `SETUP-` code.

**Brand-narrative quality (10%)**
- **100%:** MODAL1 green; both modals open and dismiss; copy passes the 3 load-bearing-phrases assertion AND the 2 forbidden-phrases assertion (`non-custodial`, `trustless`).
- **75%:** Content passes but copy is rough — Sprint 3.7 polish acceptable.
- **<75%:** Overclaim found OR Sprint 4.0 path not named.

---

## Grading thresholds

- **Pass:** All 13 success criteria (1–12 plus 3a) verified per the Verification ownership table. No rubric category below 75% per the Per-category scoring guidance. Mobile smoke passes on real device (user-attested C12).
- **Fail:** Any of (1)–(12) or 3a fails. OR snapshot tests broken by the rich-card refactor and not updated. OR `resend-invite` allows non-Manager invocation. OR audit metadata contains a `SETUP-` code (C6 leak guardrail). OR brand-narrative copy makes overclaims about the current architecture (e.g., calls it "non-custodial" today).

---

## Success conditions beyond the rubric

- A pilot family completing the full flow (bootstrap → invite kid → kid scans QR → kid taps verify URL → kid completes redemption via install walkthrough → kid asks "what are my goals?" and sees a markdown card) does it in under 10 minutes total, without external help.
- The kid feels something visibly different after Sprint 3.6 lands. Whether they articulate it or not, the rich response cards should feel meaningfully more like a "real product" than the prior plain-text responses.
- A reader of the brand-narrative modals walks away with two accurate beliefs: (1) AllowMe's current security model is encrypted-vault-with-allowlist-and-audit, (2) Sprint 4.0 will migrate to non-custodial Coinbase Smart Wallets owned by the parent.

---

## Phase 1.5 pending items

- [x] `@evaluator` Mode A review (2026-05-18) — 8 issues surfaced (P1–P8). Critical: stale 363 baseline (P1), unverifiable manual criteria (P2), unenforceable 75% threshold (P3), missing criterion↔test mapping (P4). Important: missing structured-fields-preserved criterion (P5), missing audit-metadata-no-leak clause (P6), C2 vs hosted-PNG fallback (P7). Nit: rubric-convention divergence (P8).
- [x] Planner iteration on P1–P7 applied 2026-05-18:
  - P1 → C9 updated to 416 baseline / 430 target.
  - P2 → Verification ownership table added between criteria and rubric.
  - P3 → Per-category scoring guidance added under Dynamic Rubric.
  - P4 → resolved by P2's table (each criterion now references its evaluating test IDs).
  - P5 → C3a inserted (structured response fields preserved).
  - P6 → C6 extended with no-`SETUP-`-in-audit-metadata clause.
  - P7 → C2 broadened to accept inline base64 OR hosted-URL fallback.
- [ ] `@evaluator` re-review for sign-off (expected: 5-minute pass).
- [ ] User confirmation of final contract before Phase 2 implementation begins.
