# AllowanceAgent — test.md (Sprint 3.0 v4 — Sign-in-with-Base)

**Target new tests: ~40.** Aligned to plan-3.0 v4 workstream W4. v3 World-ID-shaped suites (WI / NS / IA / SB / UV) replaced with v4 SIWE-shaped suites (SI / NO / ST / CF / RT). v3 sybil-defense E2E suite cut (sybil deferred to Sprint 4.0 paymaster decision). v3 unverified-path UV suite cut (no opt-out path in v4). Ship floor: 21 tests covering security-critical paths. Baseline before this sprint: **254 tests** (Sprint 2.9.1 + 3.0.1).

> **Provenance:** v3 World-ID-shaped test plan archived at `sprint-3.0/test-3.0-v3-worldid.md.bak`. v4 pivots to SIWE per plan-3.0 v4.

## Unit Tests: SIWE Verification (W4.1)

Validates `src/auth/siwe.ts` — viem `verifyMessage` wrapper that handles ERC-6492 transparently for undeployed Base Accounts.

| # | Test | Expected | Category |
|---|------|----------|----------|
| SI1 | Valid signature with matching nonce + domain verifies | `verifySiwe(message, signature, expectedDomain, expectedNonce)` → `{ ok: true, walletAddress: "0xabc..." (lowercase) }` | Functionality |
| SI2 | Tampered signature rejected | Modify one byte of signature → `{ ok: false, reason: "invalid-signature" }`. No throw — graceful failure for handler. | Auth/Security |
| SI3 | Wrong domain rejected | SIWE message claims `evil.com`, verifier expects `allowme.dev` → `{ ok: false, reason: "domain-mismatch" }` | Auth/Security |
| SI4 | Stale nonce rejected | SIWE message references a nonce already evicted from `nonce-store` → `{ ok: false, reason: "nonce-invalid" }` | Auth/Security |
| SI5 | Undeployed Base Account (ERC-6492-wrapped sig) verifies | Counterfactual smart-wallet fixture; `verifyMessage` simulates deploy bytecode and returns true. Regression test against viem version regression. | Auth/Security |

## Unit Tests: Nonce Store (W4.2)

Validates `src/auth/nonce-store.ts` — in-memory `Set<string>` with TTL eviction. Replay-attack defense.

| # | Test | Expected | Category |
|---|------|----------|----------|
| NO1 | `issue()` returns 16-byte hex nonce + persists in store | `nonceStore.issue()` returns string of length 32; subsequent `has(nonce)` → `true` | Functionality |
| NO2 | `consume()` is single-use | First `consume(nonce)` → `true`; second `consume(nonce)` → `false`. Replay defense. | Auth/Security |
| NO3 | TTL eviction removes nonce after 5 min | Use fake timer, advance 5 min + 1ms, then `has(nonce)` → `false` and `consume(nonce)` → `false` | Auth/Security |

## Unit Tests: Session Tokens (W4.3)

Validates `src/auth/session-tokens.ts` — short-lived JWTs binding the SIWE-verified browser session to a `(memberId?, walletAddress, familyId?, role?, exp)` claim set.

| # | Test | Expected | Category |
|---|------|----------|----------|
| ST1 | Valid issuance + validation roundtrip | `issue(claims)` → token string; `validate(token)` → claims; addresses lowercase | Functionality |
| ST2 | Expired token rejected | Token with `exp` in the past → `validate` returns `null` (graceful — `resolveCallerRole` falls through to Priority 1+) | Auth/Security |
| ST3 | Tampered token rejected | Modify payload bytes → `validate` returns `null`. HMAC signature catches tampering. | Auth/Security |
| ST4 | Claim shape preserved | `validate(issue({ memberId, walletAddress, familyId, role }))` returns identical fields | Functionality |
| ST5 | `.session-secret` auto-generates on first boot if absent | Delete `data/.session-secret`, instantiate manager → file created with 0o600 mode, contains 32+ bytes of entropy. Mirrors `.master-key` pattern. | Auth/Security |

## Unit Tests: HTTP Endpoints (W4.4)

