# Sprint 3.6 — Research: Design Completeness

## Problem

AllowMe's engineering foundation is unusually strong for a solo-built product at this stage. The architecture is right, the test coverage is honest, the security model holds, the agent-native thesis is intact. But the design completeness — the polish, the failure-recovery surfaces, the kid-side experience, the trust narrative, the install UX — is meaningfully behind the engineering. A Claude design-lead critique would rate the product 5-6 out of 10 today, with most of the gap concentrated in moments after the verify-page success state (where the parent or kid has to install the connector in their AI client) and moments outside the happy path (failure recovery, brand context, kid-visible state).

Sprint 3.6 closes the design-completeness gap as a focused two-day pass. After it ships, the product is honestly demoable to pilot families and the docs work becomes accurate rather than aspirational.

## Why now (and what this is NOT)

Three things this sprint is NOT, to set scope expectations:

**Not an architectural overhaul.** Sprint 4.0 (Coinbase Smart Wallet treasury, paymaster, Postgres) is the next architectural sprint. Sprint 3.6 deliberately uses what already works. No new schemas, no new core services, no migration paths.

**Not a brand redesign.** AllowMe's name, logo, color palette, typography are unchanged. The work is functional design completeness within the existing brand language.

**Not a marketing site.** The landing-page docs from the docs-sequencing turn remain a separate workstream that follows Sprint 3.6. Sprint 3.6 makes the in-product experience honest enough that the docs can describe it accurately.

What this sprint IS: six concrete deliverables, each addressing a specific gap surfaced by the design-lead critique, scoped to ship in ~2 focused days.

## The six deliverables, locked

### Deliverable 1 — Connector-install walkthrough on verify success page

Three platform-specific install guides, each accessible as a tab or accordion on the verify success state (current "You're in" / "Family created" panels):

- **Claude (desktop + mobile)** — 4 tap sequence with screenshots, "Open in Claude" deep-link as primary affordance
- **ChatGPT** — copy-paste path with explicit "Settings → Connectors → Add custom connector" walkthrough
- **Other (Cursor, Windsurf, generic MCP client)** — copy-paste with the MCP URL format documented

Each guide includes either a short screen recording (~20-30 seconds, no audio) embedded as `<video>` or animated GIF, or a numbered illustrated step sequence with static screenshots. The critique was emphatic that this is the single biggest UX win available — the moment AllowMe hands the user a URL and says "install this" is the failure point for laymen, and the walkthrough turns that moment from a leap-of-faith into a guided tap sequence.

**Locked decision:** ship screen recordings, not just screenshots, because video preserves the spatial-and-temporal context that static images lose. Recording quality and length are guardrailed: 30 seconds max per clip, MP4 H.264, no audio, captioned where text matters. If recording infrastructure is too heavy to set up in this sprint, fall back to animated GIF — same content, larger file size, acceptable trade.

### Deliverable 2 — QR code on the parent-side invite response

When the `invite-member` tool returns the magic invite URL, also return a QR code rendering of that URL. The QR code is unambiguously a "scan with your phone" object, which removes the URL-paste-confusion problem entirely for the parent → kid handoff.

**Implementation shape:** the tool response includes a base64-encoded PNG of the QR code in the JSON payload. Claude's response rendering displays it inline. The parent's screen shows a QR code; the kid points their phone camera at it; iOS or Android camera app recognizes the QR and offers to open the URL in Safari/Chrome. Zero URL pasting required.

**Locked decision:** generate the QR code server-side, not client-side. Server-side keeps the tool response self-contained and avoids relying on Claude's renderer to do anything special with the URL. Uses the `qrcode` npm package (~80KB, mature, no native deps). For the response, embed as `data:image/png;base64,...` so Claude's image-rendering naturally displays it.

### Deliverable 3 — Rich response cards for kid-facing tools

Rewrite the response formats for `check-progress`, `check-savings`, `check-goals`, and `verify-achievement` to use markdown-rendered cards with visible visual elements:

- Streak bars (text-based progress: `[▓▓▓░░░░] 3/7 days`)
- Dollar progress bars (`[$0.45 / $5.00 ▓▓░░░░░░░░]`)
- Goal completion indicators (`✓ Reading: Read 10 books — 7/10`)
- Next-action callouts (`👉 Log something today to keep your streak`)

**Why this matters:** the kid's only surface is the AI-chat-interface, and right now it returns plain text paragraphs. A markdown-rendered card with visible progress feels meaningfully more like *theirs* — a thing they earned and can look at — than a paragraph of text. Same data, dramatically different felt experience.

