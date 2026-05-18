# Sprint 3.6 — Design Completeness

## What this sprint ships

Six design-completeness deliverables that close the gap between the engineering foundation and the user experience, raising the design rating from 5-6 to 8+ per the 2026-05-18 design-lead critique:

1. Connector-install walkthrough on verify success page (per-platform)
2. QR code on parent-side invite response
3. Rich markdown response cards for the four kid-facing tools
4. In-flow failure-recovery tools (`resend-invite`, `test-connection`, `view-my-link`)
5. Brand and security narrative modals on bootstrap success
6. Pre-flight client detection on verify page

No schema changes. No new architecture. The full sprint is additive UI + tools + copy + content.

## Why this cut is right

Three alternatives were considered and rejected:

**Skip Sprint 3.6 and jump to Sprint 4.0 (Coinbase Smart Wallet).** Rejected because: (1) Sprint 4.0 is architecturally meaningful but doesn't help pilot families who can't get past the connector-install step today, (2) shipping 4.0 onto a product with poor design completeness amplifies the underlying UX gaps rather than fixing them, (3) the docs work that follows Sprint 3.6 becomes honest only after 3.6 ships — without it, the docs would be aspirational marketing.

**Combine Sprint 3.6 with the URL design pass.** Rejected because: (1) URL design touches route handlers, audit log entries, and test fixtures across multiple sprints; that's a wider surface than the six 3.6 deliverables, (2) the QR code in Deliverable 2 mostly solves the same problem (URL-paste confusion) more cheaply, (3) defer the URL pass to Sprint 3.7 as its own focused work.

**Ship the six deliverables as separate micro-sprints.** Rejected because: (1) they interlock — the brand modal copy depends on the install walkthrough being present, the rich response cards depend on the failure-recovery tools existing for the "your connector seems healthy" affordance, (2) shipping them as a cohesive design pass lets the team write a single "design completeness" milestone marker for the changelog and pitch deck, (3) sprint accounting overhead is minimized.

The chosen cut — six interlinked deliverables shipped as one Sprint 3.6 — is the minimum that delivers a meaningful design completeness milestone before Sprint 4.0 architectural work begins.

## Feature summary

Sprint 3.6 ships:

