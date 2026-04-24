# AllowanceAgent — test.md (Sprint 3.0 — Trimmed)

**Target new tests: ~35.** Cut from 70 in the full plan by removing E2E scenarios that validated the Next.js Mini App UI. Architectural and security tests preserved. Ship floor: 22 tests covering the critical path.

## Unit Tests: World ID Verification (Unchanged)

| # | Test | Expected | Category |
|---|------|----------|----------|
| WI1 | Valid proof with correct action returns nullifier | `verifyWorldIdProof(validProof, "allowme-become-manager")` → `{ verified: true, nullifier_hash, action }` | Functionality |
| WI2 | Invalid proof signature rejected | Tampered proof → throws `InvalidProofError` | Auth/Security |
| WI3 | Wrong action rejected | Proof for action A, verified with action B → `{ verified: false }` + clear error | Auth/Security |
| WI4 | Missing `WORLD_APP_ID` env var returns graceful error | `verifyWorldIdProof(...)` with no env → throws "World ID not configured" | Design/UX |
| WI5 | Network failure to Developer Portal returns clear error | Mock fetch fails → throws "Could not reach World ID verifier" | Design/UX |
| WI6 | Verification level enforced | Manager action requires `orb`. Proof with `device` level rejected. | Auth/Security |

## Unit Tests: Nullifier Store (Unchanged)

| # | Test | Expected | Category |
|---|------|----------|----------|
| NS1 | Record new nullifier succeeds | Stored in `data/world-id-nullifiers.json` under correct action namespace | Functionality |
| NS2 | Detect already-used nullifier | `isNullifierUsed(nullifier, action)` returns `true` after record | Auth/Security |
| NS3 | Revoke nullifier removes from store | `revokeNullifier()` → `isNullifierUsed()` returns `false` | Functionality |
| NS4 | Different actions maintain independent namespaces | Nullifier X under action A; `isNullifierUsed(X, "B")` returns `false` | Auth/Security |
| NS5 | Concurrent writes atomic | Two parallel `recordNullifier()` with same nullifier+action → one succeeds, one throws | Auth/Security |

## Unit Tests: Invite + Accept with World ID (Unchanged)

| # | Test | Expected | Category |
|---|------|----------|----------|
| IA1 | Manager invite auto-sets `requiresWorldId: true` when WORLD_APP_ID set | `invite-member(role: "manager")` → `invite.requiresWorldId === true` | Functionality |
| IA2 | Learner invite does not set `requiresWorldId` regardless of env | `invite-member(role: "learner")` → `invite.requiresWorldId === false` | Functionality |
| IA3 | Accept without proof when required fails | Manager invite without worldIdProof → "World ID verification required" | Design/UX |
| IA4 | Accept with valid proof succeeds and stores nullifier | Member created with `worldIdNullifier`, `worldIdVerifiedAt`, `worldIdAction` | Functionality |
| IA5 | Accept with already-used nullifier rejected | Same human, second Manager invite, same nullifier → sybil error | Auth/Security |
| IA6 | Accept with wrong action nullifier rejected | Proof for `allowme-become-coparent` used in Manager invite → rejected | Auth/Security |
| IA7 | WORLD_APP_ID unset: Manager invite works without World ID | Backward compat — invite.requiresWorldId === false | Functionality |

## Unit Tests: HTTP Endpoints

| # | Test | Expected | Category |
|---|------|----------|----------|
| HE1 | `/api/worldid/verify` with valid proof returns nullifier + session | POST valid proof → 200, `{ verified: true, nullifier_hash, sessionToken }` | Functionality |
| HE2 | `/api/worldid/verify` with invalid proof returns 400 | POST tampered proof → 400, `{ error: "Invalid proof" }` | Auth/Security |
| HE3 | `/api/worldid/verify` rate limited | 10+ rapid requests → 429 on 11th | Auth/Security |
| HE4 | `/api/worldid/verify` with used nullifier returns 409 | Sybil attempt → 409 + `{ error, existingRole }` for UX state | Auth/Security |
| HE5 | `GET /verify` serves HTML with WORLD_APP_ID injected | Response body includes `app_id: 'app_actual_id_value'`, not placeholder | Functionality |

## Unit Tests: Session Middleware (Unchanged)

| # | Test | Expected | Category |
|---|------|----------|----------|
| SM1 | Valid session token resolves to Member + role + childName | `Authorization: Bearer <valid>` → correct CallerContext | Functionality |
| SM2 | Expired session token rejected | Token past `expiresAt` → falls through to next priority | Auth/Security |
| SM3 | Invalid session signature rejected | Tampered token → falls through to next priority | Auth/Security |
| SM4 | Session path is additive to X-Member-Id | Both present → session wins. Only X-Member-Id → Sprint 2 unchanged. | Functionality |
| SM5 | stdio mode ignores session (irrelevant locally) | stdio call with session in args → default Manager | Functionality |

