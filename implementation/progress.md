# Sprint 3.6 — Progress

**Status:** **Sprint 3.6 automated + docs (W7.1) complete** — **432 passing + 1 skipped**; [`README.md`](../README.md) roadmap updated. **Human gates:** W7.2 Railway smoke (V1–V6 in this file), W1.1 GIF recordings, W1.5 device walkthrough smoke.
**Start date:** 2026-05-18
**Target ship date:** TBD (~12.5 hours focused, 2-3 sessions)
**Test count entering sprint:** **417 passing + 1 skipped** (measured fresh on 2026-05-18 — contract C9 said 416, actual is 417; trivial doc drift, no action needed).
**Test count target:** **+15 tests** (QR1, RC1-8, CARD1-4, MODAL1, UA1 per contract round-2 amendment) = **432 passing + 1 skipped** at sprint end.

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

### Step 0 — Pre-sprint validation ✅

**Estimate:** 15 min
**Status:** DONE (2026-05-18, ~10 min actual)

**Tasks:**
- [x] Baseline test run: `cd AllowMeOWS && rm -rf data && mkdir data && npx vitest run` → **417 passing + 1 skipped** across 37 test files in 77.14s. Contract C9 specified 416 — actual is 417 (off-by-one drift, target adjusted to 432).
- [x] `cd AllowMeOWS && npx tsc --noEmit` → clean exit 0 (one harmless npm devdir warning, unrelated).
- [x] `npm install qrcode @types/qrcode --save` → installed cleanly. 107 packages, 10 pre-existing vulnerabilities (unrelated, ignore for this sprint).
- [x] Smoke-tested `qrcode.toDataURL('https://allowme.dev/verify?invite=TEST', {width:256})` → returns 2430-byte `data:image/png;base64,iVBORw0KGgo...` (standard PNG header) ✓.
- [x] Read `src/tools/invite-member.ts` — `inviteMemberHandler` already exported separately from `registerInviteMemberTool` (view-policy pattern). Safe to extend response with `inviteQrCode` field in Step 3.
- [x] Read `src/schemas.ts` — `InviteSchema` (no `revoked` field), `AuditEntrySchema.action` is a closed enum of 24 values. **C10 vs new-audit-actions tension surfaced** — see Decisions log below.
- [x] Read `src/constants.ts` `ROLE_TOOL_ACCESS` — current 14 tools per role distribution intact; ready for 3 additions in Step 2/4.
- [x] Read `tests/helpers/family.ts` — actual helper is `createTestFamily(overrides)` returning `{familyId, memberId, asManager(), addMember()}`. The test.md spec used `setupFamily()` / `callTool()` API that doesn't exist — **tests will adapt to the real helper** (stylistic, not a contract deviation).

**Discoveries / decisions logged below in "Decisions log" and "Failed approaches" sections.**

---

---

### Step 1 — QR snapshot test (W2.5 first) ✅ RED

**Estimate:** 15 min
**Files:** [`tests/qr-code.test.ts`](../tests/qr-code.test.ts) (NEW)
**Status:** DONE (RED — locks contract for Step 3) — 2026-05-18

**Why first:** establishes the contract for Deliverable 2 before implementation. Test FAILS initially (no QR field in response yet), turns GREEN after Step 3.

**Tasks:**
- [x] Wrote test QR1 mirroring `tests/invite-member-copy.test.ts` conventions (real handler invocation via `inviteMemberHandler`, real helpers via `createTestFamily`/`makeChild`, deterministic `ALLOWANCE_AGENT_URL`).
- [x] Asserts: `body.inviteQrCode` defined as string; starts with `data:image/png;base64,` OR `https://.../qr/...` (per C2 hosted-fallback amendment); base64 form decodes to valid PNG header (`89 50 4E 47 0D 0A 1A 0A`).
- [x] Asserts: `body.verifyUrl` still present (QR is supplement, not replacement).
- [x] Asserts: `body.message` references "scan" / "QR" (C2 copy requirement).
- [x] Ran `cd AllowMeOWS && npx vitest run tests/qr-code.test.ts` → 1 failed, 0 passed. Failure on line 63: `expected undefined to be defined` (the `inviteQrCode` field is missing in current `invite-member` response). Exactly the right failure mode for the TDD RED state.
- [x] `npx tsc --noEmit` still clean after adding the new test file.