- **Verify-page install walkthrough** for Claude (desktop + mobile), ChatGPT, and Cursor/other. Each guide is tab-accessible from the success state, includes a ~30-second animated GIF or embedded video, and degrades gracefully to text-only on slow connections.
- **QR code in `invite-member` response** as a base64-encoded PNG. Parent's screen shows the QR; kid scans with phone camera; iOS/Android opens the verify URL in Safari/Chrome natively.
- **Markdown response cards** for `check-progress`, `check-savings`, `check-goals`, `verify-achievement`. Unicode block elements for progress bars, emoji for status indicators, structured next-action callouts.
- **Three new tools:** `resend-invite` (Manager-only, revokes + reissues), `test-connection` (all roles, returns identity + family + last-action), `view-my-link` (all roles, returns the caller's existing setup-coded URL).
- **Two brand-narrative modals** on verify-page success: "How AllowMe protects your kid's money" and "Why we built this." Markdown-rendered at build time. Cross-references Sprint 3.0.2 allowlist, Sprint 4.0 roadmap to non-custodial.
- **Pre-flight client detection** on verify page that selects the default install walkthrough based on user agent. All platforms still accessible via tabs.

The diff touches `public/verify.html` (UI), `src/tools/invite-member.ts` (QR code), `src/tools/check-*.ts` and `verify-achievement.ts` (response formatting), three new files under `src/tools/` (the failure-recovery tools), `src/constants.ts` (RBAC for new tools), plus snapshot test extensions and integration test additions.

---

## Implementation steps

### Workstream W1: Connector-install walkthrough (3 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W1.1 | Record three screen-capture walkthroughs (Claude mobile iOS, ChatGPT mobile iOS, Cursor desktop) — 20-30 seconds each, no audio, exported as animated GIF | Medium | 60m |
| W1.2 | Add tab-component CSS + JS to verify success state, supporting 3 tabs: Claude, ChatGPT, Other | Medium | 45m |
| W1.3 | For each tab, render numbered step list + embedded GIF/MP4 + "having trouble?" link to help@allowme.dev | Medium | 45m |
| W1.4 | Mobile responsiveness pass — tabs collapse to accordion on narrow viewports | Low | 15m |
| W1.5 | Manual test on iOS Safari, Android Chrome, desktop Safari, desktop Chrome | Low | 15m |

### Workstream W2: QR code in invite response (1 hour)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W2.1 | Add `qrcode` npm dependency, import in `invite-member.ts` | Low | 5m |
| W2.2 | Generate QR code PNG from verify URL, base64-encode, include in response JSON as `inviteQrCode` field | Medium | 20m |
| W2.3 | Update response message template to reference the QR code: "Scan this QR with their phone camera, or send the link below" | Low | 10m |
| W2.4 | Verify Claude's response renderer displays the inline base64 image correctly | Low | 10m |
| W2.5 | Add snapshot test asserting `inviteQrCode` field present and valid base64 PNG header | Low | 15m |

### Workstream W3: Rich response cards (3 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W3.1 | Define Unicode/emoji/markdown vocabulary for cards: progress bars (`[▓▓▓░░░░]`), dollar bars, goal indicators (✓/❌/⏳), next-action callouts (👉) | Low | 20m |
| W3.2 | Refactor `check-progress` response to render card format, preserving structured data fields for tool consumers | Medium | 45m |
| W3.3 | Refactor `check-savings` response card format | Medium | 30m |
| W3.4 | Refactor `check-goals` response card format with subgoal nesting | Medium | 45m |
| W3.5 | Refactor `verify-achievement` response to include a "what changed" mini-card showing the streak update + earnings delta | Medium | 30m |
| W3.6 | Snapshot tests for the new response formats — assert each card includes the required visual elements | Low | 30m |

### Workstream W4: Failure-recovery tools (2.5 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W4.1 | Create `src/tools/resend-invite.ts`: Manager-only. Revokes any active invite for the named child, calls existing `invite-member` core logic to issue a fresh one. Audit log entries: `invite-revoked`, `invite-issued` | High | 45m |
| W4.2 | Create `src/tools/test-connection.ts`: all roles. Returns `{success, callerName, role, familyName, familyId, lastActionAt, healthCheck}`. Health-check is "we read your member record + family config without error." | Medium | 30m |
| W4.3 | Create `src/tools/view-my-link.ts`: all roles. Returns the caller's existing magic-link URL by reading their setup code from `data/families/{id}/.ows/setup-codes.json`. Audit entry: `magic-link-viewed` | Medium | 30m |
| W4.4 | Register all three tools in MCP server registration paths (stdio + HTTP transports) | Low | 15m |
| W4.5 | RBAC entries in `src/constants.ts`: `resend-invite` → Manager only; `test-connection` → all roles; `view-my-link` → all roles | Low | 10m |
| W4.6 | Integration tests RC1-RC8 (per test-3.6.md) | Medium | 40m |

### Workstream W5: Brand and security modals (1.5 hours)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W5.1 | Draft markdown content for `public/copy/security.md` — current encrypted-vault model, on-chain allowlist enforcement, RBAC walls, audit log, honest about Sprint 4.0 migration to non-custodial | Medium | 30m |
| W5.2 | Draft markdown content for `public/copy/why.md` — financial literacy mission, charter school context, agent-native thesis, founder background (brief, professional) | Medium | 30m |
| W5.3 | Add modal component to verify-page success state with two trigger links | Low | 20m |
| W5.4 | Markdown-to-HTML rendering at build time (or runtime, if no build step in Sprint 3.0 v4 single-file architecture — load .md files via fetch, render with a tiny markdown library like `marked.min.js` from CDN) | Medium | 20m |

### Workstream W6: Pre-flight client detection (45 min)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W6.1 | User-agent parser: detect iOS, Android, desktop, in-app browser (Claude WebView, ChatGPT WebView). Set as initial tab on Deliverable 1's tab-component | Medium | 30m |
| W6.2 | Manual test: confirm iOS Safari defaults to Claude tab, Android Chrome defaults to Claude tab, desktop defaults to Claude tab, ChatGPT WebView shows "you're already in ChatGPT" inline message | Low | 15m |

### Workstream W7: Documentation + smoke (45 min)

| Step | Task | Complexity | Est. |
|------|------|-----------|------|
| W7.1 | README.md — add Sprint 3.6 to roadmap with the six deliverables listed | Low | 15m |
| W7.2 | Railway production smoke (per progress-3.6.md V1-V6) | Medium | 30m |

---

## Time allocation

| Phase | Hours | Cumulative |
|-------|-------|-----------|
| W1 — Install walkthrough | 3.0 | 3.0 |
| W2 — QR code | 1.0 | 4.0 |
| W3 — Rich response cards | 3.0 | 7.0 |
| W4 — Failure-recovery tools | 2.5 | 9.5 |
| W5 — Brand modals | 1.5 | 11.0 |
| W6 — Client detection | 0.75 | 11.75 |
| W7 — Docs + smoke | 0.75 | 12.5 |

**Total: ~12.5 hours.** Two focused days, or three less-focused sessions of 4-4.5 hours each. The recording session in W1.1 is the time-bomb — if recording quality requires more passes than estimated, that workstream can grow. Static illustrated screenshots are the fallback (saves 30-40 min in W1.1, adds ~15 min in W1.3 to make screenshots more elaborate).

## Dependencies and risks

| Dependency | Risk | Mitigation |
|-----------|------|------------|
| Sprint 3.0.6 (invite-member copy fix) shipped | High if not shipped | 3.0.6 is a 1-hour copy fix; should land before 3.6 starts. If it slips, Sprint 3.6 includes a 15-min copy-merge step. |
| `qrcode` npm package compatibility with the existing Node/TypeScript setup | Low | Mature package, no native deps. Quick npm install + import to verify in W2.1. |
| Claude/ChatGPT renderer supports inline base64 images in tool responses | Medium | Verify in W2.4 manual test. Fallback: surface the QR as a separate "qrCodeUrl" field hosted on `allowme.dev/qr/{inviteCode}.png` (server-generated) if inline base64 doesn't render reliably. |
| Markdown rendering library acceptable for the brand modals | Low | `marked.min.js` is well-supported, ~20KB. If too heavy, hand-write a minimal markdown subset (heading, paragraph, link, list) in ~50 lines of JS. |
| Recording infrastructure on macOS | Low | Built-in Cmd+Shift+5 records to .mov, ffmpeg or built-in conversion to GIF works. |
| Existing test suite stays green | Medium | All deliverables are additive; no schema changes. Snapshot tests on response copy may need updating if the rich-card format breaks prior fixtures. |
| Rich response cards too text-dense for narrow chat viewports | Medium | Manual smoke test in mobile Claude + mobile ChatGPT. If too dense, tighten the card vocabulary (shorter bars, single-line goal indicators). |
| `resend-invite` security: rotation surface complicates audit | Low | Document the audit-trail expectation (revocation + new issuance both recorded). No security regression because the operation requires Manager auth. |

## Fallback approaches

- **W1 recording quality unacceptable:** swap to illustrated step sequence with static screenshots. Lose some clarity, gain reliability. Sprint 3.7 can upgrade to video.
- **W2 inline base64 image doesn't render:** serve QR as a hosted PNG at `/qr/{inviteCode}.png`, return URL in response. Server-side cache for ~1 hour.
- **W3 markdown card vocabulary too sparse:** add a second-pass design iteration using more aggressive emoji + structured layout. Don't over-design.
- **W4 `view-my-link` reads from .ows/setup-codes.json which is encrypted:** decryption happens at request time via the existing per-family key chain. If this proves brittle, defer `view-my-link` to Sprint 3.7 and keep `resend-invite` + `test-connection` for Sprint 3.6.
- **W5 markdown rendering library unavailable in single-file context:** pre-render the two .md files to HTML at build time, ship as static HTML strings. Trade flexibility for simplicity.
- **W6 client detection fragile across browsers:** keep all tabs visible by default, treat detection as cosmetic-only. Already the design intent.

---

## Sprint Contract — Sprint 3.6

### Success criteria

1. **Install walkthrough renders on verify success state.** All three tabs (Claude, ChatGPT, Other) visible and tappable. Each includes either an animated GIF/video or numbered illustrated steps. Mobile responsiveness confirmed on iOS Safari + Android Chrome.
2. **QR code present in `invite-member` response.** Manager's Claude session displays the QR inline. Scanning the QR with iPhone camera opens the verify URL in Safari without manual URL entry.
3. **Rich response cards render correctly.** Each of the four kid-facing tools returns a card with at least one progress bar (streak or budget), at least one status indicator, at least one next-action callout. Cards render in both Claude and ChatGPT mobile.
4. **`resend-invite` works end-to-end.** Manager calls it for a child with an existing unredeemed invite; old invite is revoked; new invite issued; audit log shows both events; verify URL with the new code redeems correctly.
5. **`test-connection` returns expected health-check fields.** Caller name, role, family name, family ID, last action timestamp, no errors thrown when reading caller's state.
6. **`view-my-link` returns the caller's existing magic-link URL.** Audit entry `magic-link-viewed` recorded. No other member's link leaked.
7. **Brand modals render on verify success page.** "How AllowMe protects your kid's money" and "Why we built this" both open as modals (not new tabs), display markdown-rendered content correctly, dismissible.
8. **Client detection selects appropriate default tab.** iOS Safari opens Claude tab by default. Android Chrome opens Claude tab. Desktop opens Claude tab. ChatGPT WebView surfaces a "you're already in ChatGPT" inline note.
9. **All 363+ existing tests still pass.** Snapshot tests updated where necessary to reflect the rich-card format.
10. **No schema changes shipped.** `src/schemas.ts` is untouched. Sprint 3.6 is purely additive at every layer except response formatting.
11. **`resend-invite` does NOT inadvertently allow non-Manager roles to revoke invites.** RBAC enforced and tested.
12. **Mobile smoke on real iOS device:** install walkthrough video plays, QR code scan works, rich cards render readably on 380px viewport.

### Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| UX completeness | 35% | The point of the sprint — install walkthrough quality, QR code utility, card readability are the central deliverables |
| Engineering correctness | 25% | New tools (resend, test, view) work without bugs; existing tools' rich-card formatting doesn't regress structured data fields |
| Mobile usability | 15% | Per the kid-focused user population, mobile-first is non-negotiable |
| RBAC + audit log integrity | 15% | `resend-invite` revoke-then-reissue is the security-sensitive operation; must enforce Manager-only AND audit correctly |
| Brand-narrative quality | 10% | The two modals are the trust artifact at the moment of bootstrap — copy must read as honest and contextual, not as marketing |

### Grading thresholds

- **Pass:** All success criteria 1–12 verified. No category below 75%. Mobile smoke passes on real device.
- **Fail:** Any of (1)–(12) fails. OR snapshot tests broken by the rich-card refactor and not updated. OR `resend-invite` allows non-Manager invocation. OR brand-narrative copy makes overclaims about the current architecture (e.g., calls it "non-custodial" today).

### Success conditions beyond the rubric

- A pilot family completing the full flow (bootstrap → invite kid → kid scans QR → kid taps verify URL → kid completes redemption via install walkthrough → kid asks "what are my goals?" and sees a markdown card) does it in under 10 minutes total, without external help.
- The kid feels something visibly different after Sprint 3.6 lands. Whether they articulate it or not, the rich response cards should feel meaningfully more like a "real product" than the prior plain-text responses.
- A reader of the brand-narrative modals walks away with two accurate beliefs: (1) AllowMe's current security model is encrypted-vault-with-allowlist-and-audit, (2) Sprint 4.0 will migrate to non-custodial Coinbase Smart Wallets owned by the parent.

---

## Scope guard — explicitly NOT in Sprint 3.6

1. URL design pass (Sprint 3.7)
2. Spanish-language verify page or tool responses
3. Dedicated web dashboard for the kid (Sprint 4.0+)
4. Embedded image-based charts in tool responses (Sprint 4.0+)
5. Audio walkthroughs or screen reader testing
6. Coinbase Smart Wallet treasury migration (Sprint 4.0)
7. Paymaster sponsorship (Sprint 4.0)
8. Postgres migration (Sprint 4.0)
9. Push notifications (Sprint 4.0)
10. Goal templates / suggested goals library
11. Subgoal mastery auto-tracking on `verify-achievement` (Sprint 3.7 / 4.0)
12. Multi-language brand copy
13. SMS or email delivery FROM the product (Manager's AI client still does this)
14. Co-parent multi-signer at bootstrap
15. New audit-log action enum values beyond what the three new tools need
16. Anything that requires a schema change

## Sequencing within Sprint 3.x

1. ✅ Sprint 3.0.1 — `learningGoals` schema
2. ✅ Sprint 3.0 v4 — Sign-in-with-Base + verify-page
3. ✅ Sprint 3.0.2 — destination allowlist
4. ✅ Sprint 3.0.3 — kid-facing copy, `check-goals` tool
5. ✅ Sprint 3.0.4 — subgoals + deadline schema
6. Sprint 3.0.5 — bootstrap form extension *(in flight)*
7. Sprint 3.0.6 — invite-member copy fix *(1-hour follow-up)*
8. **→ Sprint 3.6 — Design completeness (this sprint)**
9. Sprint 3.7 — URL design pass, subgoal auto-matching, OWS executable wiring stretch from 3.0.2
10. Sprint 4.0 — Smart Wallet treasury, paymaster, Postgres

Sprint 3.6 unblocks:
- Honest pilot family deployment
- Landing page docs that match what the product actually delivers
- Charter-school admin pitch with real screenshots
- The "kids love it" narrative becomes defensible after a real kid uses the rich-card response surfaces

## How to use this plan

Order of execution within the sprint:

1. **Pre-sprint validation** (15 min) — confirm 3.0.6 shipped, baseline tests green
2. **W2.5 first** (15 min) — snapshot test asserting QR code field is present in invite-member response. Establishes the contract before implementation.
3. **W4.1 + W4.5 + tests** (90 min) — ship `resend-invite` first; it's the highest-leverage failure-recovery tool and uses the most code paths
4. **W2.1-2.4** (45 min) — QR code in invite-member response
5. **W4.2 + W4.3 + tests** (60 min) — `test-connection` and `view-my-link`
6. **W3.1-3.6** (3 hr) — rich response cards (the biggest single chunk)
7. **W1.1-1.5** (3 hr) — install walkthrough on verify page
8. **W5.1-5.4** (90 min) — brand modals
9. **W6.1-6.2** (45 min) — client detection
10. **W7.1-7.2** (45 min) — README + smoke

Total: ~12.5 hours over 2-3 sessions. The W3 rich-card work is the highest-leverage UX shift and should not be skipped or rushed. The W1 install walkthrough is the second-highest-leverage and should be polished even if it means cutting Deliverable 6 (client detection) to compensate.

## Pre-sprint checklist

- [ ] Sprint 3.0.6 shipped to production (invite-member copy includes load-bearing warnings)
- [ ] Sprint 3.0.5 shipped to production (bootstrap form captures goals + kid wallets)
- [ ] All 363+ tests passing on main
- [ ] Backup of production `data/` taken
- [ ] Real iOS device + Coinbase Wallet ready for mobile smoke
- [ ] Real Android device available for cross-device QR scan test (any Android with a camera app)
- [ ] Confirm `marked.min.js` or equivalent markdown library available via CDN
- [ ] Q1 confirmed: animated GIF vs static screenshots vs MP4 for walkthroughs
- [ ] Q2 confirmed: markdown files (`public/copy/*.md`) or inline strings for brand modals
- [ ] Test wallet with Base Sepolia ETH + USDC for any end-to-end distribution smoke tests