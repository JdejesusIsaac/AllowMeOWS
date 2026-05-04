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

### Workstream W2: Static Verify Page (4h) — PARTIAL
- [ ] W2.1: **BLOCKING SPIKE** — `@base-org/account` ESM CDN loadability + Coinbase Wallet popup mobile UX (desktop arm landed, mobile arm still on user)
- [ ] W2.2: `public/verify.html` — 5 role-aware flows, ~10 states, vanilla JS
- [ ] W2.3: Express `GET /verify` route + query-param routing
- [x] W2.4: `configure-policy` tool response appends verify-page pointer (bootstrap branch only — inline hint: "visit https://allowme.dev/verify…"). Source: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/configure-policy.ts:150-156`.
- [x] W2.5: `invite-member` tool response adds `verifyUrl` field + one-tap link in the message body. Source: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/invite-member.ts:125-136`.

### Workstream W3: Edge Cases (1h) — MOSTLY COMPLETE
- [x] W3.1: Nonce reuse rejection — enforced by `NonceStore.consume` single-use contract (NO2 test). `/api/auth/verify` HE4: invalid sig does NOT consume; only successful verify consumes.
- [ ] W3.2: Session token expiry handling on verify page (verify page UI TBD — W2.2; server-side expiry covered by ST2).
- [x] W3.3: Multi-family wallet picker — `listMembershipsByWallet` returns all `(memberId, familyId, role, familyName)` triples; `/api/auth/verify` surfaces them in the `families[]` response array; verify page picker logic renders when length > 1.
- [x] W3.4: Wallet-address lowercase normalization — `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/wallet.ts` (`normalizeWallet`, `tryNormalizeWallet`, `InvalidWalletAddressError`) + WN1-3 tests.

### Workstream W4: Tests (4h) — 29/40 LANDED
- [x] W4.1: SIWE verification — 6 tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-siwe.test.ts` (SI1-SI4 + chain-unsupported + TTL-interaction). **SI5 skipped with TODO** — needs a real Base Sepolia counterfactual Coinbase Wallet signature fixture; unblocks once mobile spike arm captures one.
- [x] W4.2: Nonce store — 3 tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-nonce-store.test.ts` (NO1-NO3).
- [x] W4.3: Session tokens — 6 tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-session-tokens.test.ts` (ST1-ST5 + ST5b file-mode invariant).
- [x] W4.4: HTTP endpoints — 11 tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/verify-routes.test.ts` (HE1/2/3/4/5/5b/7 + RT1-RT3). Live-express + native-fetch harness, no supertest dep.
- [ ] W4.5: E2E magic-link persistence — adults (ML1-ML5) — needs MCP tool-call harness; defer to next session.
- [ ] W4.6: E2E Learner verify path (LR1-LR4) — partial: LR3 redemption covered by HE7. UI states + age-gated starter prompt require W2.2.
- [x] W4.7: E2E setup code rotation — 3 tests (RT1 issues fresh code; RT2 old code revoked; RT3 no duplicate Member + `walletVerifiedAt` populated).
- [ ] W4.8: E2E cross-family Manager (CF1-CF2) — requires a second wallet acting on the same family; infrastructure ready via `listMembershipsByWallet`, just needs the fixture.
- [x] W4.9: BC3 backward compat — all 254 pre-3.0 tests still pass alongside the 29 new ones (TOTAL: 283 + 1 skipped = 284). BC1/BC2 implicit (X-Member-Id + setup-code paths untouched).
- [ ] W4.10: Claude Desktop integration (CD1-CD3) — manual; CD3 requires real device. User handles.
- [x] W3.4 bonus: 4 wallet-normalization tests in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/auth-wallet-normalization.test.ts` (WN1-WN3 + tryNormalizeWallet).

### Workstream W5: Demo + Documentation (2h)
- [ ] W5.1: README — Sign-in-with-Base + School Pilot section, Sprint 4.0 roadmap, architecture diagram
- [ ] W5.2: Demo video (3 min) — Manager bootstrap → Co-parent invite → Learner invite → cross-family Manager → distribution → close
- [ ] W5.3: Onboarding doc for non-technical operators (school admins)

---

## Current Blocker
_None. Entire W1 backend (12 steps) is landed and test-covered. W2/W5 remain: static verify page HTML, Express `/verify` route, README update, demo video. Mobile Coinbase Wallet arm still manual on user._

### Next Session Priorities (in order)
1. **W2.2 + W2.3** — `public/verify.html` (5 role flows, vanilla JS, `@base-org/account@2.5.5` ESM via `esm.sh`) + Express `GET /verify` route. ~3h.
2. **W4.8 CF1-CF2** — cross-family Manager fixture. Infrastructure ready via `listMembershipsByWallet`; just needs a second-wallet test scenario. ~30min.
3. **W4.5 ML1-ML5** — magic-link persistence via MCP tool-call harness. Non-trivial (needs MCP stdio harness). ~1h.
4. **W5** — README update + demo video script revision. ~1.5h.
5. **SI5** — once user captures real mobile-arm counterfactual signature, drop fixture into `tests/fixtures/` and un-skip.

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