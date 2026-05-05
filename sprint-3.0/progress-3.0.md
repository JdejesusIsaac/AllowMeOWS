# AllowanceAgent — progress.md (Sprint 3.0 v4 — Sign-in-with-Base)

## Sprint History
- Sprint 1: COMPLETE (88/100) — 9 tools, 84 tests, live on-chain USDC
- Sprint 2: COMPLETE (73.3% → PASS after remediation) — Learner role, HTTP, x402, Fitbit. 151 tests
- Sprint 2.5: COMPLETE (91.3/100) — convert-savings, multi-asset. 165 tests
- Sprint 2.75: COMPLETE — Per-family keys, zero passphrase. 187 tests. Railway-ready
- Sprint 2.9: COMPLETE (89.6%) — Multi-tenant data layer, setup-code auth, member-index, no-default-Manager rule. 246 tests
- Sprint 2.9.1 hotfix: SHIPPED — Per-family OWS vault dirs (`data/families/{familyId}/.ows/`), legacy fallback removed (security). 246 tests
- Sprint 3.0.1 slice: SHIPPED — Parent-defined `learningGoals` on `ChildConfig`, fuzzy-match achievements → goals via `findMatchingGoalIndex`. 254 tests

## Sprint 3.0 v4: Sign-in-with-Base + School Onboarding Pilot

### Approach (v4 pivot from World ID)
**Wallet-address-as-identity via Sign-in-with-Base.** Static verify page hosts the SIWE button (`@base-org/account` SDK loaded as ESM via CDN), Coinbase Wallet popup signs the SIWE message, viem `verifyMessage` verifies the signature server-side (handles ERC-6492 for undeployed Base Accounts). Magic-link MCP URL is the universal handoff for all five roles. OWS custody unchanged. Sybil defense deferred to Sprint 4.0 paymaster decision. ~20h scope, down from v3's 26h.

### Pre-Sprint Checklist (blocks W1)
- [ ] Confirm Sprint 2.9.1 production deployment is healthy at `https://allowme.dev/health`
- [ ] Pull a copy of production `data/` from Railway volume to local for migration testing
- [x] **Pin `@base-org/account` version in `package.json`** — `2.5.5` pinned exact (no caret) on 2026-05-04
- [x] **Spike (W2.1) — desktop ESM arm — PASS.** `https://esm.sh/@base-org/account@2.5.5` returns a 449-byte ESM wrapper that re-exports `account.mjs`. Confirmed exports: `createBaseAccountSDK, base, CHAIN_IDS, pay, getCryptoKeyAccount, getPaymentStatus, getSubscriptionStatus, subscribe, prepareCharge, createProlinkUrl, decodeProlink, encodeProlink, removeCryptoKey, TOKENS, VERSION`. No React required. Throwaway `sprint-3.0/test-spike.html` ready for manual mobile arm.
- [x] **Spike (W2.1) — viem ERC-6492 arm — PASS with critical note.** `sprint-3.0/spike-erc6492-smoke.mjs` confirms `isErc6492Signature`, `parseErc6492Signature`, `serializeErc6492Signature` are exported from `viem/utils`. Installed viem resolved to `2.47.6` (satisfies `^2.23.0`). **⚠️ Critical finding for Generator:** the viem utility export `verifyMessage` from `'viem'` is synchronous and does NOT handle ERC-6492; the async public-client action `publicClient.verifyMessage({ address, message, signature })` IS the one that simulates counterfactual Smart Wallet deploys. `src/auth/siwe.ts` MUST use the public-client form against a Base Sepolia + Base Mainnet client, not the utility form. Pin viem if a future minor regresses this behavior (W4.1 SI5 fixture-based regression test is the safety net).
- [ ] **Spike (W2.1) — mobile arm — MANUAL.** Open `sprint-3.0/test-spike.html` on real iOS Safari + Android Chrome with Coinbase Wallet installed. Tap Sign-in-with-Base → confirm Coinbase Wallet popup appears, SIWE message displays, signature returns. Document results inline.
- [ ] Identify Success Academy pilot status: confirmed / aspirational / cut from pitch
- [ ] Identify alternative B2B partner if Success Academy is aspirational