**RED → GREEN handoff:** Step 3 (`invite-member` QR code integration) flips this test green by adding `inviteQrCode: await QRCode.toDataURL(verifyUrl)` to `responsePayload` and updating the message copy with "scan this QR / send the link".

---

### Step 2 — `resend-invite` + tests (W4.1 + W4.5 + RC1-3) ⏳

**Estimate:** 90 min
**Files:** [`src/tools/resend-invite.ts`](../src/tools/resend-invite.ts) (NEW, 167 lines), [`src/constants.ts`](../src/constants.ts), [`src/index.ts`](../src/index.ts), [`app/server.ts`](../app/server.ts), [`src/schemas.ts`](../src/schemas.ts) (2 added enum lines per amended C10), [`tests/recovery-tools.test.ts`](../tests/recovery-tools.test.ts) (NEW, 217 lines), [`tests/http-transport.test.ts`](../tests/http-transport.test.ts) (14 → 15 assertion).
**Status:** DONE (2026-05-18, ~75 min actual vs 90 min estimate)

**Why this one first among the new tools:** highest leverage failure-recovery tool. Exercises the most code paths (invite store, audit log, RBAC). Establishes the pattern for the other two.

**Tasks:**
- [x] Created [`src/tools/resend-invite.ts`](../src/tools/resend-invite.ts):
  - [x] Input: `role` + (for learner) `childName`. RBAC fields passed through.
  - [x] Looks up existing active (`!used && expiresAt > now`) invite matching role + childName.
  - [x] **Revocation = delete from the active invites array** (no `revoked` field — C10 amendment preserves `InviteSchema`). Audit entry IS the durable record of the event.
  - [x] Emits `invite-revoked` audit entry with `details: { inviteCode, role, childName, reason: "resend-invite" }`.
  - [x] Delegates fresh-invite issuance to `inviteMemberHandler` (preserves response copy + audit-create entry).
  - [x] Returns the same response shape as `invite-member` with an extra `revokedInviteCode` field so callers see both events.
- [x] RBAC: added `"resend-invite"` to `ROLE_TOOL_ACCESS[ROLES.MANAGER]` only (15 tools total — up from 14).
- [x] Registered the tool in both stdio ([`src/index.ts`](../src/index.ts)) and HTTP ([`app/server.ts`](../app/server.ts)) transports.
- [x] Updated [`tests/http-transport.test.ts`](../tests/http-transport.test.ts) `managerTools.length` assertion from `14` to `15`.
- [x] Wrote [`tests/recovery-tools.test.ts`](../tests/recovery-tools.test.ts) with RC1/RC2/RC3:
  - [x] **RC1** (Manager happy path): old invite gone, new invite present, `revokedInviteCode` surfaced, audit log has both `invite-revoked` + `invite-created` entries with matching `details.inviteCode` and `actor === managerMemberId`.
  - [x] **RC2** (Non-Manager denied): wraps `resendInviteHandler` with `withAccessControl`, calls with learner context, asserts denial response (`success: false`, role + toolName surfaced, "cannot use" error). Also asserts the static `ROLE_TOOL_ACCESS` matrix denies all four non-Manager roles. Verifies state was NOT mutated (seeded invite still active).
  - [x] **RC3** (clean error paths): non-existent child returns `"not found in family config"`; valid child with no active invite returns `"no active invite"`. Audit-log count unchanged on the error path.
- [x] Test-suite results after Step 2: **420 passing + 1 failed (QR1 expected RED) + 1 skipped (422 total)**. RC1/RC2/RC3 all green on first run. Zero regressions on the 417 baseline tests. `npx tsc --noEmit` still clean.