| # | Test | Expected | Category |
|---|------|----------|----------|
| HE1 | `GET /api/auth/nonce` returns plaintext nonce + 5-min TTL | 200, body is a hex string, `nonceStore.has(nonce)` is `true` | Functionality |
| HE2 | `POST /api/auth/verify` with new wallet returns `requiresFamilyCreation: true` | Wallet not in MemberIndex → `{ memberId: null, families: [], sessionToken, requiresFamilyCreation: true }` | Functionality |
| HE3 | `POST /api/auth/verify` with known wallet returns family list | Wallet in MemberIndex → `{ memberId, families: [{familyId, role}, ...], sessionToken, requiresFamilyCreation: false }` | Functionality |
| HE4 | `POST /api/auth/verify` with invalid sig returns 400 | Tampered signature → 400 + `{ error: "invalid-signature" }`. Nonce NOT consumed (so user can retry). | Auth/Security |
| HE5 | `POST /api/configure-family` creates family + returns magic-link URL | Valid session token + form data → family created in `data/families/{familyId}/`, OWS vault initialized at `data/families/{familyId}/.ows/`, response includes `mcpUrl: "https://allowme.dev/mcp?setup=SETUP-XXXX-XXXX"` | Functionality |
| HE6 | `POST /api/redeem-invite` works for adult invite (with session token) | Valid session token + valid invite → Member created with SIWE-verified `walletAddress`, magic-link URL returned, 30-day setup code | Functionality |
| HE7 | `POST /api/redeem-invite` works for Learner invite (no session token) | No `Authorization` header + valid Learner invite → Member created with no `walletAddress`, magic-link URL returned, 30-day setup code | Functionality |

## E2E: Magic-Link Persistence — Adults (W4.5)

Validates that the SIWE → magic-link → Claude flow produces a setup code that survives multiple Claude sessions within the 30-day window.

| # | Test | Expected | Category |
|---|------|----------|----------|
| ML1 | Manager bootstrap end-to-end via verify page | Visit `/verify` → SIWE-mocked sign-in → fill family creation form → submit → response includes magic-link URL ending `?setup=SETUP-XXXX-XXXX` | Functionality |
| ML2 | Magic-link URL works on first paste in fresh client | Use the URL as MCP connector → call `check-progress` → returns Manager-scoped data (not "no caller identity") | Functionality |
| ML3 | Magic-link URL works on a second session in a fresh client (regression of Sprint 2.9.1 Angelica bug) | Disconnect + reconnect with same URL → tools still work | Auth/Security |
| ML4 | Co-parent invite via verify page produces working magic-link | Manager calls `invite-member(role: "co-parent")`, response includes verify-page URL → Co-parent (different wallet) opens, signs in, redeems → magic-link URL works in Claude | Functionality |
| ML5 | Co-parent role enforcement preserved through verify-page path | Co-parent calls `verify-achievement` (allowed) and `distribute-allowance` (denied) → RBAC behaves identically to inline-onboarded Co-parent | Auth/Security |

## E2E: Learner Verify Path (W4.6)

Carried forward from v3 unchanged — Learner flow is auth-primitive-agnostic, didn't depend on World ID and doesn't depend on SIWE.

| # | Test | Expected | Category |
|---|------|----------|----------|
| LR1 | Manager creates Learner invite, verify-page URL generated | `invite-member(role: "learner", childName: "Sofia")` returns invite code AND verify-page URL `https://allowme.dev/verify?invite=SOFI-LEARNER-XYZ&role=learner` | Functionality |
| LR2 | Verify page with `?role=learner&invite=X` renders invite-only flow | DOM has invite input pre-filled, NO Sign-in-with-Base button, "Join family" button visible | Functionality |
| LR3 | Learner completes verify-page redemption (no SIWE) | `POST /api/redeem-invite` with valid invite, no session token → Member created with role `"learner"`, no `walletAddress`, magic-link URL returned, success state renders | Functionality |
| LR4 | Learner uses magic-link URL across multiple Claude sessions | Connector with `?setup=` URL → `check-progress` returns Sofia-scoped data on session 1, 2, 3 with no auth errors | Auth/Security |

## E2E: Setup Code Rotation (W4.7)

| # | Test | Expected | Category |
|---|------|----------|----------|
| RT1 | Returning known wallet visits `/verify` → fresh code issued | Wallet already in MemberIndex; SIWE → `POST /api/rotate-setup-code` → response includes new magic-link URL with new setup code (different from old) | Functionality |
| RT2 | Old setup code is revoked after rotation | Old `?setup=SETUP-OLD-CODE` URL returns "no caller identity" / fails RBAC after rotation. New code works. | Auth/Security |
| RT3 | Rotation does NOT create duplicate Member | Before: 1 Member with this wallet. After rotation: still 1 Member. `MemberIndex.listByWallet(addr).length === 1`. `walletVerifiedAt` updated. | Functionality |