## Unit Tests: Schema Backward Compat (Unchanged)

| # | Test | Expected | Category |
|---|------|----------|----------|
| SC1 | Legacy Member without worldId fields loads | Sprint 2.75 members.json parses, worldIdNullifier === undefined | Functionality |
| SC2 | Legacy Invite without requiresWorldId loads | Sprint 2 invites.json parses, requiresWorldId === false | Functionality |
| SC3 | Existing Sprint 2.75 data/ loads without errors | Full server start with Sprint 2.75 data → all 187 existing tests still pass | Functionality |

---

## E2E Tests (TRIMMED — Mini App E2Es removed)

### E2E-S3-1: Verify Page Handoff to Claude (REPLACES original E1-E8)

**Setup:** Fresh Railway deployment. `WORLD_APP_ID` set. Static verify page live at `/verify`.

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| VH1 | Open `https://allowme.dev/verify` in browser | HTML page renders, IDKit widget script loaded, button visible | Functionality |
| VH2 | Trigger IDKit verification (mocked in test harness, real in demo) | World ID proof returned to client | Functionality |
| VH3 | Client POSTs proof to `/api/worldid/verify` | Backend validates via Developer Portal (mocked), returns session + "success-manager" state | Functionality |
| VH4 | Page renders success state with MCP URL + starter prompt | DOM shows "Step 1: Add to Claude" with copy button and "Step 2: Say to Claude" starter | Design/UX |
| VH5 | Click copy button on MCP URL | Clipboard contains `https://allowme.dev/mcp` | Design/UX |
| VH6 | Click copy button on starter prompt | Clipboard contains starter prompt text | Design/UX |
| VH7 | User (in separate Claude session) adds MCP connector + says starter prompt | Claude calls `configure-policy`, family created, wallets provisioned | Functionality |
| VH8 | Verify session token used in configure-policy authenticates correctly | Session → Member → Manager role resolved, tool call succeeds | Auth/Security |

### E2E-S3-2: Sybil Rejection (Unchanged — Critical Demo Scenario)

**Setup:** Human A already registered as Manager of Family 1. Nullifier `0xabc...` stored under `allowme-become-manager`.

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| SB1 | Human A opens second browser, navigates to `/verify` | Page loads normally | Functionality |
| SB2 | Human A triggers IDKit, same World ID, same action | Same nullifier returned |  Functionality |
| SB3 | Client POSTs to `/api/worldid/verify` | Backend detects nullifier already used → 409 + `{ error, existingRole: "manager" }` | Auth/Security |
| SB4 | Page renders sybil state with recovery instructions | "This World ID is already registered as a Manager. Ask current Manager to remove you first." | Design/UX |

### E2E-S3-3: Cross-Role Legitimate Use (Kept — Validates Action Namespacing)

**Setup:** Human A is Manager of their own family. Human A's parent (another user) wants to add Human A as Co-parent to help verify grandkids' achievements.

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| XR1 | Family B's Manager (Human A's parent) calls `invite-member` with role "co-parent" | Invite generated, `requiresWorldId: true`, action: `allowme-become-coparent` | Functionality |
| XR2 | Human A opens `/verify?invite=FAMILY-COPRT-XYZW&role=coparent` | Page loads with Co-parent context, device-level verification | Functionality |
| XR3 | Human A triggers IDKit with action `allowme-become-coparent` | Different nullifier than their Manager nullifier (different action namespace). Accepted. | Auth/Security |
| XR4 | Backend creates Member with role "co-parent" in Family B | Human A can verify achievements in both families independently | Auth/Security |

### E2E-S3-4: Legacy Manager Backward Compat (Unchanged — Critical)

**Setup:** Restore Sprint 2.75 backup data (Member with no worldId fields). Deploy Sprint 3.0 code on top.

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| LM1 | Server starts with legacy data | Startup log: "N legacy managers without World ID verification." No crash. | Functionality |
| LM2 | Legacy Manager calls `check-progress` via Claude (Sprint 2 `X-Member-Id` header) | Tool succeeds, returns progress report. No World ID check triggered. | Functionality |
| LM3 | Legacy Manager calls `distribute-allowance` | Succeeds. USDC transfer completes. Full authority preserved. | Functionality |
| LM4 | Legacy Manager invites new Co-parent | New invite has `requiresWorldId: true` (WORLD_APP_ID now set). Co-parent acceptance requires verification. | Functionality |