**Audit-entry shape note (D1 follow-through):** Tests assert `e.details?.inviteCode` (existing audit shape), not `e.metadata?.inviteCode` (test.md spec). The contract criterion C4 — "audit log shows both events" — is satisfied by both `invite-revoked` and `invite-created` entries carrying the relevant `inviteCode` in `details`.

---

### Step 3 — QR code in `invite-member` response (W2.1-2.4) ✅

**Estimate:** 45 min
**Files:** [`package.json`](../package.json) (already had `qrcode` from Step 0), [`src/tools/invite-member.ts`](../src/tools/invite-member.ts)
**Status:** DONE (2026-05-18, Session 2)

**Tasks:**
- [x] `qrcode` + `@types/qrcode` installed in Step 0
- [x] After `verifyUrl`, `inviteQrCode` = `await QRCode.toDataURL(verifyUrl, { width: 256, margin: 1 })` on [`invite-member.ts`](../src/tools/invite-member.ts)
- [x] `responsePayload.inviteQrCode = inviteQrCode`
- [x] Message template: prefixed with "**Scan this QR code** with their phone camera (easiest), or send the link below" — preserves SC1-required "**Send them this link.** … tap it on their phone in a browser …" paragraph unchanged
- [x] `npx vitest run tests/qr-code.test.ts` — GREEN

**Deferred (fallback):** Hosted PNG `/api/qr/...` — not needed; inline base64 works in QR1.

**Verification:** Full `npx vitest run`: **421 passed | 1 skipped** (422 total). QR1 GREEN. SC1 GREEN. RC1–RC3 still GREEN (`resend-invite` chains through existing `inviteMemberHandler`).

### Step 4 — `test-connection` + `view-my-link` + tests (W4.2 + W4.3 + RC4-8) ✅

**Estimate:** 60 min  
**Files:** [`src/tools/test-connection.ts`](../src/tools/test-connection.ts) (NEW), [`src/tools/view-my-link.ts`](../src/tools/view-my-link.ts) (NEW), [`src/constants.ts`](../src/constants.ts), [`src/index.ts`](../src/index.ts), [`app/server.ts`](../app/server.ts), [`tests/recovery-tools.test.ts`](../tests/recovery-tools.test.ts), [`tests/http-transport.test.ts`](../tests/http-transport.test.ts)  

**Status:** DONE (Step 4 end-to-end)

**Implementation notes:**
- **`test-connection`** — Loads family + member via `StateManager`; `lastActionAt` is the newest audit entry where `actor === caller.memberId` (tests seed an audit first). Returns `callerName`, `scopedChildName` when learner, `healthCheck` ok/error envelope.
- **`view-my-link`** — Uses **`SetupCodeStore`** at server root `data/setup-codes.json` (see [`src/identity/setup-codes.ts`](../src/identity/setup-codes.ts)), consistent with `accept-invite` / `configure-family`; not a per-family `.ows/setup-codes.json` path from an older plan sketch. Chooses newest **active** (unrevoked + unexpired) code via `SetupCodeStore.list(memberId)`. `magicLinkUrl` = `${ALLOWANCE_AGENT_URL||https://allowme.dev}/mcp?setup=<code>` (encoded). Audit `magic-link-viewed`: `details` includes only `setupFingerprint` (SHA-256 hex prefix); **never** persists the plaintext `SETUP-*` code (C6 / RC7).
- **RBAC** — Both tools added to every role incl. Manager (Manager list now **17** tools incl. `resend-invite`). **Free tools:** H4 list extended with both names.
- **Tests** — RC4–RC8 live in [`tests/recovery-tools.test.ts`](../tests/recovery-tools.test.ts). `acceptInviteCore` results narrowed for TypeScript.

**Verification:** `npx vitest run` → **426 passed \| 1 skipped** (427). `npx tsc --noEmit` clean.

### Step 5 — Rich response cards (W3.1-3.6) ✅

**Estimate:** 3 hours
**Files:** [`src/utils/card-formatting.ts`](../src/utils/card-formatting.ts) (NEW), [`src/tools/check-progress.ts`](../src/tools/check-progress.ts), [`check-savings.ts`](../src/tools/check-savings.ts), [`check-goals.ts`](../src/tools/check-goals.ts), [`verify-achievement.ts`](../src/tools/verify-achievement.ts), [`tests/rich-cards.test.ts`](../tests/rich-cards.test.ts) (NEW)