**Locked decision:** use markdown-renderable text characters (Unicode block elements `▓░`, emoji, simple ASCII bars) rather than embedded images. Reasons: (1) consistent rendering across Claude, ChatGPT, Cursor, and any other MCP client; (2) no image storage or CDN concerns; (3) the constraint forces tighter information density which serves the kid UX better than rich graphics would. The trade-off — less visual richness than a real dashboard — is acceptable for Sprint 3.6 and revisitable in Sprint 4.0+ if a dedicated kid surface ships.

### Deliverable 4 — In-flow failure recovery tools

Three new MCP tools, each addressing a specific failure mode the current product handles poorly:

- **`resend-invite`** — Manager-only. Revokes the current invite for a child (if not yet redeemed) and issues a fresh one with the same role and child binding. Solves "the kid lost the SMS."
- **`test-connection`** — All roles. Returns a structured health-check response: caller identity, role, family name, last-action timestamp, whether the connector is talking to the right family. Solves "is my connector actually working?"
- **`view-my-link`** — All roles. Returns the caller's own magic-link URL. Useful when a kid loses their connector URL and needs to reinstall in a different AI client. **Important security note:** this only returns the caller's OWN link, not other members' links, and the link is the same setup-coded URL they already have — the tool doesn't issue a new link, it just surfaces the existing one.

**Locked decision:** `view-my-link` returns the existing link rather than minting a new one. Reasoning: minting a new link would create a rotation surface that complicates the audit log and the family-key model. Returning the existing link is read-only, which keeps the security model unchanged. If a user has genuinely lost access (browser cache cleared, no record of the URL anywhere), they go through `resend-invite` via the Manager, which IS a rotation but goes through the Manager-authorized path.

### Deliverable 5 — Brand and security narrative on bootstrap success

Two short links on the verify-page success state (both manager-created and learner-joined flows):

- **"How AllowMe protects your kid's money"** — opens a modal or new tab with a one-page explainer: encrypted family vaults today, on-chain settlement on Base, destination allowlist enforcement, RBAC walls, audit log transparency, Sprint 4.0 roadmap to Coinbase Smart Wallet treasury.
- **"Why we built this"** — opens a modal or new tab with the mission narrative: financial literacy for underserved communities, charter school partnerships, the agent-native thesis, the founder's background (briefly).

**Locked decision:** modal, not new tab, for both. Reasons: (1) keeps users on the verify page so they complete their install rather than getting lost in a tab switch, (2) sets the expectation that this is contextual info, not a marketing-site navigation event, (3) easier to instrument for engagement.

Both modals are static content — no fetches, no dynamic data. They're literally markdown rendered to HTML at build time. Cheap to ship, easy to update.

### Deliverable 6 — Pre-flight client detection on verify page

Before rendering the success state, the verify page runs a quick client-detection probe:

- **iOS** — `navigator.userAgent` matches iPhone/iPad. Show iOS-specific install walkthrough (deep-link to Claude app if installed, fallback to ChatGPT-or-other).
- **Android** — similar pattern, Android-specific Claude app deep-link.
- **Desktop** — show desktop install walkthrough (Claude.ai web, ChatGPT web, Cursor) without mobile-specific copy.
- **In-app browser** — detect if running inside Claude's WebView or ChatGPT's WebView (rare but possible if the user tapped the link from inside an AI client). Surface a "you're already in Claude/ChatGPT, here's the next step" inline message.

**Locked decision:** client detection is purely cosmetic — it changes which walkthrough is shown by default, but doesn't change the underlying functionality. All install paths remain accessible via the platform tabs/accordion regardless of what was detected. The detection is a smart-default, not a gate.

This deliverable is the lowest-priority of the six because it's polish on top of Deliverable 1's install walkthrough. If timing slips, drop Deliverable 6 first.

## URL design pass — deferred

The critique included "Short, human-friendly URLs that look like destinations, not endpoints" (e.g., `allowme.dev/join/elina-q6bj` instead of `allowme.dev/verify?invite=...&role=learner`). This deliverable is **deferred to Sprint 3.7** because it touches:

- Route handlers (additive — old URLs continue to work, new shorter URLs are added)
- Invite-code generation (potentially — depends on whether the short URL embeds a shorter code form)
- Audit log entries (URL format changes leak into audit metadata)
- Test fixtures across multiple sprints

The change is straightforward but the surface is wider than the other six deliverables, and the leverage is lower (QR code in Deliverable 2 mostly solves the same problem). Defer to keep Sprint 3.6 tight.