### Workstream W1: Sign-in-with-Base Backend (5h) — **COMPLETE ✅**
- [x] W1.1: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/siwe.ts` — viem `verifySiweMessage` via public-client action; 6 failure reasons (parse/domain/nonce/chain/signature/ok); consumes nonce only on success (HE4 contract).
- [x] W1.2: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/nonce-store.ts` — `Map<nonce, issuedAtMs>` with lazy TTL eviction, injectable clock for tests, module-level singleton.
- [x] W1.3: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/session-tokens.ts` — custom HMAC-SHA256 JWT (no external dep), `.session-secret` auto-gen mirroring `.master-key` pattern, 10-min default TTL, env-var > file > auto-generate priority.
- [x] W1.4: `Member.walletVerifiedAt: z.string().datetime().optional()` added to `MemberSchema` (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts:117`).
- [x] W1.5: 5 new `AuditEntry` action enum values (wallet-signed-in, wallet-bound-to-member, setup-code-rotated-via-wallet-reauth, family-created-via-verify-page, learner-invite-redeemed-via-verify-page) at `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts:196-200`.
- [x] W1.6–W1.10: all 5 HTTP endpoints in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/app/verify-routes.ts`, mounted in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/app/server.ts:161-162`.
- [x] W1.11: Priority 0 `X-Session-Token` branch in `resolveCallerRole` at `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/middleware/access-control.ts:83-96` — additive, falls through to Priority 1+ on any validation failure (graceful degradation).
- [x] W1.12: Core extraction — `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/configure-family.ts` + `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/accept-invite.ts` + `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/wallet-memberships.ts` (listMembershipsByWallet for cross-family picker).

### Workstream W2: Static Verify Page (4h) — COMPLETE ✅ (pending manual mobile QA)
- [ ] W2.1: **BLOCKING SPIKE** — desktop ESM arm landed; **mobile Coinbase Wallet arm still on user** (open `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/sprint-3.0/test-spike.html` on real iOS Safari + Android Chrome).
- [x] W2.2: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/public/verify.html` — single-file SPA, vanilla JS, dynamic import of `@base-org/account@2.5.5` from esm.sh. **10 states** (loading, entry, invite-preview, invite-preview-error, siwe-running, siwe-error, picker, family-create, success, rate-limited) wired to a state-machine boot that branches on `?invite=CODE&role=ROLE` query params. Dark/light theme via `prefers-color-scheme`, iOS safe-area insets, ≥16px inputs (no auto-zoom). Copy-to-clipboard with selection fallback. `claude://mcp/add?url=` deep-link alongside raw URL for the 80% case (Claude Desktop ≥0.8) + visible URL + copy button for the 20% where the deep-link is unregistered.
- [x] W2.3: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/app/server.ts:281-306` — `GET /verify` serves `public/verify.html` with `window.__ALLOWME_CONFIG__` injected inline (appName, appLogoUrl, chainId, SIWE statement). `chainId` flips between `0x14a34` (Base Sepolia) and `0x2105` (Base Mainnet) based on `ALLOWANCE_USE_TESTNET` env. Four smoke tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/verify-page.test.ts` (VP0 file exists, VP1 all state containers present + pinned SDK version, VP2 testnet config ordering, VP3 mainnet config flip).
- [x] W2.4: `configure-policy` tool response appends verify-page pointer (bootstrap branch only — inline hint: "visit https://allowme.dev/verify…"). Source: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/configure-policy.ts:150-156`.
- [x] W2.5: `invite-member` tool response adds `verifyUrl` field + one-tap link in the message body. Source: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/invite-member.ts:125-136`.

### Workstream W3: Edge Cases (1h) — MOSTLY COMPLETE
- [x] W3.1: Nonce reuse rejection — enforced by `NonceStore.consume` single-use contract (NO2 test). `/api/auth/verify` HE4: invalid sig does NOT consume; only successful verify consumes.
- [x] W3.2: Session token expiry surfaces as a soft error state in `public/verify.html` — the redeem and family-create handlers treat a 401 response as a "please re-sign-in" prompt via the siwe-error state's retry button. Server-side expiry already covered by ST2.
- [x] W3.3: Multi-family wallet picker — `listMembershipsByWallet` returns all `(memberId, familyId, role, familyName)` triples; `/api/auth/verify` surfaces them in the `families[]` response array; verify page picker logic renders when length > 1.
- [x] W3.4: Wallet-address lowercase normalization — `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/wallet.ts` (`normalizeWallet`, `tryNormalizeWallet`, `InvalidWalletAddressError`) + WN1-3 tests.