**Status:** DONE (2026-05-18)


W3.1 — Card vocabulary (20 min):
- [x] Shared helpers in `src/utils/card-formatting.ts` (NEW): `renderProgressBar`, `formatUsdFromMicro` (glyphs such as 👉 live in tool-specific builders rather than standalone `renderNextAction` wrappers).
  - [x] `renderProgressBar(current: number, total: number, width: number = 10)` → `[▓▓▓░░░░░░░]` style bars
  - [ ] ~~`renderDollarBar`~~ *(not extracted — callers compose `formatUsdFromMicro` + `renderProgressBar` inline)*
  - [ ] ~~`renderGoalStatus`~~ inlined in [`buildCheckGoalsRichMarkdown`](../src/tools/check-goals.ts)
  - [ ] ~~`renderNextAction`~~ inlined as `👉 …` strings in builders

W3.2 — `check-progress` rich card (45 min):
- [x] Root `summary` when exactly one learner-scoped report; [`buildCheckProgressRichMarkdown`](../src/tools/check-progress.ts) (+ micro fields on rows)
- [x] Card structure:
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
- [x] Preserve structured fields; single-report payloads also lift root `earned` / `pending` / `streak` / `categories` (`earnedMicro`-style ints on rows)
- [x] Empty-state learner card is friendly prose + graphics (no orphaned raw amounts)

W3.3 — `check-savings` rich card (30 min):
- [x] Root `summary` via [`buildCheckSavingsRichMarkdown`](../src/tools/check-savings.ts); retains `lockedAmount` / `releasedAmount` (+ `currentMultiplier`)

W3.4 — `check-goals` rich card (45 min):
- [x] Root `summary` when one report (`buildCheckGoalsRichMarkdown`); per-report prose `reports[].summary` unchanged
- [x] Goal list with status indicators and subgoal nesting:
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
- [x] Exported `verifyAchievementHandler` + additive `summary` via `buildVerifyAchievementRichMarkdown`; `delta` / `newStreak` / `newEarned` (weekly sum micro after write) complement existing USD/message fields.
- After verifying, include in response a card showing the delta:
  ```
  ✓ Logged: Read for 30 min, reading, score 85
  +$0.03 earned
  Streak: 3 → 4 days 🔥
  Reading goal: 3 → 4 of 10
  ```

W3.6 — Snapshot tests CARD1-4 (30 min):
- [x] [`tests/rich-cards.test.ts`](../tests/rich-cards.test.ts) — CARD1–CARD4 + C3a field checks

---

### Step 6 — Install walkthrough on verify page (W1.1-1.5) ⚡

**Estimate:** 3 hours
**Files:** [`public/verify.html`](../public/verify.html), [`public/walkthroughs/*.svg`](../public/walkthroughs/) (+ optional `.gif`), [`public/verify-ua.js`](../public/verify-ua.js)

**Status:** **UI + fallbacks DONE** — W1.1 screen recordings pending (GIFs optional; placeholders present).

**Tasks:**

W1.1 — Record three walkthroughs (60 min):
- [ ] Host recordings as `public/walkthroughs/claude.gif`, `chatgpt.gif`, `other.gif` (each &lt;2 MB; page falls back to matching `.svg` today)
- [x] Fallback SVG placeholders: `claude.svg`, `chatgpt.svg`, `other.svg`

W1.2 — Tab component:
- [x] Success state: Claude / ChatGPT / Other tabs, vanilla JS, `refreshInstallWalkthroughAfterSuccess()` keyed off `verify-ua.js`
- [x] `window.__ALLOWME_UA_INSTALL__` exposes **`defaultInstallTab` / `detectInAppClient` functions** (not pre-computed booleans — fixes consumer drift)
- [x] Narrow viewports (@media **max-width: 380px**): stacked full-width tabs (accordion-like)