## Scope guard — what's explicitly NOT in Sprint 3.6

1. New schema fields or migration paths
2. New tools beyond the three listed in Deliverable 4
3. URL design pass (Sprint 3.7)
4. Spanish-language verify page or tool responses (Sprint 3.5 → 4.0 work)
5. Dashboard or web UI for the kid (Sprint 4.0+ "kid surface" question)
6. Real image-based dashboards or embedded charts in tool responses (Sprint 4.0+ — Sprint 3.6 uses Unicode + ASCII only)
7. Audio walkthroughs or accessibility-pass on the screen recordings (Sprint 4.0+)
8. Multi-family Manager affordances (Sprint 4.0+)
9. Co-parent multi-signer at bootstrap (Sprint 4.0 Approach A on-chain spend permissions)
10. SMS-from-the-product (today the parent's AI client drafts SMS for them to send; AllowMe doesn't itself send SMS — out of scope)
11. Push notifications for deadline approaching or streak-bump achieved (Sprint 4.0 infrastructure)
12. Real-time progress updates without the kid asking (same — Sprint 4.0)
13. Cross-family invite sharing (each family is isolated)
14. Goal templates or suggested goals (Sprint 3.5+ if pilot data warrants)

## Constraints

### Architecture preserved
No schema changes. No core service rewrites. No new MCP transport. Everything in Sprint 3.6 is additive: new tools, new verify-page UI components, new copy in existing responses.

### Test count protected
All 363+ existing tests must remain green. Sprint 3.6 adds tests for the new tools and tightens snapshot tests on the response copy.

### Mobile-first
Every UI deliverable (1, 5, 6) must render correctly on a 380px-wide mobile viewport. This is the dominant device class for learner-side usage. Desktop is secondary.

### Single-file verify-page constraint preserved
Sprint 3.0 v4 Decision 2 committed to `public/verify.html` as a single-file no-build-step page. Sprint 3.6's UI additions preserve that commitment. Deliverable 1's install walkthrough and Deliverable 5's modals are inline HTML+CSS+vanilla-JS within the same file.

## Forward compatibility

Two Sprint 4.0 dependencies worth noting:

**Coinbase Smart Wallet treasury migration** (Sprint 4.0 Approach A): Deliverable 5's "How AllowMe protects your kid's money" copy must be written truthfully about the *current* model (encrypted family vault, AllowMe-managed Railway storage) AND name the Sprint 4.0 migration as the path to non-custodial. The mistake to avoid: claiming non-custodial today when the architecture is custodial-with-encryption today. Honest framing is "Today, your funds are held in encrypted family-specific vaults on AllowMe infrastructure. In our upcoming Sprint 4.0, family treasuries migrate to Coinbase Smart Wallets owned by you directly — AllowMe will never hold your keys."

**Postgres migration** (Sprint 4.0): the new `resend-invite`, `test-connection`, and `view-my-link` tools all read from current state. They work correctly under the Postgres migration without changes — they're read-shaped (or rotation-shaped in resend's case) operations on the family config and member index. No data-shape coupling to defer.

## Open questions before code

Two confirmations needed:

**Q1: Walkthroughs as embedded video, animated GIF, or illustrated step sequence?**
Recommendation: start with animated GIF for fastest iteration (recordable via macOS screenshot tool or Loom, no encoding setup), upgrade to MP4 video in Sprint 3.7 if pilot data shows file size is an issue. Static illustrated steps as fallback if recording quality is unacceptable.

**Q2: Brand modals — markdown rendered at build time, or React components with copy in code?**
Recommendation: markdown rendered at build time, stored in `public/copy/why.md` and `public/copy/security.md`. Keeps copy out of source code (easier to edit, version, eventually translate) and lets non-engineers tweak the brand narrative without a code review.

Both questions are independent of architectural decisions. Differences are localized.

## References

- Sprint 3.0 v4 plan: `sprint-3.0/plan-3.0-v4.md` (verify page, magic-link UX)
- Sprint 3.0.2 plan: `sprint-3.0.2/plan-3.0.2.md` (allowlist, security model)
- Sprint 3.0.3 (informal — `check-goals`, kid-facing copy)
- Sprint 3.0.5: bootstrap form extension (per separate plan)
- Sprint 3.0.6: `sprint-3.0.6.md` (invite-member copy fix, precondition)
- Design-lead critique session: 2026-05-18 user-flow review
- Four-screenshot verify-page learner happy path: Image 1-4 from 2026-05-18 turn