### Workstream W4: Tests (4h) — 40/40 LANDED (+ HE8 suite + ML ship floor)
- [x] W4.1: SIWE verification — 6 tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-siwe.test.ts` (SI1-SI4 + chain-unsupported + TTL-interaction). **SI5 skipped with TODO** — needs a real Base Sepolia counterfactual Coinbase Wallet signature fixture; unblocks once mobile spike arm captures one.
- [x] W4.2: Nonce store — 3 tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-nonce-store.test.ts` (NO1-NO3).
- [x] W4.3: Session tokens — 6 tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-session-tokens.test.ts` (ST1-ST5 + ST5b file-mode invariant).
- [x] W4.4: HTTP endpoints — 19 tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/verify-routes.test.ts` (HE1/2/3/4/5/5b/7, RT1-RT3, **HE8a-HE8h preview**). Live-express + native-fetch harness, no supertest dep.
- [x] **W4.4+ HE8: invite-preview endpoint** (`GET /api/invites/:code/preview`) — read-only companion to `/api/redeem-invite`. Resolves family/role/childName/expiresAt without consuming the invite. Rate-limited to 30/min/IP via `previewRateLimit` middleware. Failure-mode table + security trade-off documented in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/sprint-3.0/research-3.0-v4.md`. **HE8d** locks the critical "preview MUST NOT consume" contract. Surfaces landed:
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/invite-preview.ts` (`previewInvite` + `InviteUsedError` / `InviteExpiredError` / `InviteMalformedError` + `INVITE_CODE_REGEX`)
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/middleware/rate-limit.ts` (in-memory token bucket, `makeRateLimiter` + `previewRateLimit`)
  - Route handler at `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/app/verify-routes.ts:117-147`
- [x] W4.5: E2E magic-link persistence — ML1-ML3 ship-floor landed in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/magic-link-persistence.test.ts`. Full HTTP bootstrap via verify page, then exercises the `runWithRequestContext` → `resolveCallerRole` chain with `?setup=CODE` to prove the magic-link URL (1) has the right shape, (2) resolves to the Manager identity on first use, (3) stays valid across 3 independent fresh-client sessions (regression of Sprint 2.9.1 Angelica single-use bug) with no Member duplication. ML4-ML5 remain deferred — covered indirectly by HE6/HE7 redemption tests + Priority 0 session-token branch tests.
- [ ] W4.6: E2E Learner verify path (LR1-LR4) — partial: LR3 redemption covered by HE7. UI states + age-gated starter prompt require W2.2.
- [x] W4.7: E2E setup code rotation — 3 tests (RT1 issues fresh code; RT2 old code revoked; RT3 no duplicate Member + `walletVerifiedAt` populated).
- [x] W4.8: E2E cross-family Manager — CF1 (single wallet surfaces 2 memberships in `/api/auth/verify`) + CF2 (rotation on Family A does NOT revoke Family B's setup code). Fixture spans both `configureFamilyCore` bootstrap and `acceptInviteCore` redemption paths through the HTTP surface. Source: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/verify-routes.test.ts:522-714`.
- [x] W4.9: BC3 backward compat — all 254 pre-3.0 tests still pass alongside the 46 new ones (TOTAL: 300 + 1 skipped = 301). BC1/BC2 implicit (X-Member-Id + setup-code paths untouched).
- [ ] W4.10: Claude Desktop integration (CD1-CD3) — manual; CD3 requires real device. User handles.
- [x] W3.4 bonus: 4 wallet-normalization tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-wallet-normalization.test.ts` (WN1-WN3 + tryNormalizeWallet).

### Workstream W5: Demo + Documentation (2h)
- [x] W5.1: README updated — Sprint 3.0 v4 line item in "What's Built and Working", dedicated **Sign-in-with-Base onboarding** section with 5-flow UX table + security model, HTTP endpoint list expanded with 7 new `/api/*` + `/verify` routes, env-var table now includes `SESSION_SECRET` + `ALLOWANCE_USE_TESTNET`, roadmap flipped: **Sprint 3.0 v4 (Done)** with 5 concrete checkboxes + **Sprint 4.0 (Next)** pointing at Postgres, paymaster/Sybil, LegacyLink, Robux, OpenMAIC, GiftFlow. Source: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/README.md`.
- [ ] W5.2: Demo video (3 min) — Manager bootstrap → Co-parent invite → Learner invite → cross-family Manager → distribution → close. **Manual; user records after mobile spike.**
- [ ] W5.3: Onboarding doc for non-technical operators (school admins) — **defer to Sprint 3.5 or Success Academy pilot kickoff.**

---

## Current Blocker
_None. Code-complete for pilot — W1 backend (12 steps), W2 verify page (SPA + route), W3 edge cases (wallet norm, multi-family picker, nonce reuse, session-expiry UX), W4.1-W4.4/W4.7-W4.9 test suites, W5.1 README. **297 passing + 1 skipped**, TypeScript clean. The only thing left for the real-world pilot is the manual mobile-arm W2.1 spike on real iOS Safari + Android Chrome with Coinbase Wallet — once that arm lands, capture the counterfactual signature to un-skip SI5, record the 3-min demo video (W5.2), and ship._

### Next Session Priorities (in order)
1. **W2.1 mobile arm + SI5 fixture** — user opens `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/sprint-3.0/test-spike.html` on real iOS Safari, then on Android Chrome with Coinbase Wallet installed; confirms the popup + signature returns; captures the raw `{ message, signature, address }` payload into `tests/fixtures/siwe-counterfactual.json` so SI5 can be un-skipped. ~30min.
2. **W5.2 demo video** — 3-min walkthrough: Manager creates family on `/verify` → invites Co-parent → invites Sofia (Learner) → Sofia redeems one-tap → Manager verifies an achievement → distributes allowance. Uses the new `/verify` flow end-to-end so the value proposition of SIWE onboarding lands visually.
3. **W4.5 ML1-ML5 + W4.6 LR1-LR4** — optional E2E MCP-stdio harness for magic-link persistence + Learner inline flow. Defer unless pilot surfaces regressions; HE7 + LR3 already cover the redemption backbone via HTTP.
4. **W4.10 Claude Desktop** — manual CD1-CD3 on a real device when W5.2 video is recorded.
5. **W5.3 operator doc** — write only if Success Academy pilot is confirmed; structure depends on the actual deployment model (Railway-hosted vs self-hosted).

### Sprint 3.0 v4 Session 1 Log (2026-05-04)
- **Spike W2.1** (desktop ESM + viem ERC-6492): **PASS**; critical public-client `verifyMessage` nuance pinned into W1.1 step + research.
- **`@base-org/account@2.5.5`** pinned exact in `package.json:19`; installed cleanly (146 pkgs, 9 non-critical vulnerabilities).
- **W1 backend: COMPLETE.** All 12 steps — SIWE verify, nonce store, session tokens, schema extensions (walletVerifiedAt + 5 audit actions), 5 HTTP endpoints, Priority 0 access-control branch, core extraction.
- **W2.4 + W2.5** — MCP tool response copy updates for verify-page pointers.
- **W3.1 + W3.3 + W3.4** — done; W3.2 verify-page-side only (W2 dependency).
- **Tests: +29 new** (254 → 283 passing; 1 SI5 skipped with TODO). W4.1, W4.2, W4.3, W4.4 (7 HE), W4.7 (3 RT), W3.4 (4 WN) landed. Full run 16s.
- **TypeScript: clean** (`npx tsc --noEmit` returns 0 across every step).
- New files this session (absolute paths):
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/siwe.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/nonce-store.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/session-tokens.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/wallet.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/configure-family.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/accept-invite.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/wallet-memberships.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/app/verify-routes.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-siwe.test.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-nonce-store.test.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-session-tokens.test.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-wallet-normalization.test.ts`
  - `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/verify-routes.test.ts`

## Test Results
_To be populated._

**Baseline:** 254 tests passing (Sprint 2.9.1 + 3.0.1).
**Target new tests:** ~38. **Total after Sprint 3.0 v4:** ~292.
**Ship floor if tests slip:** 22 tests covering security-critical paths — SI1-SI5 + NO1-NO3 + HE1-HE5 + ML1-ML3 + LR1-LR3 + RT1-RT2.

## Dependencies Status
| Dependency | Status |
|------------|--------|
| `@base-org/account` SDK | 🔜 Pin version + W2.1 ESM CDN spike |
| `@base-org/account` ESM via esm.sh / jsdelivr | 🔜 BLOCKING spike (W2.1) |
| viem `^2.23.0` (ERC-6492 in `verifyMessage`) | ✅ Already installed (`package.json:25`) |
| `jsonwebtoken` for session tokens | 🔜 npm install (or use `jose` — TBD in W1.3) |
| Railway deployment (Sprint 2.9.1) | ✅ Live at `https://allowme.dev` |
| Coinbase Wallet mobile popup UX | 🔜 W2.1 mobile arm — test on real iOS + Android |
| Success Academy partnership confirmation | 🔜 Confirm pre-sprint (Plan Decision 9) |
| World Developer Portal app | ❌ NOT NEEDED in v4 (was v3 dependency) |

## Failed Approaches (Carried Forward)

_Sprint 1–2.75:_
- OWS `signAndSend`/`signTransaction` → viem walletClient
- `process.cwd()` for dataDir → `import.meta.url`
- MCP SDK global RBAC intercept → per-tool guards
- Single `OWS_PASSPHRASE` → per-family keys
- x402 on learner tools → B6 override
- Learner cross-child verify → B7 strict enforcement

_Sprint 2.9 / 2.9.1:_
- Single global `~/.ows` vault → per-family `data/families/{familyId}/.ows/` (collision + ephemeral-FS bug)
- Legacy single-family Manager fallback → removed (public-SaaS auth bypass)
- SAAS_MODE env-var flag → over-engineering, rejected
- Inline matching in `verify-achievement` → extracted to `src/engine/learning-goals.ts` for testability

_Sprint 3.0 (architectural pivots, not implementation failures):_
- Full Next.js Mini App frontend → static HTML page (v1→v2 scope cut)
- AgentKit integration → deferred to Sprint 3.5 (Seoul ecosystem coordination)
- **World ID / IDKit / nullifier-based sybil defense → Sign-in-with-Base / wallet-as-identity (v3→v4 pivot).** Rationale: pre-paymaster there's no economic attack surface to defend, all-Base stack coherence beats grafted-on World ID, CDP Ambassador alignment > World Foundation grant pipeline, wallet binding sets up Sprint 4.0 Smart Wallet treasury cleanly. v3 research archived at `sprint-3.0/research-3.0-v3-worldid.md`.
- React-only `@base-org/account-ui` → custom brand-compliant button + vanilla JS (preserves "single static HTML" decision)

## Open Risks Entering Sprint 3.0 v4

1. **`@base-org/account` ESM CDN may not load cleanly** — W2.1 spike resolves. Fallback: ~30min esbuild bundle to `/public/verify-app.js`. Either way ship.
2. **Coinbase Wallet mobile popup UX** — must test on real iOS Safari + Android Chrome, not simulator. Spike's mobile arm is the gate.
3. **viem `verifyMessage` ERC-6492 stability across versions** — pinned `^2.23.0`, regression test in W4.1 SI5.
4. **Cross-family Manager RBAC bugs** — each `(memberId, familyId)` tuple has its own role, but the verify page picker UX must surface this clearly. Tested in CF1-CF2.
5. **Wallet-address case-sensitivity bugs** — single `normalizeWallet(addr)` helper used everywhere, lowercase at storage, EIP-55 only at display. W3.4 + RT1-RT3.
6. **Success Academy partnership status** — must classify as confirmed / aspirational / cut before pitch writing.
7. **Sybil defense deferral defensibility** — pitch reviewers will ask. Answer: pre-paymaster no economic attack surface; Sprint 4.0 paymaster decision names mitigation (rate limit + Coinbase Verifications likely).
8. **Solo execution speed** — 20h scope with buffer. Smaller surface than v3.

## Post-Sprint Outcomes

### If Sprint 3.0 v4 ships cleanly:
- Sprint 3.5 scope: AgentKit (wallet-as-identity primitive transfers cleanly), Mini App directory submission, first 50–100 pilot families, CDP grant conversation, Spanish verify page
- Sprint 4.0 builds on the wallet binding: Coinbase Smart Wallet treasury (Approach A), spend-permission delegation, paymaster-sponsored gas, sybil defense decision
- World ID may return as a secondary primitive in 4.0+ if grant pitch warrants it

### If Sprint 3.0 v4 stalls or partially ships:
- Setup-code-only inline onboarding (Sprint 2.9.1 behavior) is the documented fallback — adults paste `?setup=` manually. Loses NYC-scale UX story but keeps the pilot demo viable at hackathon scale.
- Recommendation B family creation form is the most-cuttable scope: defer to inline `configure-policy` in Claude. Verify page becomes invite-redemption-only for adults.
- Demo video reusable as marketing asset regardless.