W1.3 — Content per tab:
- [x] Numbered steps, optional GIF via `<img>` + `onerror` → SVG, duplicate copy buttons + `mailto:help@allowme.dev`

W1.4 — Mobile responsive:
- [x] SVG / future GIF scales `width:100%`; tab row stacks ≤380px

W1.5 — Manual test:
- [ ] iOS/Android/desktop smoke (GIF autoplay once real clips land)

---


### Step 7 — Brand modals (W5.1-5.4) ✅

**Estimate:** 90 min
**Files:** [`public/copy/security.md`](../public/copy/security.md), [`public/copy/why.md`](../public/copy/why.md), [`public/verify.html`](../public/verify.html)

**Status:** **DONE** (2026-05-18) — CDN **marked**, fetch `/copy/{slug}.md`, in-memory Markdown cache (`s36MdCache`), overlay modal + ESC + backdrop dismiss + success-state triggers (**MODAL1** asserted at copy layer via [`tests/brand-modals.test.ts`](../tests/brand-modals.test.ts)).

**Tasks:**

W5.1/W5.2 — `security.md`, `why.md`:
- [x] Honest narratives (accuracy + wording guardrails for MODAL1)

W5.3/W5.4 — Modal + rendering:
- [x] Overlay + `.s36-modal-sheet`, click-outside (backdrop) + ✕ button + Escape
- [x] Triggers: "**How AllowMe protects your kid's money**" + "**Why we built AllowMe**" (success card)
- [x] Lazy-load `marked@12` from jsDelivr; `marked.parse(md, { breaks, gfm })`
- [x] MODAL1 file-level tests GREEN

---

### Step 8 — Client detection (W6.1-6.2) ✅

**Estimate:** 45 min
**Files:** [`public/verify-ua.js`](../public/verify-ua.js), [`public/verify.html`](../public/verify.html)

**Status:** **DONE earlier in sprint** — [`tests/client-detection.test.ts`](../tests/client-detection.test.ts); ChatGPT inline banner consumes `detectInAppClient`; **`defaultInstallTab`** drives install tabs.

**Residual:** optional Claude-WebView UA token + manual WebView sweep (non-blocking).

---

### Step 9 — Documentation + production smoke (W7.1-7.2) ⚡

**Estimate:** 45 min  
**Files:** [`README.md`](../README.md)  
**Status:** **W7.1 done** (2026-05-18) — roadmap + metrics refresh. **W7.2** remains human-gated deploy + checklist.

**Tasks:**

W7.1 — README:
- [x] Sprint **`### Sprint 3.6 (Done — design completeness pass)`** block under [`README.md` § Roadmap](../README.md); executive summary bumped to **17 tools / 432 passing + 1 skipped** + HTTP static note for `/verify` assets.
- [x] MCP table synced for `view-policy`, `check-goals`, `resend-invite`, `test-connection`, `view-my-link` + corrected role columns for **`check-progress` / `check-goals`** vs Advisor.

W7.2 — Production smoke (manual):
- [ ] Deploy/tag current `main` to Railway (or preferred host).
- [ ] Run **V1–V6** probes from the “Production validation plan” section inside this file after deploy.

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

*(Empty so far this sprint.)*

Pattern from prior sprints: upstream fixes vs downstream workarounds. If a behavior turns out to differ from assumed, fix it upstream and update the plan; do not work around.

---

## Decisions log

### D1 (2026-05-18, Step 0) — Test-helper API adaptation

**What:** [`evaluation/test.md`](../evaluation/test.md) uses `setupFamily(opts)`, `callTool(name, memberId, args)`, `inviteAndRedeemLearner(familyId, childName)` helpers. The real codebase has [`tests/helpers/family.ts`](../tests/helpers/family.ts) exporting `createTestFamily(overrides)` returning `{familyId, memberId, asManager(), addMember()}`, with tool handlers invoked directly via their exported `xxxHandler(args, caller)` function (the view-policy pattern, also used by `inviteMemberHandler`).

