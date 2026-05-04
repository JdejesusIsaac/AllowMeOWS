# AllowanceAgent — plan.md (Sprint 3.0 — Trimmed, v4)

## What Changed in v4

This revision swaps the authentication primitive from World ID (IDKit standalone, orb/device verification, nullifier uniqueness) to **Sign-in-with-Base** (SIWE via Base Account's `wallet_connect` provider method, viem signature verification, wallet-address-as-identity).

The pivot is motivated by four things:

1. **Sybil resistance was ahead-of-need.** No external party funds AllowanceAgent treasuries today. A sybil attacker creates N families and divides their own money — there is no economic attack surface to defend. Sybil becomes load-bearing only when paymaster sponsorship lands in Sprint 4.0, at which point we'll make a deliberate decision about how to defend it (rate limiting + Coinbase Verifications layered on top is the leading candidate, but explicitly punted to 4.0).
2. **Coherence with the rest of the stack.** AllowanceAgent runs on Base. OWS custodies on Base. viem signs and broadcasts on Base. Sign-in-with-Base completes the all-Base story. World ID was an outside primitive grafted on; Base Account is native.
3. **CDP Ambassador alignment.** This pivot is materially better leverage on the relationship Juan already has with Coinbase than World Foundation grant pipeline access would have been.
4. **Forward compatibility with Sprint 4.0 Approach A.** Sprint 4.0 (post-pilot scaling) commits to Coinbase Smart Wallet as the family treasury, with the parent's Base Account as the owner/signer. Sprint 3.0 binding wallet addresses to Members via SIWE means the same wallet that authenticates in 3.0 becomes the treasury signer in 4.0 — no second auth flow, no second key bind, clean continuity.

The verify page is still the canonical onboarding surface for all five roles. The magic-link MCP URL pattern is unchanged. The Sprint 2.9.1 multi-tenant identity foundation is unchanged. What changes is the *means* by which the verify page authenticates an adult: instead of an IDKit widget popping a World ID proof, a Sign-in-with-Base button pops a Coinbase Wallet (or any Base Account-compatible wallet) signature request.

## What Changed in v2/v3 (preserved for context)

v2 introduced setup-code-as-magic-link (verify page injects `?setup=` into the displayed MCP URL), optional non-verified onboarding for adults, and rotation flow for expired codes — fixing the April 28 Angelica Co-parent session-2-lockout bug.

v3 added Decision 13: Learner verify-page invite-only flow, making the verify page handle all five roles uniformly. Sofia at 8 redeems her invite via the same surface her parents use, just without the IDKit widget.

v4 keeps everything v2/v3 added at the verify-page UX layer. The only thing that changes is what the "adult auth" path looks like underneath.

## Feature Summary

Sprint 3.0 v4 ships:

- **Sign-in-with-Base** for Manager, Co-parent, and Family roles via the verify page. One click, one signature popup, wallet address bound to Member.
- **A single static verify page** that handles all five roles: adult roles authenticate via SIWE, Learner/Advisor authenticate via invite-only redemption.
- **Magic-link MCP URLs** as the universal handoff: every successful onboarding (whether SIWE-authenticated, invite-redeemed, or inline-bootstrapped) ends with a copy-paste-able `https://allowme.dev/mcp?setup=SETUP-XXXX-XXXX` URL that works across multiple Claude sessions.
- **Recommendation B family bootstrap:** when a wallet signs in with no `?invite=` and is not a known Member, the verify page exposes a guided "create your family" form (name, kids, weekly budgets, categories, savings %) that calls a new `/api/configure-family` endpoint. The endpoint is a thin web wrapper around the existing `configure-policy` tool logic, with the same per-family OWS vault initialization. Output is a magic-link URL bound to the freshly-created Manager.
- **Setup code rotation via re-sign-in:** a returning user revisits `/verify`, signs in with the same wallet, gets a fresh 30-day code bound to their existing Member (no duplicate Member created).

The distribution channel pivots from "orb-verified parents at Success Academy events" to **"Coinbase-Wallet-onboarded parents at Success Academy events"** — Coinbase does the hard mobile-onboarding work (passkey setup, recovery, fiat onramp), AllowMe takes the user from "I have a Base Account" to "I have a working Claude+AllowanceAgent session" in three clicks.

What's not in scope: smart wallet treasury (Sprint 4.0 Approach A), spend-permission delegation (Sprint 4.0), paymaster sponsorship (Sprint 4.0), AgentKit (Sprint 3.5+), sybil defense (Sprint 4.0 paymaster decision), World Foundation grant pipeline (deferred indefinitely or recovered in Sprint 4.0+ if pilot data warrants).

## Problem Statement

Three problems frame Sprint 3.0 v4:

1. **Onboarding UX at scale (adults).** The verify page magic-link UX from v2/v3 is correct. The question is what authentication primitive sits underneath. World ID required users to find an orb (or device-verify, but device-verification UX is its own friction). Sign-in-with-Base requires users to have a Base Account, which is a smaller-friction prerequisite than orb access — Coinbase Wallet is one App Store download, the entire onboarding is mainstream-app-shaped, and a meaningful share of NYC charter-school families already have Coinbase accounts from prior fintech exposure.

2. **Identity primitive coherence.** Sprint 2.9 left `Member.walletAddress` as an optional field with a comment marking it for x402/aixyz use. With World ID, that field continued to be vestigial — World ID nullifiers were the real identity anchor. With Sign-in-with-Base, `walletAddress` becomes the *primary* identity index, the field that `resolveCallerRole` resolves against, the field that ties one human across multiple sessions, devices, and (in Sprint 4.0) the field that's added as a signer on the family treasury Smart Wallet.

3. **Onboarding UX at scale (kids).** Unchanged from v3. Kids don't have wallets and shouldn't. Learner role stays invite-code-only via verify page Decision 13.

The verify page solves (1) via SIWE for adults, (2) via wallet-address binding, and (3) via the unchanged invite-only flow for kids.

## Architecture Decisions

### 1. OWS stays — hybrid architecture (Option B) — unchanged from v3
**Decision:** OWS continues to handle custody for Sprint 3.0. Treasury, savings vault, gift fund, child wallets all created and managed inside the per-family `data/families/{familyId}/.ows/` vault (Sprint 2.9.1 hotfix). Sprint 4.0 migrates to Coinbase Smart Wallet treasury with parent's Base Account as signer; Sprint 3.0 does not change the custody layer.
**Why:** Custody and authentication are orthogonal. Sprint 3.0 changes auth. Custody refactor is Sprint 4.0 work and depends on pilot data + paymaster economics.

### 2. No Mini App frontend — static HTML + Base Account SDK only — revised from v3
**Decision:** Single static HTML page at `https://allowme.dev/verify`. Loads `@base-org/account` as ESM via CDN (esm.sh or jsdelivr). Vanilla JS, no React, no build step, no Next.js, no Vercel. Custom-styled "Sign in with Base" button matching Base [Brand Guidelines](https://docs.base.org/base-account/reference/ui-elements/brand-guidelines).
**Why:** The React-only `@base-org/account-ui` button component would force adopting React for the verify page, which conflicts with v2/v3's "single static HTML file" decision. Going vanilla with a brand-compliant custom button keeps the page footprint small and the deployment surface trivial — same Express static-file pattern Sprint 2.9.1 already uses.
**Spike required:** Confirm `@base-org/account` loads as ESM via `https://esm.sh/@base-org/account` (or equivalent CDN) without a bundler. ~30-60 minute spike, blocking. If ESM CDN doesn't work, fallback is a small esbuild step that bundles `@base-org/account` into `/public/verify-app.js` — still one HTML page, just one extra build artifact. Either way, no React.

### 3. Distribution channel — Coinbase-Wallet-onboarded parents at partnered schools — revised from v3
**Decision:** Pitch AllowanceAgent as the AI-native family financial layer for Coinbase-Wallet-onboarded parents at partnered charter networks (Success Academy pilot). Schools host onboarding sessions where parents who don't yet have a Coinbase Wallet download it during the session, set up their Base Account, and then complete AllowMe verify-page onboarding immediately after.
**Why:** Coinbase Wallet onboarding is *easier* than orb-event onboarding from a user's perspective (App Store download vs find-an-orb), and the Coinbase brand recognition is meaningful in financially-engaged communities. The school-as-distribution thesis survives — it's still a B2B partner pitch — but the prerequisite shifts from "orb infrastructure exists at the school" to "parents have phones and can download an app," which is universally true.

### 4. Wallet-address-as-identity, scoped per family — replaces World ID gating (Decision 4 in v3)
**Decision:** Manager, Co-parent, and Family roles authenticate via Sign-in-with-Base. The wallet address becomes the durable identifier for that Member. Learner and Advisor roles remain invite-code-only with no wallet sign-in step (kids don't have wallets; advisors are read-only and don't need crypto identity). The verify page renders three different flows based on `?role=` query param:
- `manager` (no `?invite=`) → SIWE button → on success, "create your family" form → magic-link URL
- `manager|coparent|family` (with `?invite=CODE`) → SIWE button → invite redemption → magic-link URL
- `learner|advisor` → invite-redemption-only flow, no SIWE → magic-link URL

**Why:** Wallet ownership is the right level of authentication for an adult who's about to be an authority on a family treasury. It's stronger than a setup code (which is a bearer token anyone could intercept) and weaker than World ID (which is proof-of-personhood, overkill for current product needs). Critically, it sets up Sprint 4.0 — the same wallet that authenticates here becomes the signer on the family treasury Smart Wallet later.

### 5. Cross-family Manager is now natively supported
**Decision:** A single wallet address can be a Member of multiple families with different roles (Manager of own family, Co-parent helping a sister's family). Sprint 2.9's research doc punted this to Sprint 3.0 with action namespacing under World ID. With wallet auth, no namespacing is needed — `MemberIndex.listByFamily(walletAddress)` returns all the families this wallet is a member of, and the verify page surfaces a family picker if the count > 1.
**Why:** The v3 nullifier model would have rejected a second Manager registration ("already used" error) and required a per-family-scoped action namespace (`allowme-become-manager-{familyId}`) to support legitimate multi-family Managers. Wallet identity has no such constraint built-in, so the natural model just works. The MemberIndex schema already supports this: `wallet_address` is unique per `(walletAddress, familyId)` tuple, not globally unique.

### 6. Session auth additive — unchanged from v3
**Decision:** Setup code is the durable connector credential. JWT session token only matters for the verify page itself (binds the SIWE-verified browser session to a memberId for the duration of the page interaction, ~10 minutes).
**Setup code expiry policy (simplified from v3's six-tier matrix to three tiers):**
- **Wallet-authenticated via verify page:** 30 days, rotatable any time by re-signing in
- **Invite-redemption via verify page (any role):** 30 days
- **Inline bootstrap (`configure-policy` direct call from Claude):** 48 hours
The six-tier expiry matrix in v3 was a consequence of needing to differentiate "verified human via World ID" from "unverified opt-out" — that distinction dissolves when wallet auth is one click and there's no opt-out path.

### 7. Claude remains the only conversational surface — unchanged from v3
**Decision:** Verify page is a pure handoff. No embedded chat. No progress dashboard. No achievement entry. All product surface lives in Claude.

### 8. AgentKit scoped to research only — unchanged from v3
**Decision:** Sprint 3.5+ work. Note: this pivot makes future AgentKit reactivation cleaner because wallet-address-as-identity is the same primitive AgentKit and x402 use.

### 9. Success Academy pilot is real or cut — unchanged from v3
**Decision:** Confirm before any external pitch. If aspirational, reframe pitch honestly as "designed for charter network deployment, no confirmed partner yet."

### 10. Setup code is the magic link, baked into the displayed MCP URL — unchanged from v2/v3
**Decision:** Verify page success state shows `https://allowme.dev/mcp?setup=SETUP-XXXX-XXXX` (full URL, not bare URL). One copy, one paste, working session forever (until expiry).
**Setup code expiry: see Decision 6.**

### 11. Recommendation B: guided family creation on the verify page (NEW in v4)
**Decision:** When a wallet signs in via the verify page with no `?invite=` query param and is not a known Member of any family, the page renders a guided "create your family" form. Form fields mirror the `configure-policy` tool inputs: family name, list of children (name + weekly budget USD + savings %), per-child categories (name + pct, must sum to ≤100%). On submit, POSTs to a new endpoint `/api/configure-family` which calls into the same `configure-policy` logic the MCP tool uses, then issues a setup code bound to the new Manager Member, returns the magic-link URL.
**Why:** Without this, a signed-in stranger has no path forward — the verify page can authenticate them but can't *do* anything with that authentication. The alternatives are: (a) auto-create an empty family and dump them into Claude with a "now configure your family" prompt (loses the guided UX), or (c) reject and force them to start in Claude with `configure-policy` inline (defeats the whole point of the verify page being the canonical onboarding surface). (b) is the right cut.
**Implementation note:** `/api/configure-family` is a thin web wrapper, not a separate code path. It calls the existing internal `configurePolicy` function (extracted from the MCP tool handler into a reusable function) and threads the verify page's session token + SIWE-verified wallet address through as the caller context. The MCP tool surface is unchanged.

### 12. Setup code rotation via re-sign-in — revised from v3
**Decision:** A returning verified user revisits `/verify`, signs in with the same wallet, the backend recognizes the wallet address in MemberIndex, looks up the existing Member, issues a fresh 30-day setup code without creating a duplicate Member. The previous setup code is automatically revoked.
**Why this is simpler than v3:** v3 needed a nullifier-to-Member lookup index because nullifiers were the identity anchor. With wallet addresses, the existing MemberIndex already serves this purpose — `MemberIndex.listByFamily(walletAddress)` returns the (memberId, role, familyId) triples, and the rotation endpoint revokes old codes via `setupCodes.revokeForMember(memberId)` before issuing a new one.

### 13. Learner onboarding via verify page with invite-only flow — unchanged from v3
**Decision:** When the verify page is loaded with `?role=learner` (or `?role=advisor`), the page skips the SIWE button entirely and renders an invite-redemption-only flow. Invite code input (auto-filled from `?invite=`), big "Join family" button, on success same magic-link MCP URL as adult paths. Age-appropriate starter prompt.
**Why unchanged:** Kids don't have wallets and shouldn't. The Learner verify-page flow is auth-primitive-agnostic — it didn't depend on World ID and doesn't depend on Sign-in-with-Base.
**For very young Learners (ages 5–7):** Parent-mediated onboarding. Parent opens verify page on their phone, enters Sofia's invite code, copies the magic-link URL, configures it on Sofia's tablet. Documented user model.
**For older Learners (ages 8+ and teens):** Self-service via the verify page works directly.

### 14. Forward compatibility with Sprint 4.0 Approach A (NEW in v4)
**Decision:** The wallet address bound to a Manager Member during Sprint 3.0 SIWE onboarding is the same wallet that becomes the owner/signer of the family treasury Coinbase Smart Wallet in Sprint 4.0 Approach A. No second auth flow, no second key bind, no migration friction at the auth layer.
**Why:** The cleanest possible handoff between sprints. Sprint 3.0 binds (walletAddress → Member). Sprint 4.0 takes that walletAddress and adds it as a signer on a newly-deployed family treasury Smart Wallet. The user's mental model — "my Coinbase Wallet is my AllowMe identity" — is consistent across both sprints.
**Implementation note:** No code in Sprint 3.0 commits to Sprint 4.0's design choices. The Sprint 4.0 Approach A path is enabled, not pre-built. If Sprint 4.0 ends up choosing Approach B (Base Account as treasury, sub-accounts for kids) instead, the Sprint 3.0 wallet binding still works — just a different downstream consumer.

---

## Implementation Steps

### Workstream W1: Sign-in-with-Base Backend (5 hours)

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| W1.1 | `src/auth/siwe.ts` — SIWE message verification via viem `verifyMessage` (handles ERC-6492 wrapping for undeployed smart wallets automatically) | Low | 30m |
| W1.2 | `src/auth/nonce-store.ts` — in-memory Set with TTL eviction for SIWE nonces. Generate via `randomBytes(16).toString("hex")`. Track issued nonces, reject reuse. | Low | 30m |
| W1.3 | `src/auth/session-tokens.ts` — JWT issuance + validation. Claims: `{ memberId, walletAddress, familyId, role, exp }`. Signing key from new `.session-secret` file (auto-generated if absent, same pattern as `.master-key`). | Medium | 45m |
| W1.4 | Schema: extend `MemberSchema` with `walletVerifiedAt: z.string().datetime().optional()` (tracks last successful SIWE re-auth for rotation policy). `walletAddress` field already exists from Sprint 2 — no migration. | Low | 10m |
| W1.5 | Schema: add `wallet-signed-in`, `wallet-bound-to-member`, `setup-code-rotated-via-wallet-reauth`, `family-created-via-verify-page`, `learner-invite-redeemed-via-verify-page` to `AuditEntrySchema` action enum | Low | 5m |
| W1.6 | HTTP endpoint `GET /api/auth/nonce` — generates nonce, stores in nonce-store with 5-min TTL, returns plaintext | Low | 15m |
| W1.7 | HTTP endpoint `POST /api/auth/verify` — validates SIWE signature, parses nonce from message, deletes nonce from store, looks up MemberIndex by walletAddress, returns JSON: `{ memberId?, families: [{familyId, role}], sessionToken, requiresFamilyCreation: boolean }`. If wallet is unknown, `requiresFamilyCreation: true` and verify page renders the family creation form. | High | 1h |
| W1.8 | HTTP endpoint `POST /api/configure-family` — accepts session token + family config form fields, calls extracted `configurePolicy` logic with the SIWE-verified walletAddress as the new Manager's `walletAddress`, returns magic-link URL with embedded setup code | Medium | 45m |
| W1.9 | HTTP endpoint `POST /api/redeem-invite` — accepts session token (or unauthenticated for Learner/Advisor) + invite code, calls extracted `acceptInvite` logic, threads SIWE-verified walletAddress (if present) onto the new Member, returns magic-link URL with 30-day setup code | Medium | 45m |
| W1.10 | HTTP endpoint `POST /api/rotate-setup-code` — accepts session token (proving fresh SIWE), looks up existing Member by walletAddress, revokes old setup codes, issues new 30-day code, returns magic-link URL | Medium | 30m |
| W1.11 | Update `resolveCallerRole` in `src/middleware/access-control.ts` — add Priority 0 for session token (above existing X-Member-Id Priority 1). Session token validation imports from `src/auth/session-tokens.ts`. Backward-compatible additive change. | Medium | 30m |
| W1.12 | Extract `configurePolicy` and `acceptInvite` core logic from MCP tool handlers into reusable functions in `src/core/` so both the MCP tool surface and the new HTTP endpoints can call them with the same caller-context plumbing | Medium | 45m |

### Workstream W2: Static Verify Page (4 hours)

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| W2.1 | **Spike (BLOCKING):** Confirm `@base-org/account` loads as ESM via `https://esm.sh/@base-org/account` in a static HTML page, calls `wallet_connect` with `signInWithEthereum` capability, returns SIWE message + signature. Test in fresh browser, no extension installed (Coinbase Wallet popup should appear). If ESM CDN works → proceed with vanilla. If not → small esbuild step bundling SDK to `/public/verify-app.js`. | High | 45m |
| W2.2 | `public/verify.html` — single-file HTML with SDK script tag, Tailwind CDN, vanilla JS. Three role-aware initial states: (a) adult-with-no-invite renders SIWE button → on success, family creation form OR rotation/family-picker if known wallet; (b) adult-with-invite renders SIWE button → on success, redeem invite endpoint; (c) Learner/Advisor renders invite-only flow. Common success state: magic-link MCP URL + copy button + role-appropriate starter prompt. | High | 2h |
| W2.3 | Express route `GET /verify` serving `public/verify.html` with Base appName injected. Query params: `?invite=CODE` auto-fills invite code, `?role=manager\|coparent\|family\|learner\|advisor` selects flow. | Low | 30m |
| W2.4 | Update `configure-policy` tool response — when invoked inline by Manager, response includes the inline setup code AND a link to `/verify` for guided onboarding: "Your setup code is SETUP-XXXX-XXXX (48-hour expiry). For a longer-lived 30-day code, visit https://allowme.dev/verify and sign in with your Base wallet." | Low | 30m |
| W2.5 | Update `invite-member` tool response — for all role invites, response includes a verify-page URL the Manager can text/email to the invitee: `https://allowme.dev/verify?invite=SOFI-LEARNER-XYZ&role=learner`. The role and invite code are auto-filled when the invitee opens the URL. | Low | 15m |

**The verify page UX (sketch):**

For `?role=manager|coparent|family` (no `?invite=` and no known wallet):
- Header: AllowMe logo + "Set up your family"
- Body copy: "Sign in with your Base account to create your family economy."
- Primary CTA: Sign-in-with-Base button (brand-compliant)
- On SIWE success → renders "create your family" form inline (recommendation B)
- On form submit → POST `/api/configure-family` → success state with magic-link URL

For `?role=manager|coparent|family` (no `?invite=` but wallet is known to be a Member):
- Header: AllowMe logo + "Welcome back"
- Body copy: "We recognize this wallet. Refreshing your access..."
- Auto-call `/api/rotate-setup-code` after SIWE
- If wallet is a Member of multiple families → render family picker first
- Success state: magic-link URL with rotated 30-day code

For `?role=manager|coparent|family` (with `?invite=CODE`):
- Header: AllowMe logo + "Join {familyName} as {role}"
- Primary CTA: Sign-in-with-Base button
- On SIWE success → POST `/api/redeem-invite` → success state with magic-link URL

For `?role=learner|advisor`:
- Header: AllowMe logo + "Join {familyName} as {role}"
- Invite code input (auto-filled from `?invite=`, editable for manual entry)
- Primary CTA: "Join family" → POST `/api/redeem-invite` (no SIWE)
- No SIWE button visible
- Success state: magic-link URL + age-appropriate starter prompt
  - Learner: "What should I learn today?"
  - Advisor: "Show me the family's recent activity."

For `?role=learner` with no `?invite=`: render the invite code input prominently with copy that says "Get the code from your parent."

Common success state across all flows:
- Big copy-button magic-link URL
- Starter prompt copy-button
- "Add this URL to your Claude connector settings" instructions with screenshot or link to Claude's docs
- Recovery instructions ("If you lose access, return to /verify and sign in with the same wallet")

### Workstream W3: Edge Cases (1 hour)

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| W3.1 | Nonce reuse rejection — `/api/auth/verify` rejects with clear error if nonce was already consumed | Low | 15m |
| W3.2 | Session token expiry handling on verify page — if token expires mid-form, prompt re-sign-in | Low | 15m |
| W3.3 | Multi-family wallet picker — verify page renders family list if `MemberIndex.listByFamily(walletAddress).length > 1` | Medium | 15m |
| W3.4 | Wallet-address case sensitivity — normalize all wallet addresses to lowercase before MemberIndex lookup, store lowercase, compare lowercase. EIP-55 checksums get normalized away at the storage layer. | Low | 15m |

### Workstream W4: Tests (4 hours)

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| W4.1 | SIWE verification unit tests (SI1-SI5) — valid sig, invalid sig, expired nonce, reused nonce, ERC-6492 undeployed wallet | Medium | 45m |
| W4.2 | Nonce store tests (NO1-NO3) — issuance, consumption, TTL eviction | Low | 20m |
| W4.3 | Session token tests (ST1-ST5) — issuance, validation, expiry, claims, revocation on member-removal cascade | Medium | 45m |
| W4.4 | HTTP endpoint tests (HE1-HE7) — `/api/auth/nonce`, `/api/auth/verify` (new wallet, known wallet, invalid sig), `/api/configure-family`, `/api/redeem-invite` (adult and learner paths), `/api/rotate-setup-code` | Medium | 1h |
| W4.5 | E2E magic-link persistence — adults (ML1-ML5) — sign in → magic-link URL → use in Claude → verify connector works across sessions | Medium | 30m |
| W4.6 | E2E learner verify path (LR1-LR4) — unchanged from v3 | Medium | 30m |
| W4.7 | E2E setup code rotation (RT1-RT3) — known wallet revisits `/verify`, gets fresh code, old code rejected, no duplicate Member | Medium | 30m |
| W4.8 | E2E cross-family Manager (CF1-CF2) — same wallet creates two families, both visible in verify page picker, MemberIndex returns both entries | Medium | 20m |
| W4.9 | E2E backward compat (BC1-BC3) — Sprint 2.9.1 setup-code-only path still works, X-Member-Id header still works, all 246 existing tests pass | Low | 20m |
| W4.10 | E2E Claude Desktop integration unchanged (CD1-CD3) | Low | 20m |

**Target new tests:** ~38. **Total after Sprint 3.0 v4: ~284.** Ship floor if execution slips: SI1-SI5 + NO1-NO3 + HE1-HE5 + ML1-ML3 + LR1-LR3 + RT1-RT2 = 22 tests covering the security-critical paths.

### Workstream W5: Demo Prep + Documentation (2 hours)

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| W5.1 | README — "Sign in with Base + School Pilot" section, magic-link onboarding section, Learner onboarding section, Sprint 4.0 Smart Wallet roadmap section, updated architecture diagram | Medium | 45m |
| W5.2 | Demo video (3 min) — see updated script below | Medium | 1h |
| W5.3 | Onboarding documentation — "How to set up your family" walkthrough for non-technical operators (school admins, charter network staff) | Low | 15m |

**Demo video script (3 minutes, v4 update):**
1. **0:00–0:20** — Problem framing: "AI-native family allowance, on-chain, custodial-grade."
2. **0:20–0:40** — Solution framing: "One tap, your Coinbase Wallet becomes your family's authority."
3. **0:40–1:15** — Manager bootstrap: parent on phone visits `/verify` → Sign-in-with-Base popup → SIWE signature → "create your family" form → magic-link URL → paste into Claude → "Set up allowance for the Asencio family." First message in Claude works. No setup code copy-paste, no auth retries.
4. **1:15–1:40** — Co-parent invite: Manager generates Cesar's invite, texts Angelica the verify-page URL, Angelica clicks → Sign-in-with-Base → invite redeemed → magic-link URL → her own working Claude session. Show that her role (`co-parent`) is enforced — she can verify achievements but cannot distribute.
5. **1:40–2:05** — Learner invite: Cesar generates Sofia's Learner invite, sends Sofia (or Sofia's older sibling) the verify-page URL, Sofia opens it on a tablet, redeems invite (no SIWE), gets her own magic-link URL. Opens Claude. "What should I learn today?"
6. **2:05–2:30** — Allowance flow in Claude: Sofia completes a reading achievement, Cesar verifies, distribution happens on-chain. Show Base Sepolia explorer with USDC transfer.
7. **2:30–2:50** — Cross-family Manager demo (NEW for v4): Cesar uses the same Coinbase Wallet to help his sister set up her family. Same wallet, two families, no friction. Show MemberIndex listing both family memberships.
8. **2:50–3:00** — Close: "Sprint 4.0 brings paymaster-sponsored distributions and Coinbase Smart Wallet treasury. Today, the auth foundation."

---

## Time Allocation (Updated for v4)

| Phase | Hours | Focus |
|-------|-------|-------|
| Pre-sprint validation | 0–2 | Confirm Sprint 2.9.1 production state, sanity check |
| Spike (W2.1) | 2–3 | Confirm `@base-org/account` ESM CDN works |
| Core backend (W1) | 3–8 | All 12 backend steps |
| Edge cases (W3) | 8–9 | All 4 steps |
| Tests (W4) | 9–13 | All 10 test suites |
| Static verify page (W2) | 13–17 | HTML with role-aware flows + Express route + tool response updates |
| End-to-end integration test | 17–18 | Full flow: Manager bootstrap → Co-parent invite → Learner invite → cross-family Manager → all four live in Claude |
| Demo + documentation (W5) | 18–20 | Record video, update README |

Sprint 3.0 v4 fits in roughly **20 hours of focused engineering**, down from v3's 26h. The savings come from: dropping IDKit integration (~2h), dropping nullifier subsystem (~3h), dropping action namespacing + Developer Portal registration (~1h), dropping optional-unverified path + recovery code logic (~1.5h), simpler test surfaces (~1.5h). Added: Sign-in-with-Base flow + ESM CDN spike (~3h offset). Net savings: ~6h.

Realistic execution window: 1 focused week or 2-3 weeks part-time.

---

## Dependencies and Risks

| Dependency | Risk | Mitigation |
|------------|------|------------|
| `@base-org/account` SDK loadable as ESM via CDN | Medium | W2.1 spike validates before committing. Fallback is ~30min esbuild bundle step. |
| viem `verifyMessage` handles ERC-6492 wrapping | Low | Documented behavior, version `^2.23.0` confirmed in `package.json`. Quick local test against undeployed Base Account. |
| Coinbase Wallet popup UX on mobile | Medium | Coinbase Wallet has a mature in-app popup flow. Spike confirms via real mobile test (not just simulator). |
| Railway existing deployment | Low | Unchanged pattern — same Express server, new endpoints, new static file. |
| Success Academy partnership | Medium | Confirm before pitch. If aspirational, reframe honestly. |
| Solo execution speed | Medium | Scope fits 20h with buffer. Smaller surface than v3. |
| Setup code rotation breaks Member data | High | Rotation preserves Member identity via walletAddress → MemberIndex lookup, not via duplicate Member creation. Tested in RT1-RT3. |
| Magic-link URL too long | Low | ~50 chars total, well within URL limits across all clients. |
| Cross-family Manager confuses RBAC | Medium | Each `(walletAddress, familyId)` tuple has its own role. `resolveCallerRole` resolves with familyId from session token / setup code, not from wallet alone. Tested in CF1-CF2. |
| Wallet address case sensitivity bugs | Medium | Normalize to lowercase at the storage and comparison layers (W3.4). EIP-55 checksums survive at display only. |
| Sybil attack via cheap wallet creation | **Deferred to Sprint 4.0** | Documented. No paymaster sponsorship in 3.0 means no economic attack surface. Sprint 4.0 paymaster decision will name the sybil defense (rate limiting + Coinbase Verifications likely). |

## Fallback Approaches

- **`@base-org/account` ESM CDN spike fails:** Build esbuild bundle, single artifact at `/public/verify-app.js`. Adds ~30min build setup, no functional difference.
- **Coinbase Wallet popup fails on mobile:** Document fallback to `eth_requestAccounts` + `personal_sign` per Base docs. Less elegant but universally supported across EIP-1193 wallets.
- **viem `verifyMessage` ERC-6492 handling regresses:** Pin to a known-good viem version. Worst case, manually wrap and verify undeployed-wallet signatures via the published ERC-6492 spec.
- **Verify page breaks mid-sprint:** Fall back to setup-code-only inline onboarding (Sprint 2.9.1 behavior). Adults paste setup code into MCP URL manually. Loses NYC-scale story but works for hackathon-scale.
- **Setup code rotation reveals data corruption:** Rotation refuses, surfaces error, requires manual intervention via CLI script.
- **Cross-family Manager surfaces RBAC bugs:** Restrict cross-family in v4 by enforcing one-Manager-role-per-walletAddress globally. Document as known limitation, address in Sprint 3.1.
- **Recommendation B family creation form is too complex:** Defer to inline `configure-policy` (Sprint 2.9.1 behavior) for new Managers. Verify page becomes invite-redemption-only for adults, family creation happens in Claude. Loses some onboarding polish but unblocks ship.

---

## Sprint Contract — Sprint 3.0 v4

### Success Criteria

1. **Sign-in-with-Base works end-to-end via verify page magic-link.** New Manager: visits `/verify`, signs in with Base, fills family creation form, gets magic-link URL, pastes into Claude, calls `check-progress` successfully. Session 1, session 2, session 3 all work without re-auth (within 30-day window).
2. **Co-parent invite flow works via verify page magic-link.** Manager generates invite, Co-parent clicks verify-page URL, signs in with Base, invite redeemed, magic-link URL works in Claude across multiple sessions.
3. **Learner invite flow unchanged from v3:** invite-only redemption, no SIWE, magic-link URL works.
4. **Cross-family Manager works:** same wallet authenticates as Manager of two different families. MemberIndex returns both entries. Verify page picker surfaces choice.
5. **Setup code rotation works:** known wallet revisits `/verify`, gets fresh 30-day code, old code is revoked, no duplicate Member created.
6. **Wallet-address binding is durable:** Member record has `walletAddress` populated and `walletVerifiedAt` timestamp. Future Sprint 4.0 Smart Wallet treasury can use this address as signer.
7. **Legacy backward compat:** Pre-Sprint-3.0 setup-code-only Members continue to function. All 246 Sprint 2.9.1 tests still pass. X-Member-Id header path still works.
8. **Static verify page renders correctly for all five role flows:** manager (no invite, with invite, known wallet) / coparent / family / learner / advisor.
9. **Magic-link MCP URL works on first paste — adult roles:** copy URL from verify page, paste into Claude connector, calls work session 1 through expiry. Tested across iOS Claude app, Android Claude app, Claude Desktop.
10. **Claude Desktop/Mobile integration unchanged:** Sprint 2 auth paths work. Wallet auth path additive.
11. **Deployment extends Sprint 2.9.1 pattern:** Railway backend + new env vars (none required for SIWE — Coinbase Wallet uses standard provider methods) + static file + new endpoints.
12. **Demo video captures critical moments:** Manager Sign-in-with-Base, magic-link UX, Co-parent invite, Learner invite, cross-family Manager, allowance distribution.
13. **Forward-compatible with Sprint 4.0 Approach A:** wallet address bound during 3.0 SIWE is the same address that becomes the family treasury Smart Wallet signer in Sprint 4.0. No second auth flow needed.

### Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| Functionality | 35% | SIWE verification, magic-link URL, family creation form, cross-family Manager, rotation, backward compat |
| Auth/Security | 30% | Nonce reuse rejection, session token validation, wallet-address case-normalization, no plaintext setup code in logs, signature verification correctness, role-scoping preserved through verify-page path |
| Design/UX | 20% | Magic-link UX (one paste), Coinbase Wallet popup integration, age-appropriate Learner flow, family creation form usability, demo video |
| Originality | 15% | All-Base stack coherence, magic-link MCP onboarding pattern, recommendation-B guided family creation, forward-compat Sprint 4.0 wallet handoff, AI-funded family economy framing |

### Grading Thresholds

- **Pass:** All categories ≥ 75%. No category below 70%. Magic-link UX works in demo for both adult and Learner paths. Setup code persists across sessions verified empirically. Wallet-address binding durably stored on every successful SIWE.
- **Fail:** Any category below 70%, OR magic-link demo fails, OR Learner verify path doesn't ship, OR setup code rotation creates duplicate Members, OR existing Sprint 2.9.1 tests regress, OR wallet-address case-sensitivity bug surfaces in production.

### Success Conditions Beyond the Rubric

- Magic-link UX is polished enough to demo to a non-technical operator (charter network admin) and have them complete onboarding without help, for both parent and kid
- Sign-in-with-Base flow completes within ~10 seconds on a mid-range phone with Coinbase Wallet installed
- Verify page total page weight is under 200KB (gzipped) for fast mobile loads
- Cross-family Manager flow demonstrates the cleanest possible "one parent, multiple families" UX in the space — no other family allowance product handles this gracefully

---

## Scope Guard — Explicitly NOT Building in Sprint 3.0 v4

1. Coinbase Smart Wallet treasury (Sprint 4.0 Approach A)
2. Spend-permission delegation (Sprint 4.0)
3. Paymaster-sponsored gas (Sprint 4.0)
4. Sub-account architecture (Sprint 4.0 Approach B, deferred)
5. Mini App / progress dashboard / in-app chat
6. AgentKit / x402 re-integration
7. World ID re-integration as a secondary primitive (deferred to Sprint 4.0+ if grant pitch warrants)
8. WLD payments
9. World Chain USDC
10. Production Mini App directory submission
11. Migration of Sprint 2.9.1 setup-code-only Members to wallet-bound Members (opt-in only — they continue to work via existing setup codes)
12. Legacy Manager World ID upgrade flow (no World ID to upgrade from)
13. Capability differences between wallet-bound and non-wallet-bound Members (no differences in 3.0; future sprints may add)
14. Sybil defense at the auth layer (deferred to Sprint 4.0 paymaster decision)
15. Coinbase Verifications integration (Sprint 4.0+ if needed)
16. CAPTCHA / rate limiting on `/api/configure-family` (Sprint 4.0 if abuse observed; nothing to abuse pre-paymaster)
17. Multi-device sync for verified sessions (each device re-signs separately, magic-link URL handles cross-device anyway)
18. Wallet recovery flow (delegated to Coinbase Wallet's own recovery — AllowMe doesn't custody the wallet, doesn't need to)
19. Parent-defined `learningGoals` task harness (Sprint 3.0.1 work, depends on Learner onboarding shipping first)

---

## Sprint 3.5 Preview (Post-Sprint-3.0 v4, ~Q3 2026)

Assuming Sprint 3.0 v4 ships and pilot data justifies continued investment:

- AgentKit integration for agent-to-agent traffic, using same wallet-as-identity primitive
- AllowanceAgent's signing wallet registered in AgentBook
- Mini App directory submission (production review) — now that the auth story is coherent on Base
- First 50–100 test families onboarded at Success Academy pilot event
- Coinbase Developer Platform grant conversation (CDP Ambassador track)
- Optional Coinbase Verifications layer for "verified humans get extra benefits" framing
- Onboarding flow optimization based on pilot drop-off analytics
- Multi-language verify page (Spanish, given NYC charter demographics)
- Inline `learningGoals` task harness (Sprint 3.0.1 work folded in if not shipped earlier)

Sprint 3.5 is additive polish + ecosystem work. Sprint 3.0 v4 proves the wallet-auth thesis at pilot scale; Sprint 3.5 deepens the Base integration.

---

## Sprint 4.0 Preview (Post-Sprint-3.5, ~Q4 2026 / Q1 2027)

Sprint 4.0 commits to **Approach A** for treasury architecture: family treasury becomes a Coinbase Smart Wallet, parent's Base Account (already bound from Sprint 3.0) is added as the owner/signer, AllowMe registers a session key with bounded spend permissions to execute distributions, paymaster sponsors gas. Postgres replaces filesystem JSON for multi-tenant scaling. OWS becomes keystore-only (or dissolves entirely depending on Smart Wallet integration depth).

The Sprint 3.0 v4 wallet-binding work is the foundation Sprint 4.0 builds on. Every walletAddress in MemberIndex post-3.0 is a candidate for Smart Wallet treasury signer in 4.0.

---

## Migration Notes from v3 → v4

If you have v3 partially implemented:

1. **Drop:** `src/worldid/verify.ts`, `src/worldid/nullifier-store.ts`, IDKit script tag in verify page, World ID Developer Portal app registration, `requiresWorldId` field on InviteSchema, `worldIdNullifier`/`worldIdAction`/`worldIdVerifiedAt` fields on MemberSchema, `recoveryCode` field, `/api/onboard-unverified` endpoint, Optional-unverified path UX in verify page, sybil rejection state in verify page, NS1-NS5 + SB1-SB4 + UV1-UV4 test suites.
2. **Add:** `src/auth/siwe.ts`, `src/auth/nonce-store.ts`, `src/auth/session-tokens.ts`, `walletVerifiedAt` field on MemberSchema (other wallet fields already exist from Sprint 2), Sign-in-with-Base button + flow in verify page, family creation form for recommendation B, cross-family Manager picker, SI1-SI5 + NO1-NO3 + ST1-ST5 + CF1-CF2 test suites.
3. **Modify:** `resolveCallerRole` priority chain (add Priority 0 for session token), `/api/redeem-invite` endpoint (now receives optional walletAddress from SIWE session, threads onto Member), all v3 verify page UX states (replace IDKit logic with SIWE logic, remove opt-out path).
4. **Keep unchanged:** Verify page magic-link success state, Learner invite-only flow, setup code generation/storage, MemberIndex API, MCP tool surface.

Net additional v3 → v4 work: roughly equal (some adds, some drops). Effort scales with how much v3 was implemented before the pivot — if v3 was design-only, v4 is a clean greenfield Sprint 3.0 with no waste. If v3 had IDKit integration started, ~2-3h of code deletion before v4 work begins.

## How to Use This Plan

This document supersedes plan-3.0-trimmed-v3.md. Differences from v3:

- **Auth primitive swapped** from World ID (IDKit + nullifiers) to Sign-in-with-Base (SIWE + wallet addresses)
- **Decision 4 rewritten** as wallet-address-as-identity (was World ID gating)
- **Decision 5 added** (cross-family Manager natively supported)
- **Decision 11 rewritten** as recommendation B family creation form (was optional unverified path)
- **Decision 14 added** (forward compatibility with Sprint 4.0 Approach A)
- **Decision 13 unchanged** (Learner verify-page invite-only flow)
- **W1 grows from 13 to 12 steps** (drops 4 World ID steps, adds 5 SIWE steps, net -1)
- **W2 grows from 4 to 5 steps** (adds W2.1 ESM spike, otherwise structurally similar)
- **W3 grows from 5 to 4 steps** (drops most sybil edge cases, adds wallet case-normalization)
- **W4 shrinks from 13 to 10 test suites** (drops nullifier + sybil + recovery, adds SIWE + cross-family)
- **Time estimate shrinks** from 26h to 20h
- **Success criteria shifts** from 13 World-ID-shaped items to 13 wallet-auth-shaped items
- **Scope guard explicitly defers** sybil defense to Sprint 4.0 paymaster decision

If executing v4: the order is W2.1 (ESM CDN spike, blocking) → W1.12 (extract reusable core logic) → W1.1-W1.11 (SIWE backend) → W3 (edge cases) → W4 (tests) → W2.2-W2.5 (verify page UI) → W5 (demo + docs). Spike-first is critical because if `@base-org/account` doesn't load via ESM CDN, the W2.2 architecture changes meaningfully.

---

## Pre-Sprint Checklist (Pre-Execution)

- [ ] Confirm Sprint 2.9.1 production deployment is healthy (no regressions from prior pivot work)
- [ ] Pull a copy of production `data/` from Railway volume to local machine for migration testing
- [ ] Confirm `@base-org/account` and `@base-org/account-ui` package versions on npm (pin versions in package.json before starting W1)
- [ ] Spike-test `@base-org/account` ESM loadability via esm.sh in a throwaway HTML file (W2.1 prerequisite — can be done before sprint kickoff)
- [ ] Verify viem version `^2.23.0` handles ERC-6492 wrapping in `verifyMessage` correctly (~15min smoke test)
- [ ] Confirm Coinbase Wallet (mobile + extension) handles `wallet_connect` with `signInWithEthereum` capability — manual test in fresh browser
- [ ] Identify Success Academy pilot status: confirmed / aspirational / decided-to-cut-from-pitch
- [ ] Identify any other charter network or B2B partner that could be the demo distribution channel if Success Academy is aspirational

These move to the top of the deployment checklist, blocking Railway production rollout of v4.