## E2E: Cross-Family Manager (W4.8)

| # | Test | Expected | Category |
|---|------|----------|----------|
| CF1 | Same wallet creates two families, both visible in MemberIndex | Wallet W signs in, creates Family A as Manager. Same wallet later signs in (or invited as Co-parent to Family B), redeems. `MemberIndex.listByWallet(W)` returns 2 entries with different `(memberId, familyId, role)` triples. | Functionality |
| CF2 | RBAC scoped per-family — Manager rights in Family A do NOT leak to Family B | Same wallet, Manager of A, Co-parent of B. Setup code scoped to Family A → calls Family-B-only tool path → rejected (or returns Family A data, never Family B). `resolveCallerRole` resolves with familyId from setup code, never from wallet alone. | Auth/Security |

## E2E: Backward Compat (W4.9)

Sprint 2.9.1 + 3.0.1 paths must continue to work alongside the new SIWE path.

| # | Test | Expected | Category |
|---|------|----------|----------|
| BC1 | Pre-Sprint-3.0 setup-code-only Member continues to function | Member created in Sprint 2.9 with no `walletAddress` → setup code via `?setup=` query → tools work, `walletVerifiedAt` is undefined (no migration forced) | Functionality |
| BC2 | X-Member-Id header path still works | Sprint 2 client sends `X-Member-Id: <id>` (Priority 1) → resolved correctly. Priority 0 session-token branch is additive, doesn't break Priority 1. | Functionality |
| BC3 | All 254 Sprint 2.9.1 + 3.0.1 tests still pass against Sprint 3.0 v4 code | `npx vitest run` exits 0, count is 254 + new Sprint 3.0 v4 tests, zero pre-existing regressions | Functionality |

## E2E: Claude Desktop Integration (W4.10)

| # | Test | Expected | Category |
|---|------|----------|----------|
| CD1 | Claude Desktop via stdio transport — unchanged | Tool calls via stdio mode work identically to Sprint 2.9.1. No SIWE flow involved. | Functionality |
| CD2 | Claude Desktop via HTTP transport with `?setup=` URL — unchanged | Setup-code-in-URL flow preserves Sprint 2.9.1 behavior end-to-end | Functionality |
| CD3 | Claude Mobile (iOS + Android) magic-link URL works on first paste | Paste full magic-link URL into Claude Mobile connector settings → tools work in Claude conversation. Manual / smoke test, not automated. | Functionality |

---

## Tests CUT from v3 (Explicit Provenance)

Per plan-3.0 v4 Migration Notes:

- **WI1-WI6 (World ID verify) — CUT.** No World ID in v4. Replaced by SI1-SI5 (SIWE verification).
- **NS1-NS5 (Nullifier store) — CUT.** No nullifiers in v4. Replaced by NO1-NO3 (nonce store, smaller surface — no per-action namespacing required).
- **IA1-IA7 (Invite + accept with World ID) — CUT.** Coverage subsumed by HE6 (adult invite-redemption with SIWE) + HE7 (Learner invite-redemption without SIWE) + LR1-LR4 (Learner E2E).
- **SB1-SB4 (Sybil rejection E2E) — CUT.** Sybil defense deferred to Sprint 4.0 paymaster decision (Plan Decision 14, Scope Guard #14). Rationale: pre-paymaster, no economic attack surface.
- **UV1-UV4 (Unverified-path / opt-out) — CUT (was v3 only).** v4 has no opt-out path; Decision 11 was rewritten as Recommendation B family creation form. Family-creation form coverage lives in HE5.
- **XR1-XR4 (Cross-role legitimate use via action namespacing) — REPLACED.** Same scenario, different mechanism. Wallet identity has no per-action namespacing constraint, so the flow simplifies. New coverage: CF1-CF2.
- **VH1-VH8 (Verify page handoff to Claude — World ID flavor) — REPLACED.** New coverage: ML1-ML5 (magic-link persistence for adults — same critical path, SIWE-shaped).
- **LM1-LM4 (Legacy Manager World ID backward compat) — REPLACED.** v4 has no "legacy World ID Manager" concept. Backward-compat focus shifts to Sprint 2.9.1 setup-code-only Members. New coverage: BC1-BC3.

Net delta from v3 → v4 test plan: ~54 v3 tests → ~40 v4 tests. Smaller surface, same critical-path coverage, sybil deferred honestly.

---

## Test Count Summary

| Suite | Workstream | Count |
|-------|-----------|-------|
| SIWE verification (SI1-SI5) | W4.1 | 5 |
| Nonce store (NO1-NO3) | W4.2 | 3 |
| Session tokens (ST1-ST5) | W4.3 | 5 |
| HTTP endpoints (HE1-HE7) | W4.4 | 7 |
| E2E magic-link — adults (ML1-ML5) | W4.5 | 5 |
| E2E Learner verify path (LR1-LR4) | W4.6 | 4 |
| E2E setup code rotation (RT1-RT3) | W4.7 | 3 |
| E2E cross-family Manager (CF1-CF2) | W4.8 | 2 |
| E2E backward compat (BC1-BC3) | W4.9 | 3 |
| E2E Claude Desktop (CD1-CD3) | W4.10 | 3 |
| **Sprint 3.0 v4 new tests** | | **40** |
| **Carried from Sprint 2.9.1 + 3.0.1** | | **254** |
| **Total after Sprint 3.0 v4** | | **294** |

> Note: plan-3.0 v4 budgeted "~38" — the explicit count lands at 40 because HE expanded from 5 to 7 to cover the three distinct invite-redemption code paths. Effective engineering time stays at 4 hours (W4 budget).

**Ship floor (if execution slips):** 21 tests covering security-critical paths:
- SI1-SI5 (SIWE verification correctness, ERC-6492) — 5
- NO1-NO3 (nonce replay defense) — 3
- HE1-HE5 (auth/nonce + auth/verify x3 + configure-family) — 5
- ML1-ML3 (magic-link persistence — bootstrap, fresh client, second session) — 3
- LR1-LR3 (Learner invite generation + invite-only render + redemption) — 3
- RT1-RT2 (rotation issues new code, old code revoked) — 2

Ship-floor justification: SI + NO covers signature-verification correctness; HE5 (configure-family) covers Recommendation B; ML covers the canonical adult flow; LR covers the kid flow; RT covers rotation correctness. Anything below this floor is not a credible "working, tested, wallet-bound auth integration."

---

## Test Execution Strategy (v4 — 20h sprint)

**Hour 0 (pre-sprint):** Confirm Sprint 2.9.1 production health (`https://allowme.dev/health`). Pull production `data/` snapshot for migration testing. Pin `@base-org/account` version in `package.json`.

**Hours 0–2 (W2.1 BLOCKING spike):** Throwaway `test-spike.html` loads `@base-org/account` via `https://esm.sh/@base-org/account`. Confirm `wallet_connect` with `signInWithEthereum` capability triggers Coinbase Wallet popup on real iOS Safari + Android Chrome. **Block W1 until this passes** — if ESM CDN fails, switch to esbuild bundle path before W2.2 starts.

**Hours 2–3 (W1.12):** Extract `configurePolicy` and `acceptInvite` core logic from MCP tool handlers into `src/core/`. Foundation for the new HTTP endpoints. Add a smoke test that the existing MCP tool wrappers still pass (no behavioral change).

**Hours 3–8 (W1.1–W1.11 core backend):** Write SI1-SI5 + NO1-NO3 + ST1-ST5 + HE1-HE7 as each W1 step lands. Test-as-you-go pattern. SI5 uses a counterfactual Base Account fixture to lock down ERC-6492 regression coverage.

**Hours 8–9 (W3 edge cases):** RT1-RT3 + W3.4 wallet-address case-normalization helper test (single test, fold into RT or BC suite — naming TBD during impl).

**Hours 9–13 (W4 E2E):** ML1-ML5, LR1-LR4, CF1-CF2, BC1-BC3, CD1-CD3. Run full suite at hour 13 — must show 254 + 40 = 294 passing.

**Hours 13–17 (W2.2–W2.5 verify page):** Static HTML, role-aware flows, Express route, tool-response copy updates. Real-device manual testing on iOS + Android Coinbase Wallet (CD3 acceptance).

**Hour 17 (full integration smoke):** End-to-end from QR scan → sign-in → magic-link → Claude tool call. Multi-family scenario (CF1-CF2). Hand to a non-technical operator (school admin proxy) for blind-test feedback.

**Hours 18–20 (W5 demo + docs):** Record 3-min demo video. Update README. Onboarding doc for charter-network ops staff.

**If execution slips past hour 13 with new-test count below ship floor (21):** Drop to ship floor, defer ML4-ML5 + LR4 + CF2 + BC3 + CD3 to Sprint 3.0.1. The 21-test floor is enough to credibly claim "working, tested, wallet-bound onboarding for all five roles, magic-link UX validated, no regressions in existing 254 tests."