### E2E-S3-5: Claude Desktop Sprint 2 Regression Guard (Unchanged — Critical)

**Setup:** Sprint 3.0 server running. Claude Desktop with existing Sprint 2 config.

| Step | Action | Assertion | Category |
|------|--------|-----------|----------|
| CD1 | Claude Desktop calls `configure-policy` via stdio transport | Works identically to Sprint 2.75 | Functionality |
| CD2 | Claude Desktop calls `configure-policy` via HTTP transport with `X-Member-Id` header | Works identically to Sprint 2.75. No session auth required. | Functionality |
| CD3 | Full Sprint 2.75 test suite runs against Sprint 3.0 code | 187 tests pass. Zero regressions. | Functionality |

---

## Tests CUT from the Full Plan (Explicit)

The following tests from the original Sprint 3.0 test plan are removed and documented as deferred or unnecessary:

- **Full Mini App onboarding E2E (original E1-E8, 8 tests)** — replaced by E2E-S3-1 above (VH1-VH8). Same critical-path coverage, no React-specific assertions.
- **Co-parent invitation full flow (original CP1-CP8, 8 tests)** — architectural coverage exists in IA1-IA7 (unit) and XR1-XR4 (E2E). The 8-step narrative flow is demo-able but not separately testable in a 48h window.
- **10 edge cases (original EC1-EC10)** — critical edge cases covered by unit tests (WI4, WI5, NS5, IA6). Non-critical edges (EC3 no-World-App user, EC9 no-Claude-user, EC10 app ID change) are UX copy tests, not architectural. Document in user-facing copy instead of test suite.

Net: 70 tests (full) → 35 tests (trimmed). Ship floor: 22 tests.

---

## Test Count Summary

| Suite | Count |
|-------|-------|
| World ID verification (WI1-WI6) | 6 |
| Nullifier store (NS1-NS5) | 5 |
| Invite + accept with World ID (IA1-IA7) | 7 |
| HTTP endpoints (HE1-HE5) | 5 |
| Session middleware (SM1-SM5) | 5 |
| Schema backward compat (SC1-SC3) | 3 |
| E2E: Verify page handoff (VH1-VH8) | 8 |
| E2E: Sybil rejection (SB1-SB4) | 4 |
| E2E: Cross-role legitimate (XR1-XR4) | 4 |
| E2E: Legacy Manager backward compat (LM1-LM4) | 4 |
| E2E: Claude Desktop regression (CD1-CD3) | 3 |
| **Sprint 3.0 new tests (trimmed)** | **54** |
| **Carried from Sprint 2.75** | **187** |
| **Total after Sprint 3.0** | **241** |

Note: I budgeted ~35 in the plan-trimmed summary but the explicit count lands at 54 because several "tests" are really one-assert checks combined into suites (e.g., NS1-NS5 are trivially short). Effective engineering time stays at 4 hours — the assertions are small.

**Ship floor (if execution slips):** 22 tests covering the critical path:
- WI1-WI6 (World ID verify correctness) — 6
- NS1-NS5 (nullifier uniqueness) — 5
- IA1-IA5 (invite flow with World ID) — 5
- SB1-SB3 (sybil rejection demo) — 3
- CD1-CD3 (no Sprint 2 regressions) — 3

---

## Test Execution Strategy 

**Hours 0–3 (pre-sprint):** Sprint 2.75 validation with wife (19-step test from prior conversation). If bugs surface, fix before proceeding.

**Hours 3–5 (spikes):** Spike 1 (IDKit end-to-end) + Spike 2 (session auth). Must complete cleanly before building W1.

**Hours 5–12 (core backend):** WI1-WI6, NS1-NS5, IA1-IA7, HE1-HE5, SM1-SM5 written as each W1 step lands.

**Hours 12–14 (sybil + backward compat):** SC1-SC3. Run full Sprint 2.75 suite to confirm no regressions.

**Hours 14–18 (tests + verify page):** VH1-VH8 (E2E after W2 ships), SB1-SB4, XR1-XR4, LM1-LM4, CD1-CD3.

**Hours 18–22 (buffer/integration):** End-to-end smoke test of the full flow. Record demo video if tests are green.

**Hours 22–26 (demo + submission).**

**Hours 26–48 (buffer):** Slack for real debugging, demo re-records, pitch polish.

If execution slips past hour 18 with tests missing, drop to ship floor (22 tests) and proceed to demo prep. The 22-test floor is enough to credibly claim "working, tested, sybil-resistant World ID integration."