**Decision:** Test files will use the real helpers and inner-handler invocation. The test names (QR1, RC1–RC8, CARD1–CARD4, MODAL1, UA1) and the assertions (per-tool elements, RBAC denials, audit content, etc.) preserve the contract; only the helper API shape adapts. This is a stylistic adaptation, not a contract deviation. No contract amendment required.

### D2 (2026-05-18, Step 0) — C10 vs new audit-action enum values [BLOCKER, OPEN]

**What:** Contract C10 says "`src/schemas.ts` is untouched" with verification "`git diff src/schemas.ts` against merge-base is empty." But [`src/schemas.ts:208-235`](../src/schemas.ts) defines `AuditEntrySchema.action` as a **closed `z.enum([...])`** of 24 string literals. Sprint 3.6 contract C4 and C6 require new audit actions:
- `"invite-revoked"` (C4: `resend-invite`'s revocation event)
- `"magic-link-viewed"` (C6: `view-my-link`'s read event)

Neither exists in the enum. Emitting them is either:
- (a) impossible without amending the enum (= touching schemas.ts → C10 violation), OR
- (b) impossible at all if we keep schemas.ts untouched, forcing us to misuse an existing action (e.g., `"member-removed"` for revocation — semantically wrong).

Sprint 3.0.6's W8 noted explicitly: *"Audit-log enum sanity check: no changes needed — view-policy is read-only by design (no state mutation, no audit entries)."* Implying enum extension IS the normal mechanism when needed; 3.0.6 just didn't need it. Sprint 3.6 does.

**Same tension for `InviteSchema.revoked`:** test specs assert `oldInvite?.revoked === true`, but `InviteSchema` has no such field. Cleanest workaround: revoke = delete-from-active-list, no schema field needed; test asserts `oldInvite === undefined` and the audit log captures the revocation.

**Recommended resolution (pending user confirmation):**

Amend C10 to allow scoped additive enum entries on `AuditEntrySchema.action` only. Specifically:

```diff
- 10. **No schema changes shipped.** `src/schemas.ts` is untouched. Sprint 3.6 is purely additive at every layer except response formatting.
+ 10. **No schema changes shipped beyond additive audit-action enum entries.** The only permitted `src/schemas.ts` edit is appending new string literals to `AuditEntrySchema.action`'s `z.enum([...])` array (specifically: `"invite-revoked"`, `"magic-link-viewed"`). All other schemas (FamilyConfig, Child, Member, Invite, Achievement, Savings, Policy) are untouched. Sprint 3.6 is otherwise purely additive at every layer except response formatting.
```

This matches the precedent set by every prior sprint that added a new audit-bearing action (Sprint 3.0 v4 added 5 entries, Sprint 3.0.2 added 4). `InviteSchema.revoked` is NOT added — revocation is implemented as deletion from the active list, no schema field needed.

**Status:** RESOLVED (2026-05-18, Step 0 → Step 2 boundary). User chose `amend_c10`. Contract amended: C10 now explicitly permits the two enum additions only, with verification row updated to assert exactly two added lines in `AuditEntrySchema.action`'s `z.enum([...])` and zero edits elsewhere. `InviteSchema` and all other schemas remain untouched; revocation implemented as deletion from the active invite array.

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

---

## Next session pickup

**Resume at:** **W7.2 production validation** (deploy → run **V1–V6** checklist in *Production validation plan* below). Optional polish: **`walkthroughs/*.gif`** (W1.1) + device smoke (W1.5).

**Where we left off:** **432 passing + 1 skipped**; [`README.md`](../README.md) reflects Sprint 3.6.

**Facts that differ from old plan stubs:** Setup codes resolve via [`SetupCodeStore`](../src/identity/setup-codes.ts) (`data/setup-codes.json`). `view-my-link` audit uses `details.setupFingerprint` — never persists plaintext `SETUP-*`.

**Quirks:** Prefix shell with `cd /Users/juanisaac/Desktop/cursor-allowmeOpenWallet/AllowMeOWS &&` for vitest/tsc.

**Don't:** Narrow structured JSON fields behind markdown-only payloads; regress SC1/QR/recovery/rich-card/modal/client-detection suites.
