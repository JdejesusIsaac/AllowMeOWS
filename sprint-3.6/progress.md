# Sprint 3.6 — Progress

**Status:** Not Started
**Start date:** TBD
**Target ship date:** TBD (~12.5 hours focused, 2-3 sessions)
**Test count entering sprint:** 363+ passing (post-3.0.5 / 3.0.6 baseline, exact count depends on those sprints' deltas)
**Test count target:** +14 tests (per test-3.6.md: RC1-RC8 for recovery tools, QR1, CARD1-4 snapshot tests, MODAL1)

---

## Pre-sprint checklist

- [ ] Sprint 3.0.6 shipped — invite-member response includes browser-tap warning + anti-paste warning
- [ ] Sprint 3.0.5 shipped — bootstrap form captures learning goals + kid wallets
- [ ] Baseline tests green: `npx vitest run` returns 363+ passing, 1 skipped, 0 failed
- [ ] `npx tsc --noEmit` clean on main
- [ ] Backup: `railway ssh "tar -czf /tmp/data-backup-pre-3.6-$(date +%Y%m%d-%H%M%S).tar.gz /app/data"`
- [ ] Real iOS device available for mobile smoke
- [ ] Real Android device available for cross-device QR scan smoke
- [ ] macOS screen recording confirmed working (Cmd+Shift+5 → record selected area)
- [ ] Test treasury still funded on Base Sepolia for any distribution smoke
- [ ] Q1 confirmation: animated GIF vs MP4 vs static screenshots for walkthroughs
- [ ] Q2 confirmation: markdown files vs inline-string brand modals
- [ ] `qrcode` npm package installable in current Node version: `npm install qrcode @types/qrcode --save`
- [ ] `marked.min.js` accessible via CDN (https://cdn.jsdelivr.net/npm/marked/marked.min.js works)

---

## Step-level execution tracker

### Step 0 — Pre-sprint validation ⏳

**Estimate:** 15 min
**Status:** Not Started

**Tasks:**
- [ ] Confirm `invite-member.ts` response matches Sprint 3.0.6's load-bearing copy
- [ ] Read `src/tools/check-progress.ts`, `check-savings.ts`, `check-goals.ts`, `verify-achievement.ts` baseline implementations — note current response shape
- [ ] Read `public/verify.html` to understand the current success-state HTML structure
- [ ] Confirm `data/families/{id}/.ows/setup-codes.json` exists and is readable via existing decryption chain (needed for `view-my-link`)
- [ ] Read `src/constants.ts` `ROLE_TOOL_ACCESS` to plan RBAC additions

---

### Step 1 — QR snapshot test (W2.5 first) ⏳

**Estimate:** 15 min
**Files:** `tests/qr-code.test.ts` (NEW)
**Status:** Not Started

**Why first:** establishes the contract for Deliverable 2 before implementation. Test should FAIL initially (no QR field in response yet), then PASS after W2.2 lands.

**Tasks:**
- [ ] Write test QR1 (per test-3.6.md): invite-member response includes `inviteQrCode` field
- [ ] Assert: field is a string starting with `data:image/png;base64,` (or matches alternative URL form if fallback ships)
- [ ] Assert: decoding the base64 PNG yields a valid PNG header
- [ ] Confirm test fails against current code

---

### Step 2 — `resend-invite` + tests (W4.1 + W4.5 + RC1-3) ⏳

**Estimate:** 90 min
**Files:** `src/tools/resend-invite.ts` (NEW), `src/constants.ts`, `tests/recovery-tools.test.ts` (NEW)
**Status:** Not Started

**Why this one first among the new tools:** highest leverage failure-recovery tool. Exercises the most code paths (invite store, audit log, RBAC). Establishes the pattern for the other two.

**Tasks:**
- [ ] Create `src/tools/resend-invite.ts`:
  - [ ] Input: `childName` (for learner role) or `role` + `memberName` (for non-learner roles)
  - [ ] Look up existing active (unredeemed) invite for the target member
  - [ ] If found: mark `revoked: true`, set `revokedAt`, emit `invite-revoked` audit entry
  - [ ] Call existing `invite-member` core logic (or extract shared helper) to issue a fresh invite
  - [ ] Return same response shape as `invite-member` so the caller's experience is consistent
- [ ] RBAC: add `resend-invite` to `ROLE_TOOL_ACCESS[ROLES.MANAGER]` only
- [ ] Register tool in both stdio and HTTP transport
- [ ] Tests RC1-3 (per test-3.6.md):
  - [ ] RC1: Manager resends invite for learner with unredeemed invite → old code revoked, new code issued, audit log records both
  - [ ] RC2: Non-Manager attempts resend → RBAC denied
  - [ ] RC3: Manager attempts resend for a non-existent member → clean error
- [ ] Confirm baseline + RC1-3 all green

---

### Step 3 — QR code in `invite-member` response (W2.1-2.4) ⏳

**Estimate:** 45 min
**Files:** `package.json`, `src/tools/invite-member.ts`
**Status:** Not Started

**Tasks:**
- [ ] `npm install qrcode @types/qrcode --save` and verify clean install
- [ ] In `invite-member.ts`, after generating `verifyUrl`, generate QR code: `const qrDataUrl = await QRCode.toDataURL(verifyUrl)`
- [ ] Add `inviteQrCode: qrDataUrl` to the response JSON payload
- [ ] Update response message template: "Scan this QR code with their phone camera (easiest), or send the link below"
- [ ] Run QR1 test from Step 1 — confirm now passing
- [ ] Manual: in Claude session, ask "Invite my daughter X as learner" and confirm the QR renders inline

**Fallback if inline base64 doesn't render in Claude:**
- [ ] Serve QR as hosted PNG at `/api/qr/:inviteCode.png`
- [ ] Return `inviteQrUrl: "https://allowme.dev/api/qr/{code}.png"` instead of base64
- [ ] Cache server-side for 1 hour TTL

---

### Step 4 — `test-connection` + `view-my-link` + tests (W4.2 + W4.3 + RC4-8) ⏳

**Estimate:** 60 min
**Files:** `src/tools/test-connection.ts` (NEW), `src/tools/view-my-link.ts` (NEW)
**Status:** Not Started

**Tasks:**
- [ ] Create `src/tools/test-connection.ts`:
  - [ ] No input args
  - [ ] Returns: `{success, callerName, role, familyName, familyId, lastActionAt, healthCheck: "ok"}`
  - [ ] `lastActionAt` = most recent audit log entry timestamp for this memberId
  - [ ] Wraps the read in try/catch; if any error during read, return `healthCheck: "error"` with details
- [ ] Create `src/tools/view-my-link.ts`:
  - [ ] No input args
  - [ ] Look up caller's memberId in `data/families/{id}/.ows/setup-codes.json`
  - [ ] Filter to caller's own setup codes; pick most recent active
  - [ ] Return: `{success, magicLinkUrl: "https://allowme.dev/mcp?setup=SETUP-XXXX", expiresAt, warning: "Don't share — anyone with this link can act as you in AllowMe."}`
  - [ ] Emit `magic-link-viewed` audit entry with `actor: caller.memberId`
- [ ] RBAC: add both tools to all role allowlists in `ROLE_TOOL_ACCESS`
- [ ] Register tools in transports
- [ ] Tests RC4-8:
  - [ ] RC4: `test-connection` returns expected fields for Manager
  - [ ] RC5: `test-connection` returns expected fields for Learner (child-scoped)
  - [ ] RC6: `view-my-link` returns caller's own URL only
  - [ ] RC7: `view-my-link` audit entry recorded
  - [ ] RC8: `view-my-link` does NOT leak other members' links

---

### Step 5 — Rich response cards (W3.1-3.6) ⏳

**Estimate:** 3 hours
**Files:** `src/tools/check-progress.ts`, `check-savings.ts`, `check-goals.ts`, `verify-achievement.ts`, `tests/rich-cards.test.ts` (NEW)
**Status:** Not Started

**This is the biggest chunk and the highest-leverage UX shift in the sprint. Don't rush.**

**Tasks:**

W3.1 — Card vocabulary (20 min):
- [ ] Define helper functions in `src/utils/card-formatting.ts` (NEW):
  - [ ] `renderProgressBar(current: number, total: number, width: number = 10): string` → returns `[▓▓▓░░░░░░░] 3/10`
  - [ ] `renderDollarBar(current: number, total: number): string` → returns `$0.45 / $5.00 ▓▓░░░░░░░░`
  - [ ] `renderGoalStatus(status: "complete" | "in-progress" | "not-started"): string` → returns `✓`, `⏳`, or `○`
  - [ ] `renderNextAction(prompt: string): string` → returns `👉 ${prompt}`

W3.2 — `check-progress` rich card (45 min):
- [ ] Add `summary` field to response (the rich-card markdown)
- [ ] Card structure:
  ```
  **Aiden's week so far**

  Earned: $0.45 / $5.00 ▓░░░░░░░░░
  Streak: 3 days 🔥 (4 more for 1.1x bump)

  **Categories**
  Reading   $0.30 / $2.00 ▓▓▓░░░░░░░
  Math      $0.15 / $2.00 ▓░░░░░░░░░
  Movement  $0.00 / $1.00 ░░░░░░░░░░

  **Goals**
  ⏳ Read 10 books — 3 of 10
  ○ Master fractions — not started

  👉 Log something today to keep your streak.
  ```
- [ ] Preserve structured fields (`categories`, `streak`, `earned`, etc.) for downstream tool consumers
- [ ] Confirm: empty-state for new learner shows friendly markdown card, not raw "0 earned"

W3.3 — `check-savings` rich card (30 min):
- [ ] Similar structure: card with locked vs released breakdown, multiplier, lock countdown if applicable

W3.4 — `check-goals` rich card (45 min):
- [ ] Goal list with status indicators and subgoal nesting:
  ```
  **Aiden's learning goals**

  ⏳ Read 10 books this quarter — 3 of 10
  ⏳ Master 7th-grade math
     ○ Fractions
     ✓ Decimals
     ○ Ratios
     ○ Pre-algebra
  ⏰ "Catch up by August 15" — 87 days out
  ```

W3.5 — `verify-achievement` "what changed" mini-card (30 min):
- [ ] After verifying, include in response a card showing the delta:
  ```
  ✓ Logged: Read for 30 min, reading, score 85
  +$0.03 earned
  Streak: 3 → 4 days 🔥
  Reading goal: 3 → 4 of 10
  ```

W3.6 — Snapshot tests CARD1-4 (30 min):
- [ ] Tests assert presence of progress-bar character `▓`, dollar sign, emoji indicators
- [ ] Tests preserve structured data fields (don't allow the rich card to replace structured data)

---

### Step 6 — Install walkthrough on verify page (W1.1-1.5) ⏳

**Estimate:** 3 hours
**Files:** screen-recording GIFs in `public/walkthroughs/`, `public/verify.html`
**Status:** Not Started

**Tasks:**

W1.1 — Record three walkthroughs (60 min):
- [ ] Set up a clean recording environment (no notifications, browser zoom 100%, clean browser cache)
- [ ] Record Claude desktop install: open Claude.ai → Settings → Connectors → Add → paste magic-link URL → confirm tools loaded → ask "what are my goals?" (≤30 sec)
- [ ] Record ChatGPT desktop install: similar sequence on ChatGPT (≤30 sec)
- [ ] Record Cursor install or "Other/generic MCP" path (≤30 sec)
- [ ] Convert each .mov to .gif using ffmpeg or built-in tools; target <2 MB each
- [ ] Save to `public/walkthroughs/claude.gif`, `chatgpt.gif`, `other.gif`

W1.2 — Tab component (45 min):
- [ ] In verify.html success-state section, add tab component with 3 tabs
- [ ] Vanilla JS tab switching (no framework)
- [ ] Each tab content panel contains numbered steps + the GIF
- [ ] Mobile: collapse to accordion below 380px

W1.3 — Content per tab (45 min):
- [ ] Claude tab: 4-step list + GIF + "Open in Claude" deep-link button
- [ ] ChatGPT tab: 4-step list + GIF + copy-link button + "ChatGPT does not support deep-link install — paste the link manually"
- [ ] Other tab: 3-step list + GIF + copy-link button + "If your MCP client isn't shown, paste the URL into its custom-connector field"

W1.4 — Mobile responsive pass (15 min):
- [ ] Test on 380px viewport via browser devtools
- [ ] Tabs become collapsible sections
- [ ] GIFs scale to width without overflow

W1.5 — Manual test (15 min):
- [ ] iOS Safari, Android Chrome, desktop Safari, desktop Chrome
- [ ] GIFs play (autoplay + loop expected on iOS Safari without user interaction)

---

### Step 7 — Brand modals (W5.1-5.4) ⏳

**Estimate:** 90 min
**Files:** `public/copy/security.md` (NEW), `public/copy/why.md` (NEW), `public/verify.html`
**Status:** Not Started

**Tasks:**

W5.1 — `security.md` (30 min):
- [ ] Draft markdown content (~300-500 words)
- [ ] Structure: current model → what's enforced → what we're working toward
- [ ] Must accurately describe Sprint 3.0.2 allowlist, Sprint 2.9.1 family vault, audit log
- [ ] Must NOT overclaim — explicitly say "currently held in encrypted family vaults on AllowMe infrastructure" not "non-custodial"
- [ ] Must name Sprint 4.0 as the path to self-custodial Coinbase Smart Wallets

W5.2 — `why.md` (30 min):
- [ ] Draft markdown content (~300-500 words)
- [ ] Structure: mission → audience → why now → who built it
- [ ] Financial literacy framing, charter school partnership context
- [ ] Brief founder background, professional tone — not a personal essay
- [ ] No marketing-speak; honest and contextual

W5.3 — Modal component (20 min):
- [ ] Vanilla CSS modal with overlay + dismiss-on-click-outside
- [ ] Two trigger links on verify success state: "How AllowMe protects your kid's money" + "Why we built this"
- [ ] Body: fetched markdown rendered to HTML on open

W5.4 — Markdown rendering (20 min):
- [ ] Load `marked.min.js` from CDN
- [ ] On modal open: fetch `/copy/{name}.md`, pipe through `marked.parse()`, insert into modal body
- [ ] Cache fetched markdown in memory after first load
- [ ] Tests MODAL1: render both modals successfully, content includes load-bearing phrases ("encrypted", "Sprint 4.0", mission language)

---

### Step 8 — Client detection (W6.1-6.2) ⏳

**Estimate:** 45 min
**Files:** `public/verify.html`
**Status:** Not Started

**Tasks:**
- [ ] Add user-agent parser:
  - [ ] iOS: `/iPhone|iPad|iPod/.test(navigator.userAgent)` → default to Claude tab (with iOS-specific copy)
  - [ ] Android: `/Android/.test(navigator.userAgent)` → default to Claude tab
  - [ ] Desktop: neither → default to Claude tab
  - [ ] Claude WebView: check for specific UA token (research what Claude desktop uses) — if detected, show inline "Looks like you're already in Claude! Tap 'Open in Claude' below."
  - [ ] ChatGPT WebView: similar pattern
- [ ] Manual smoke: load verify page on iOS Safari, Android Chrome, desktop Chrome, and inside Claude WebView (if accessible) — confirm correct default tab

---

### Step 9 — Documentation + production smoke (W7.1-7.2) ⏳

**Estimate:** 45 min
**Files:** `README.md`
**Status:** Not Started

**Tasks:**

W7.1 — README (15 min):
- [ ] Add Sprint 3.6 section to roadmap:
  ```
  ## Sprint 3.6 (Done)
  Design completeness pass:
  - Connector-install walkthrough on verify success page (Claude, ChatGPT, other)
  - QR code in invite-member response for parent → kid handoff
  - Rich markdown response cards for kid-facing tools
  - Failure-recovery tools: resend-invite, test-connection, view-my-link
  - Brand and security narrative modals on bootstrap success
  - Pre-flight client detection on verify page
  ```

W7.2 — Production smoke (30 min):
- [ ] Deploy to Railway
- [ ] V1-V6 from "Production validation plan" below

---

## Time tracking

| Phase | Estimate | Actual | Notes |
|-------|----------|--------|-------|
| Step 0 — Pre-sprint validation | 15 min | — | |
| Step 1 — QR snapshot test | 15 min | — | |
| Step 2 — `resend-invite` | 90 min | — | |
| Step 3 — QR code | 45 min | — | |
| Step 4 — `test-connection` + `view-my-link` | 60 min | — | |
| Step 5 — Rich response cards | 180 min | — | Biggest chunk |
| Step 6 — Install walkthrough | 180 min | — | Recording is the variable |
| Step 7 — Brand modals | 90 min | — | |
| Step 8 — Client detection | 45 min | — | |
| Step 9 — Docs + smoke | 45 min | — | |
| **Total** | **~12.5 hours** | — | |

---

## Session log

### Session 1 — TBD

**Goals:**
- Steps 0–4 (validation + QR snapshot + resend-invite + QR code + test-connection + view-my-link)
- All new recovery tools shipped and tested

**Outcomes:**
- [TBD]

**Test count:** entering — / exiting —

---

### Session 2 — TBD

**Goals:**
- Step 5 (rich response cards — the biggest chunk)
- Mobile smoke of rich cards on real device

**Outcomes:**
- [TBD]

---

### Session 3 — TBD

**Goals:**
- Steps 6–9 (install walkthrough, brand modals, client detection, docs + smoke)
- Final production smoke
- Sprint sign-off

**Outcomes:**
- [TBD]

---

## Failed approaches

*(Empty until execution; populated during session log)*

Pattern from prior sprints: upstream fixes vs downstream workarounds. If a behavior turns out to differ from assumed, fix it upstream and update the plan; do not work around.

---

## Production validation plan

After Step 9 deploy:

### V1 — Install walkthrough renders and plays
- [ ] Bootstrap a fresh family on Railway
- [ ] On the verify-page success state, confirm three install tabs (Claude / ChatGPT / Other) render
- [ ] Each tab's GIF autoplays (or static screenshot displays as fallback)
- [ ] Mobile: tab UI collapses to accordion correctly on iPhone

### V2 — QR code in invite response
- [ ] In Claude Manager session: "Invite my daughter as learner"
- [ ] Confirm response shows inline QR code image
- [ ] On a real second device (any phone), open camera, point at QR code
- [ ] Confirm camera offers to open the verify URL
- [ ] Confirm URL opens in Safari/Chrome (not in any installed AI app)
- [ ] Confirm verify-page success state renders correctly after redemption

### V3 — Rich response cards
- [ ] In learner Claude or ChatGPT session: "How am I doing this week?"
- [ ] Confirm response is a rich markdown card with progress bars and emoji
- [ ] Repeat for "Check my savings", "What are my goals?", "I read for 30 min today, reading, score 85"
- [ ] Mobile: cards render readably on 380px viewport without horizontal scroll

### V4 — Failure-recovery tools
- [ ] In Manager session: "Resend my daughter's invite" → confirm new invite code issued and audit log shows both `invite-revoked` and `invite-issued` entries
- [ ] In learner session: "Test my connection" → confirm health check returns correct identity and family info
- [ ] In learner session: "What's my magic link?" → confirm returns the existing setup-coded URL with warning copy

### V5 — Brand modals
- [ ] On verify success state, tap "How AllowMe protects your kid's money"
- [ ] Confirm modal opens with readable markdown content
- [ ] Confirm content mentions encrypted family vault, allowlist, Sprint 4.0 path to non-custodial — and does NOT claim non-custodial today
- [ ] Repeat for "Why we built this" — confirm mission narrative renders
- [ ] Dismiss modal returns to verify page

### V6 — Client detection
- [ ] Load verify URL on iPhone Safari → confirm Claude tab is default
- [ ] Load on Android Chrome → confirm Claude tab is default
- [ ] Load on desktop Chrome → confirm Claude tab is default

---

## Risks and known issues

### Risk 1 — Inline base64 QR code doesn't render in Claude

**Likelihood:** Medium
**Impact:** Deliverable 2 falls back to hosted-PNG path; adds 30 min of work for the `/api/qr/:code.png` endpoint
**Mitigation:** Test base64 rendering in Step 3 first thing; if it fails, switch fallback immediately

### Risk 2 — Screen recording quality is unacceptable on first pass

**Likelihood:** Medium
**Impact:** Recording session in W1.1 grows from 60 min to 90-120 min
**Mitigation:** Set a one-pass budget; if quality is genuinely bad after 2 retakes, fall back to static illustrated screenshots and document the regression for Sprint 3.7

### Risk 3 — `view-my-link` decryption path is brittle

**Likelihood:** Medium (per-family encryption chain has been a source of complexity)
**Impact:** Tool returns errors for users whose setup-codes.json doesn't decrypt cleanly
**Mitigation:** Defensive try/catch with clean error message; defer `view-my-link` to Sprint 3.7 if it surfaces issues. Keep `resend-invite` + `test-connection` as the 3.6 deliverable.

### Risk 4 — Rich response cards too text-dense for mobile

**Likelihood:** Medium
**Impact:** Card vocabulary needs a second pass to tighten
**Mitigation:** Manual mobile smoke in Step 5; if too dense, shorten progress bars from 10 chars to 8, drop emoji where redundant

### Risk 5 — Brand modal copy makes overclaims

**Likelihood:** Low if Step 7 is done carefully
**Impact:** Reputational risk if Sprint 4.0 ships and users notice the "non-custodial" claim was misleading
**Mitigation:** Honest framing in W5.1 — "currently held in encrypted vaults... Sprint 4.0 migration to non-custodial Coinbase Smart Wallets." If unsure, ask for a sanity check before deploy.

### Risk 6 — `resend-invite` race condition

**Likelihood:** Low
**Impact:** If two `resend-invite` calls happen concurrently, two new invites could exist
**Mitigation:** Wrap revoke + issue in a transaction-like sequence; if the existing invite store doesn't support atomicity, accept the rare race and document it. Pilot scale (1-5 families) makes this practically irrelevant.

### Risk 7 — Tab component CSS conflicts with existing verify.html styles

**Likelihood:** Low
**Impact:** Cosmetic issues, possible specificity wars
**Mitigation:** Namespace new CSS classes with `sprint-3.6-` prefix or scope to the tab container

---

## Definition of done

Sprint 3.6 is shippable when:

- [ ] All Sprint Contract success criteria 1–12 verifiably pass
- [ ] All 363+ prior tests still green
- [ ] +14 new tests passing (QR1, RC1-8, CARD1-4, MODAL1)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` clean
- [ ] V1–V6 production validation passes on Railway
- [ ] Mobile smoke completed on real iOS device
- [ ] QR code scan tested with real second-device camera
- [ ] README updated
- [ ] No new schema fields added
- [ ] No backward-compat regressions (existing families' tools still work)
- [ ] Decisions log captured in `research-3.6.md` (done)
- [ ] Plan captured in `plan-3.6.md` (done)
- [ ] Tests captured in `test-3.6.md` (done)
- [ ] This `progress-3.6.md` reflects actual completion state

---

## What ships next (post-3.6)

**If 3.6 ships clean:**
- Run a second learner-mode test with your son using the new rich-card surfaces — capture his reactions
- Sprint 3.7 — URL design pass, subgoal auto-matching, OWS executable wiring stretch from 3.0.2
- Landing page docs (7 pages from prior turn)
- Sprint 4.0 — Smart Wallet treasury, paymaster, Postgres

**If 3.6 surfaces a structural issue:**
- Hotfix to preserve UX wins (don't roll back the rich cards or QR code)
- Defer broken pieces to Sprint 3.6.1 micro-sprint
- Don't block Sprint 4.0 planning on 3.6 polish

**Critical:** the landing page docs become honest only AFTER Sprint 3.6 ships, because the screenshots and the install walkthrough are what makes the docs accurate rather than aspirational. Don't write docs until after this sprint.