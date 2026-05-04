# AllowanceAgent — research.md (Sprint 3.0 v4 — Sign-in-with-Base)

> **Provenance:** v3 research (World ID / IDKit / nullifier-based) archived at `sprint-3.0/research-3.0-v3-worldid.md`. v4 pivots to Sign-in-with-Base (SIWE via Base Account, wallet-address-as-identity). Sybil defense deferred to Sprint 4.0 paymaster decision.

## Phase 0a: Problem Framing

### Problem Statement

Sprint 2.9.1 + 3.0.1 shipped a multi-tenant production-ready system: 254 tests, per-family OWS vault directories, setup-code auth (`SETUP-XXXX-XXXX` embedded in MCP URL), member-index for global ID resolution, no-default-Manager auth rule, parent-defined `learningGoals` curriculum tracking. The system is live at `https://allowme.dev` and successfully isolates families end-to-end.

Three problems remain:

1. **Onboarding UX at scale (adults).** Setup codes work but require manual URL surgery — copy `SETUP-XXXX-XXXX`, append `?setup=` to the MCP URL, paste into Claude. Acceptable for technical users; ~50% drop-off step at non-technical scale. The April 28 Angelica Co-parent session-2-lockout bug (Sprint 2.9.1) confirmed this empirically.

2. **No coherent identity primitive.** `Member.walletAddress` is an optional field labeled for x402/aixyz use that has been vestigial since Sprint 2. Setup codes give identity but they're bearer tokens — anyone who intercepts one impersonates the bearer. There is no durable cryptographic identity binding for a Manager who's about to be an authority on a family treasury.

3. **No forward path to Sprint 4.0 Smart Wallet treasury.** Sprint 4.0 (Approach A) commits to Coinbase Smart Wallet as the family treasury with the parent's Base Account as owner/signer. Without binding wallet addresses to Members in 3.0, every parent would face a second auth flow in 4.0 to declare which wallet should own their treasury.

Sprint 3.0 v4 solves all three by adopting **Sign-in-with-Base** as the adult auth primitive. The verify page is the canonical onboarding surface for all five roles; magic-link MCP URLs are the universal handoff; wallet addresses become the durable identity anchor that survives into Sprint 4.0.

### "What Is" Statement

Sprint 2.9.1's security architecture: `MASTER_KEY` encrypts per-family keys in `data/family-keys.json`; each family key passes to OWS as wallet passphrase. Wallets are encrypted **and physically isolated** in per-family vault directories at `data/families/{familyId}/.ows/` (Sprint 2.9.1 hotfix — wallet-name collisions across families are no longer possible).

Multi-tenancy is enforced end-to-end. A global `MemberIndex` (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/identity/member-index.ts`) maps `memberId → { familyId, role }` with a per-process write lock for concurrent-safety. Setup codes (`SETUP-XXXX-XXXX`) embedded in the MCP URL via `?setup=` identify the caller on every request through `resolveCallerRole` (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/middleware/access-control.ts:70`). The middleware has a 5-priority chain (X-Member-Id header → setup code → `_callerId` arg → `_callerRole`+`_familyId` test mode → null stranger) and reserves an explicit Priority 0 slot for Sprint 3.0 session tokens (comment on line 67-68 of access-control.ts).

The April 24 Sprint 2.9.1 hotfix removed the legacy single-family fallback that used to auto-promote unidentified callers to Manager — public-SaaS auth bypass closed. Five-role RBAC (manager / co-parent / family / advisor / learner) is enforced at the app layer (`withAccessControl`) and OWS policy layer (`allowance-policy.py` with ERC-20 decoding).

MoonPay orchestration is Claude-mediated. HTTP transport supports Claude Mobile + A2A with agent-card discovery. Fitbit OAuth is server-side via one AllowMe LLC developer app. The `aixyz` x402 micropayment gating was removed in preparation for a Base-native flow.

Sprint 3.0.1 added parent-defined `learningGoals` to `ChildConfig` so curriculum is a tracked first-class concept; achievements auto-match goals via prefix-overlap on `(category, topic)` pairs (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/engine/learning-goals.ts`).

All 12 MCP tools work and are multi-tenant aware. The HTTP server is deployed on Railway. viem `^2.23.0` is already a dependency (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/package.json:25`) — same library that will verify SIWE signatures.

What's missing for Sprint 3.0 v4: (a) no `/verify` route on the Express server, (b) no `walletAddress` lookup on `MemberIndex` (only `memberId` lookup exists), (c) no nonce store, no SIWE verification module, no JWT session tokens, (d) `Member.walletAddress` is optional and unset for every existing Member, (e) no extracted "core" function for `configure-policy` / `accept-invite` — the logic lives entirely inside MCP tool handlers and cannot be reused by HTTP endpoints without refactoring.

### Solution Hypothesis

Bind wallet addresses to Members via Sign-in-with-Base (SIWE per EIP-4361, signature verified via viem's `verifyMessage` which transparently handles ERC-6492 wrapping for undeployed smart wallets) on a single static HTML page hosted at `https://allowme.dev/verify`. The verify page becomes the canonical onboarding surface for all five roles:

- **Manager / Co-parent / Family** with no invite → SIWE button → wallet signature → if known wallet, rotate setup code (with multi-family picker if applicable); if unknown, render guided "create your family" form (Recommendation B) → POST `/api/configure-family` → magic-link URL.
- **Manager / Co-parent / Family** with `?invite=CODE` → SIWE button → POST `/api/redeem-invite` (threading the SIWE-verified wallet onto the new Member) → magic-link URL.
- **Learner / Advisor** (with or without `?invite=`) → no SIWE button, invite-code input only → POST `/api/redeem-invite` → magic-link URL with age-appropriate starter prompt.

The architectural unlock (carried forward from v2/v3) is **setup-code-as-magic-link**: the verify page constructs `https://allowme.dev/mcp?setup=SETUP-XXXX-XXXX` on success so users paste *one* URL into Claude instead of (URL + code). Setup codes remain the durable connector credential (30 days post-SIWE for adults, 30 days for invite-redemption via verify page, 48h for inline `configure-policy` from Claude). JWT session tokens only govern the verify page itself — ~10 minute lifetime, binds the SIWE-verified browser session to a `memberId` for the duration of form submission.

OWS custody is unchanged — Sprint 3.0 v4 changes auth, not custody. Sprint 4.0 will migrate the family treasury to a Coinbase Smart Wallet with the parent's Base Account as owner; the wallet address bound in 3.0 is the same address that becomes the 4.0 treasury signer. Clean handoff, no second auth flow.

Cross-family Manager support falls out for free: a single wallet address can be a Member of multiple families with different roles. The existing `MemberIndex` already keys by `memberId` not by wallet, so there's no global-uniqueness constraint to fight. We add a `listByWallet(walletAddress)` method that returns all `(memberId, familyId, role)` triples for a given wallet, and the verify page renders a family picker when the count > 1.

Sybil defense is **deferred to Sprint 4.0**. Pre-paymaster, there is no economic attack surface — a sybil attacker creating N families and dividing their own money is a no-op. Sprint 4.0's paymaster decision will name the sybil mitigation (rate limiting + Coinbase Verifications layered on `/api/configure-family` is the leading candidate). World ID may return as a secondary primitive in Sprint 4.0+ if grant pitch warrants it.

### Scope Boundary

**In scope:**

- SIWE verification backend (`src/auth/siwe.ts`, `src/auth/nonce-store.ts`, `src/auth/session-tokens.ts`)
- Schema extensions: `Member.walletVerifiedAt: z.string().datetime().optional()` and 5 new `AuditEntry` action enum values; `Member.walletAddress` already exists from Sprint 2
- HTTP endpoints: `GET /api/auth/nonce`, `POST /api/auth/verify`, `POST /api/configure-family`, `POST /api/redeem-invite`, `POST /api/rotate-setup-code`
- Priority 0 session-token branch in `resolveCallerRole` (additive, leaves all existing priorities intact)
- Extract reusable `configurePolicy` + `acceptInvite` core logic from MCP tool handlers into `src/core/` so HTTP endpoints can call them with the same caller-context plumbing
- Single static `public/verify.html` (vanilla JS, Tailwind CDN, `@base-org/account` loaded as ESM via CDN — fallback esbuild bundle if CDN load fails the W2.1 spike)
- Custom Sign-in-with-Base button matching Base brand guidelines (no React, no `@base-org/account-ui`)
- `MemberIndex.listByWallet(walletAddress)` for cross-family resolution
- Lowercase normalization of wallet addresses at storage and comparison layers
- Updated README with Sign-in-with-Base + School Pilot section, Sprint 4.0 Smart Wallet roadmap
- Demo video, pitch deck

**Cut from v3 (explicit deletes if v3 was partially implemented):**

- `src/worldid/verify.ts`, `src/worldid/nullifier-store.ts`
- IDKit script tag and any IDKit-specific verify-page state machinery
- World ID Developer Portal app registration, action namespacing
- `Invite.requiresWorldId`, `Member.worldIdNullifier`, `Member.worldIdAction`, `Member.worldIdVerifiedAt`, `Member.recoveryCode` schema fields
- `/api/onboard-unverified` endpoint
- "Continue without verification" / opt-out path UX, recovery-code state, sybil rejection state in the verify page
- Test suites: NS1-NS5 (nullifier store), SB1-SB4 (sybil defense), UV1-UV4 (unverified path)

**Out of scope (Sprint 4.0 or later):**

- Coinbase Smart Wallet treasury (Sprint 4.0 Approach A)
- Spend-permission delegation, paymaster-sponsored gas (Sprint 4.0)
- Sub-account architecture (Sprint 4.0 Approach B, deferred)
- Sybil defense at the auth layer (Sprint 4.0 paymaster decision)
- Coinbase Verifications integration (Sprint 4.0+ if warranted)
- AgentKit / x402 re-integration (Sprint 3.5+)
- World ID re-integration as a secondary primitive (Sprint 4.0+ if grant pitch warrants)
- WLD payments, World Chain USDC
- Postgres migration, Redis caching, S3/R2 vault storage (Sprint 4.0+ scaling work)
- Production Mini App / dashboard / in-app chat
- Migration of pre-3.0 setup-code-only Members to wallet-bound (opt-in only — they keep working via existing setup codes)
- Capability differences between wallet-bound and non-wallet-bound Members (no differences in 3.0)
- Multi-device sync for verified sessions (each device re-signs; magic-link URL handles cross-device)

**Explicitly out of scope:**

- Replacing OWS with Smart Wallet custody mid-sprint
- In-Mini-App chat UI
- Wallet recovery flow (delegated to Coinbase Wallet's own recovery — AllowMe doesn't custody the wallet)
- CAPTCHA / rate limiting on `/api/configure-family` (nothing to abuse pre-paymaster)

---

## Phase 0b: Technical Research

### 1. EIP-4361 — Sign-in-with-Ethereum / Sign-in-with-Base

**What it is:** EIP-4361 standardizes a human-readable message format that a wallet signs to prove control of an address for a specific origin and session. Message structure includes domain, address, statement, URI, version, chain ID, nonce, and issued-at timestamp. The signature is verified server-side; a successful verification means "this wallet controls this address right now, for this nonce, for this origin."

**Sign-in-with-Base** is Coinbase's branding of SIWE invoked through the Base Account provider's `wallet_connect` method with the `signInWithEthereum` capability. Functionally identical to SIWE; the wrapper handles Base Account's specific wallet flow (popup / deep-link to Coinbase Wallet, returns the signed message + signature).

**Relevance for Sprint 3.0 v4:** This is the auth primitive. The verify page calls `wallet_connect`, gets back `{ accounts, message, signature }`, POSTs to `/api/auth/verify`. The server reconstructs the message, verifies the signature, validates the nonce hasn't been reused, and issues a JWT session token bound to the verified wallet address.

**Actionable insights:**

- Nonce **must** be server-issued, single-use, with ≤5-minute TTL. Rejecting reused nonces is the replay-attack defense. Even if a verifying viem signature is correct, a stale nonce signals replay.
- Domain in the SIWE message **must** match the verifying server's expected domain (`allowme.dev` in production, `localhost:3000` for dev) to prevent cross-origin replay.
- Issued-at timestamp should be checked against a reasonable window (5 min) to bound clock-skew attack surface.
- Statement field is user-visible in the wallet popup — use it for clear consent: `"Sign in to AllowMe to manage your family's allowance."`

**Open questions:**

- Does Base Account's `wallet_connect` automatically handle nonce request/response, or does the verify page need to fetch the nonce from `/api/auth/nonce` first and pass it into `wallet_connect`? **Spike (W2.1) confirms this.**
- Is the chain ID in the SIWE message Base Mainnet (`8453`) or Base Sepolia (`84532`) for testnet? **Likely both should be accepted** — wallet authentication is chain-agnostic in spirit even though the field is required.

**Key code references:**

- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/siwe.ts` — to be created. Validates messages via `viem.verifyMessage`.
- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/nonce-store.ts` — to be created. In-memory `Set<string>` with TTL eviction; survives single-process Railway deployment, will need Redis for multi-instance scale (Sprint 4.0+).

### 2. viem `verifyMessage` and ERC-6492 Wrapping

**What it is:** viem's `verifyMessage({ address, message, signature })` returns true if the signature corresponds to the message and address. As of viem `^2.0`, the function transparently handles **ERC-6492** wrapping for undeployed smart wallets — signatures from contract accounts that haven't been deployed yet (counterfactual wallets) are valid via the 6492 envelope, and viem unwraps and validates them automatically by simulating the deploy.

**Why ERC-6492 matters for Base Account:** A user who downloads Coinbase Wallet and creates a Base Account doesn't necessarily have an on-chain deployment until they make their first transaction. Their first SIWE signature happens *before* deployment. Without 6492 support, the signature would fail to verify because the contract doesn't exist on-chain. With 6492, viem simulates the deploy bytecode and validates the signature against the resulting contract state. Sprint 3.0 v4 requires this to work for first-time Base Account users — which will be the entire Success Academy pilot demographic.

**Relevance for Sprint 3.0 v4:** This is the single most-load-bearing dependency. If `verifyMessage` regresses on ERC-6492 handling between viem versions, every first-time Base Account user gets a verification failure on their first sign-in.

**Actionable insights:**

- Pin viem version in `package.json` before W1.1 ships. Current `^2.23.0` is sufficient but a future minor version could regress.
- Add a smoke test (`tests/siwe-erc6492.test.ts` or as part of W4.1 SI1-SI5) that uses a known counterfactual smart-wallet signature fixture. The test catches regressions automatically on every CI run.
- Consider hashing strategy: viem's `verifyMessage` accepts the human-readable message and computes the hash internally. We must pass the **exact** message we expect — any whitespace difference between client-built and server-rebuilt messages causes a hash mismatch. Build the message server-side once, send it to the client, have the client sign that exact bytestring, send the signature back. Don't reconstruct on the server.

**Open questions:**

- Does Base Account's `wallet_connect` return the message text it actually showed the user? **Spike confirms.** If it doesn't, we have a UX-vs-security tension: we can show the user what we plan to ask them to sign, but we can't be 100% sure that's what their wallet displayed.

**Key code references:**

- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/package.json:25` — viem version pin location.
- `node_modules/viem/utils/signature/verifyMessage.ts` — implementation reference for ERC-6492 unwrapping (read-only).

### 3. `@base-org/account` SDK — ESM CDN Loadability (Spike Required)

**What it is:** The Base Account SDK that exposes `wallet_connect` and other Base-specific provider methods. Available on npm as `@base-org/account`. The companion package `@base-org/account-ui` provides a React component for the official Sign-in-with-Base button — but it's React-only.

**Relevance for Sprint 3.0 v4:** Sprint 2.9.1 established "single static HTML file, no React, no build step" as the verify-page architecture. Adopting `@base-org/account-ui` would force adopting React just for the button. Decision 2 in v4 cuts this: load `@base-org/account` as ESM via `https://esm.sh/@base-org/account` (or `https://cdn.jsdelivr.net/npm/@base-org/account/+esm`) directly into the verify page, build a custom button per Base brand guidelines.

**This is a spike-required assumption.** If `@base-org/account` is published with browser-incompatible imports (Node-only deps, missing browser field in package.json) the ESM CDN load fails and we fall back to an esbuild step that bundles the SDK into a single `/public/verify-app.js`.

**Actionable insights:**

- W2.1 spike test:
  1. Create throwaway `test-spike.html` with `<script type="module">import { ... } from "https://esm.sh/@base-org/account@latest"; ...</script>`
  2. Open in fresh Chrome / Safari / Firefox.
  3. Confirm no console errors, exports are accessible.
  4. Call `wallet_connect` — confirm Coinbase Wallet popup appears.
- Pin `@base-org/account` version in package.json before W1 starts so the spike result reflects the production version.
- Document the CDN URL chosen (esm.sh vs jsdelivr) — if esm.sh has reliability issues mid-pilot, switching CDNs should be a 1-line verify-page edit.

**Fallback (if spike fails):** Add `npm run build:verify` script using esbuild to bundle `public/verify-app.ts` → `public/verify-app.js`. Verify page loads `/verify-app.js` instead of CDN. Build artifact committed to git for Railway deploy simplicity (no build step in production).

**Open questions:**

- Does Base Account work the same way in mobile browsers (iOS Safari, Android Chrome) as in desktop browsers, given that Coinbase Wallet on mobile is a separate app and has its own deep-link flow? **Spike confirms — must test on real mobile devices, not just simulator.**

### 4. Base Account `wallet_connect` Provider Method

**What it is:** A non-standard EIP-1193 provider method exposed by Base Account that combines wallet connection + SIWE in a single call. Returns `{ accounts, message, signature }` where the message is the SIWE message that was displayed and signed. Equivalent to calling `eth_requestAccounts` followed by `personal_sign(siweMessage)`, but in one popup.

**Relevance for Sprint 3.0 v4:** This is the UX win. One popup instead of two — single tap, single signature, single popup dismissal.

**Actionable insights:**

- The SDK exposes `provider.request({ method: "wallet_connect", params: [{ ..., capabilities: { signInWithEthereum: { nonce, statement, ... } } }] })`. The `signInWithEthereum` capability is what triggers the SIWE behavior — without it, `wallet_connect` is just a wallet-connect call.
- Pass server-issued nonce into `capabilities.signInWithEthereum.nonce`. The wallet incorporates it into the SIWE message it builds and signs.
- The returned `message` field is the exact text that was signed — pass this verbatim to `verifyMessage` server-side. Do NOT reconstruct the message from individual fields on the server, as discussed in §2.

**Fallback (if `wallet_connect` is broken on a given wallet):** Sequential `eth_requestAccounts` + `personal_sign` flow. Two popups, same end result. Documented as the fallback in the v4 plan's Fallback Approaches section.

**Key code references:**

- `public/verify.html` — to be created. The current `sprint-3.0/verify.html` working draft is World-ID-shaped; v4 rewrites the script section while preserving the success-state UI.

### 5. JWT Session Tokens for Verify-Page Flows

**What it is:** Short-lived JWTs (~10 min) issued by the server after successful SIWE verification. Claims: `{ memberId?, walletAddress, familyId?, role?, exp }`. Used by the verify page to authenticate subsequent calls (`/api/configure-family`, `/api/redeem-invite`, `/api/rotate-setup-code`) without re-signing.

**Relevance for Sprint 3.0 v4:** Bridges the verify page's multi-step flow (sign in → fill form → submit) without forcing a second wallet popup mid-flow. The JWT proves "this browser session was SIWE-verified at time T for wallet W."

**Actionable insights:**

- Sign with HMAC-SHA256 using a secret loaded from `data/.session-secret` (auto-generated on first boot, mirror the `data/.master-key` pattern from Sprint 2.75 family-keys).
- Token lifetime: 10 minutes is enough for the longest verify-page flow (family creation form). Longer than 1 hour starts to weaken the freshness guarantee.
- For unauthenticated Learner/Advisor invite redemption (no SIWE), `/api/redeem-invite` accepts no JWT — the invite code itself is the credential. Distinguish "no JWT" from "invalid JWT" in handler code.

**Open questions:**

- Should JWT include the nonce that produced it, so revoking a nonce also kills downstream JWTs? **No** — JWTs are short-lived enough that nonce-level revocation is overkill. Member-level revocation (kicking a Member out of MemberIndex) is the right granularity.

**Key code references:**

- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/session-tokens.ts` — to be created.
- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/keys/family-keys.ts` — pattern reference for `.session-secret` auto-generation (mirrors `.master-key` flow).

### 6. `MemberIndex` Extension — Wallet-Address Lookup

**What it is:** The Sprint 2.9 member-index (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/identity/member-index.ts`) currently maps `memberId → { familyId, role }` only. Sprint 3.0 v4 needs the inverse: `walletAddress → [{ memberId, familyId, role }]`. One wallet may be Member of multiple families with different roles (Manager of own family, Co-parent helping a sister's family).

**Relevance for Sprint 3.0 v4:** Required for two flows:
1. Sign-in by a known wallet → look up existing memberships → render family picker if count > 1.
2. Cross-family Manager support — one wallet, two `(memberId, familyId)` entries, both legitimate.

**Actionable insights:**

- Implementation option A (simple): add `listByWallet(walletAddress)` that linear-scans the index. Acceptable up to ~10K Members; trivially correct.
- Implementation option B (scalable): maintain a parallel `wallet-index.json` keyed by lowercased wallet address, updated atomically with the main member-index inside the existing `withWriteLock` chain. Faster lookup, more code, more failure modes.
- **Recommend Option A for Sprint 3.0 v4.** Pilot scale (≤500 Members) doesn't justify Option B's complexity. Sprint 4.0 Postgres migration handles scaling concerns.
- All wallet-address comparisons must be lowercased (see §8).

**Open questions:**

- Backfill: existing pre-3.0 Members have no `walletAddress`. They continue to authenticate via setup code (Priority 2). Do we offer them a one-click "bind your wallet" flow once they sign in via verify page? **Yes — covered by the rotation flow (Decision 12). A returning Member who SIWEs with a wallet not yet in their record gets the wallet bound at that moment.**

**Key code references:**

- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/identity/member-index.ts:104` — `listByFamily` is the existing precedent for a list-style lookup; `listByWallet` mirrors its shape.

### 7. `resolveCallerRole` Priority 0 — Session Token Branch

**What it is:** The auth middleware's priority chain currently has 5 priorities (1-5). Sprint 3.0 v4 prepends Priority 0: a session-token header (`X-Session-Token`) issued by the verify page. Same-shape `CallerContext` returned, additive change, leaves all existing priorities untouched.

**Relevance for Sprint 3.0 v4:** Priority 0 is what makes verify-page-issued JWTs work for downstream HTTP endpoints (`/api/configure-family`, etc.) that share the same access-control pipeline as MCP tool handlers. Without it, every HTTP endpoint would have to roll its own auth check.

**Actionable insights:**

- Comment marker for this work already exists at `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/middleware/access-control.ts:67-68`: *"Sprint 3.0 will prepend Priority 0 — session tokens issued by the verify page — pushing setup codes to Priority 2."* The comment is now slightly stale (it says "Priority 2" for setup codes, but they're already Priority 2). The implementation is just adding a new `if (headers["x-session-token"])` block above the existing X-Member-Id check.
- JWT validation imports from `src/auth/session-tokens.ts`. Failed validation falls through to existing priorities (graceful degradation).
- Tests must confirm Priority 0 wins over Priority 1 when both headers are present (proves the precedence ordering).

**Key code references:**

- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/middleware/access-control.ts:79-85` — Priority 1 X-Member-Id branch, immediately after which Priority 0 will be inserted.

### 8. Wallet-Address Normalization — Lowercase at Storage and Comparison

**What it is:** Ethereum addresses can be displayed in two equivalent forms: all-lowercase (`0xabc...`) or EIP-55 mixed-case checksum (`0xAbC...`). The hex bytes are identical; the checksum encodes a self-validating capitalization pattern. Different wallets and explorers display them differently. Comparing without normalization causes bugs.

**Relevance for Sprint 3.0 v4:** Every code path that touches a wallet address — MemberIndex storage, MemberIndex lookup, SIWE verification, audit log entries, JWT claims — must normalize to lowercase before comparison or storage. EIP-55 is for *display*, not for keys.

**Actionable insights:**

- Single helper: `normalizeWallet(addr: string) => string` that returns `addr.toLowerCase()` with input validation (`viem.isAddress`). Use everywhere.
- Storage layer normalizes on write. Comparison layer normalizes both sides on read. Display layer can re-checksum via `viem.getAddress(addr)` if EIP-55 is desired in user-facing output (verify page success state).
- Test coverage: a single test in W3.4 that signs in with one casing and rotates with the other — confirms the same Member is found, no duplicate is created. (`tests/wallet-normalization.test.ts:WN1` or fold into RT1-RT3.)

**Open questions:**

- Audit log readability: do we want lowercase or EIP-55 in `AuditEntry.details.walletAddress`? **Recommend lowercase for consistency** — the audit log is for programmatic queries and forensics, not user-facing display.

### 9. Static Verify Page UX — Five Role Flows in One File

**What it is:** A single `public/verify.html` that renders one of five flows based on `?role=` query param + `?invite=` presence + known/unknown wallet status post-SIWE. Vanilla JS state machine; ~10 distinct UI states.

**Relevance for Sprint 3.0 v4:** This is the user-facing surface. Get this wrong and the entire onboarding pitch falls apart.

**Actionable insights:**

- State machine should be explicit (a single `currentState` variable, `showState(id)` function that hides all and shows one). The current sprint-3.0 v3 working draft (`sprint-3.0/verify.html`) already follows this pattern — preserve the structure, swap out IDKit logic for SIWE logic.
- Five role-aware initial states + verifying state + multiple success states + error state. Total ~10 states (mirrors v3's count, though specific states differ).
- Brand-compliant Sign-in-with-Base button: black background, Base wordmark, specific corner radius and padding per Base UI brand guidelines. Custom CSS, no React, no `@base-org/account-ui`.
- Family creation form (Recommendation B) is the most UX-heavy state — multiple children, dynamic add/remove rows, per-child category percentage validation (must sum to ≤100). Similar to the existing `configure-policy` MCP tool input shape.

**Open questions:**

- Can the family creation form fit on a single mobile screen, or does it need pagination? **Probably pagination for ≥2 children.** Spike with a real form layout test.
- Recovery instruction copy: "If you lose access, return to /verify and sign in with the same wallet." Sufficient? **Yes for 3.0** — wallet recovery is delegated to Coinbase Wallet's own flow.

**Key code references:**

- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/sprint-3.0/verify.html` — current v3 working draft. Will be substantially rewritten for v4 (script section especially) and moved to `public/verify.html`.

### 10. Forward Compatibility with Sprint 4.0 Approach A (Smart Wallet Treasury)

**What it is:** Sprint 4.0 (post-pilot) will deploy a Coinbase Smart Wallet per family as the treasury. The parent's Base Account (the wallet bound during 3.0 SIWE) is added as the owner/signer. AllowMe registers a session key with bounded spend permissions to execute distributions. Paymaster sponsors gas.

**Relevance for Sprint 3.0 v4:** Decision 14 commits to forward compatibility. The walletAddress bound to Manager during 3.0 SIWE *is* the same address Sprint 4.0 hands to the Smart Wallet factory as the initial owner. No second auth flow.

**Actionable insights:**

- No code in Sprint 3.0 should hard-code Sprint 4.0 assumptions. Treat Sprint 4.0 as a downstream consumer that reads `Member.walletAddress` and uses it; the binding contract is "the wallet that authenticates the Manager is the wallet that owns their treasury."
- `Member.walletVerifiedAt` (added in W1.4) timestamps the most recent SIWE, useful for Sprint 4.0 freshness checks ("was this signer verified recently enough to deploy a Smart Wallet for them?").
- If Sprint 4.0 ends up choosing Approach B (Base Account as treasury, sub-accounts for kids) instead of Approach A, the 3.0 wallet binding still works — different downstream consumer, same upstream primitive.

**Open questions:**

- Should Sprint 3.0 emit any specific audit event when wallet binding happens, beyond the generic `wallet-bound-to-member` action? **Recommend including the chain ID** (`base-mainnet` vs `base-sepolia`) in `details` so Sprint 4.0 can filter for Members whose binding is mainnet-ready vs testnet-only. Cheap to add now, useful later.

### 11. Cross-Family Manager — Why It Falls Out for Free

**What it is:** A single human can be Manager of their own family AND Co-parent helping a sister's family AND Family-member of a parent's family — all using the same Base Account / wallet address. v3's nullifier model would have rejected the second registration ("nullifier already used for action `allowme-become-manager`") and required action namespacing per family (`allowme-become-manager-{familyId}`) to support this. Wallet identity has no such constraint.

**Relevance for Sprint 3.0 v4:** Decision 5 elevates this to a first-class supported flow. The verify page renders a family picker if `MemberIndex.listByWallet(walletAddress).length > 1`. RBAC continues to scope per-family because each `(memberId, familyId)` tuple has its own role — `resolveCallerRole` resolves with `familyId` from the session token / setup code, not from wallet alone.

**Actionable insights:**

- Test coverage is critical: CF1 verifies same wallet creates two families and both are listed; CF2 verifies role enforcement is per-family (Manager privilege in family A doesn't leak into family B).
- Setup code rotation must produce a code scoped to a specific `(memberId, familyId)` — not "this wallet's code" globally. The verify page picker chooses which membership the user is acting as for the rotation.
- Audit log should record both family contexts when a cross-family event happens (e.g. cross-family Manager creates a new family — the audit entry lives in the new family's directory but mentions the wallet address).

**Open questions:**

- Verify page picker UX when wallet has 5+ memberships: scrollable list, default to most-recently-active? **Yes — sort by `Member.lastActivity` desc, scrollable list. Pilot scale won't hit this; design ahead.**

**Key code references:**

- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/identity/member-index.ts:104` — `listByFamily` precedent.
- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/middleware/access-control.ts:140` — Priority 4 `_callerRole` + `_familyId` already supports the "explicit familyId selection" pattern; the verify page picker resolves to the same shape.

### 12. Extracted Core Logic — `configurePolicy` and `acceptInvite` as Reusable Functions

**What it is:** Currently `configure-policy` and `accept-invite` exist only as MCP tool handlers (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/configure-policy.ts`, `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/accept-invite.ts`). The `/api/configure-family` and `/api/redeem-invite` HTTP endpoints need the same logic. W1.12 extracts the core into `src/core/configure-family.ts` and `src/core/redeem-invite.ts` as plain functions taking `(input, callerCtx, options)` and returning a result type. Both the MCP tool wrappers and the new HTTP endpoints delegate to these.

**Relevance for Sprint 3.0 v4:** Avoids code duplication. Without extraction, `/api/configure-family` would have to either re-implement family creation (drift risk) or invoke the MCP server internally (architectural mess).

**Actionable insights:**

- Refactor pattern: keep input validation and response formatting in the MCP wrapper; move state mutation + audit log + member-index updates into the core function. The core function is unit-testable in isolation (no MCP server scaffolding required).
- This refactor is also the right time to add explicit return types — currently both tools return `ToolResponse` which is an MCP-specific shape. Core functions return domain types (`{ familyId, memberId, setupCode }` for configure; `{ memberId, setupCode }` for redeem) and the wrappers translate.
- The Sprint 3.0.1 Learning Goals slice already validated this pattern at a smaller scale — `findMatchingGoalIndex` and `mergeLearningGoals` are pure helpers used by both tool handlers and tests.

**Key code references:**

- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/configure-policy.ts:122-204` — `bootstrapFamily` is the bulk of what needs extraction.
- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/accept-invite.ts` — invite-acceptance logic.
- `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/engine/learning-goals.ts` — pattern reference for pure-helper extraction.

### 13. Coinbase Wallet Mobile Popup UX

**What it is:** When the verify page calls `wallet_connect`, the user's Coinbase Wallet on mobile receives a deep-link / push notification, opens the wallet app, displays the SIWE message, user taps approve, control returns to the verify page in the browser with the signature.

**Relevance for Sprint 3.0 v4:** This is the critical UX moment for Success Academy parents — the entire onboarding hinges on this flow being smooth. v4 Plan's risk register flags this as Medium with the mitigation "spike confirms via real mobile test."

**Actionable insights:**

- Spike with both iOS Safari + Coinbase Wallet (iOS) AND Android Chrome + Coinbase Wallet (Android). Don't trust desktop emulation.
- Time the entire flow: tap Sign-in-with-Base button → wallet popup → tap approve → return to verify page → see success state. Target: <10 seconds. v4 Plan's success criteria includes this metric.
- Document fallback: if mobile flow is broken on one OS / wallet combination, document explicitly in `sprint-3.0/known-limitations.md` and route those users to the (non-existent in 3.0, deferred to 3.5) email-link onboarding.

**Open questions:**

- Universal Links / App Links setup for `allowme.dev`: does Coinbase Wallet need the verify-page domain registered to receive return-URL traffic cleanly? **Spike confirms** — likely yes, requires `apple-app-site-association` and `assetlinks.json` files served from `allowme.dev`. May add ~30 min to W2 if needed.

### 14. Sybil Defense — Why It's Deferred (and Why That's Defensible)

**What it is:** v3 made nullifier-based sybil defense the architectural centerpiece. v4 explicitly defers sybil defense to Sprint 4.0. The rationale: pre-paymaster, an attacker creating N fake families and dividing their own money is economically equivalent to creating one family — they're paying their own gas, dividing their own USDC, no one else's funds are involved.

**Relevance for Sprint 3.0 v4:** This is a defensibility issue for the pitch. Reviewers will ask "what stops sybil attacks?" The answer must be confident, not hand-wavy.

**Actionable insights:**

- Sprint 4.0 paymaster decision will name the sybil mitigation. The leading candidates in research order:
  1. **Rate limiting on `/api/configure-family`** — IP-based + wallet-based rate limit, e.g. 1 family per wallet per 24h. Defeats trivial automation.
  2. **Coinbase Verifications layer** — Coinbase publishes attestations for KYC'd users; checking the attestation registry adds a "verified human" gate without adopting World ID.
  3. **Per-family paymaster budget cap** — even if sybil families exist, each one's free gas budget is bounded; attacker scales linearly with cost.
- Document the deferral honestly in pitch materials. "Sprint 3.0 ships the auth layer that makes Sprint 4.0's sybil decision implementable. We've explicitly chosen wallet identity over biometric verification because biometric verification is overkill for the current threat model."

**Open questions:**

- Pre-Sprint 4.0, is there any practical attack we should defend against? **Possibly:** spam family creation to clutter the data volume / fill disk. Mitigation: simple per-IP rate limit on `/api/configure-family` (e.g. 5 / hour) — trivial to add if observed during pilot. Not blocking for ship.

---

## Open Questions Summary

| Question | Where Resolved | Blocking? |
|----------|----------------|-----------|
| Does `@base-org/account` load as ESM via CDN? | W2.1 spike | Yes — blocks W2.2 architecture |
| Does Base Account `wallet_connect` return signed message verbatim? | W2.1 spike | Yes — affects message-rebuild strategy in `verify.ts` |
| Mobile popup UX on iOS + Android Coinbase Wallet | W2.1 spike (mobile arm) | Yes — pilot demo depends on this |
| Universal Links / App Links setup needed? | W2.1 spike (deep-link arm) | Probably (low risk) |
| Does viem `verifyMessage` ERC-6492 handling stay stable across versions? | Pin viem version + smoke test in W4.1 | Yes — first-time Base Account users depend on it |
| Family creation form pagination on mobile? | W2.2 design pass | No — UX polish, not correctness |
| Success Academy partnership status (confirmed / aspirational / cut)? | Pre-sprint check (P-S Checklist) | Yes for pitch framing, not for ship |

## Key Code References — Quick Index

| Area | Path | Notes |
|------|------|-------|
| Existing member-index | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/identity/member-index.ts` | Add `listByWallet` here |
| Existing setup codes | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/identity/setup-codes.ts` | `revokeForMember(memberId)` needed for rotation |
| Existing access control | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/middleware/access-control.ts` | Insert Priority 0 above line 79 |
| Existing schemas | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts` | Add `walletVerifiedAt`; extend `AuditEntrySchema` action enum |
| Existing tool: configure-policy | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/configure-policy.ts` | Extract `bootstrapFamily` core to `src/core/configure-family.ts` |
| Existing tool: accept-invite | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/accept-invite.ts` | Extract core to `src/core/redeem-invite.ts` |
| Existing helper pattern | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/engine/learning-goals.ts` | Reference for pure-helper extraction (Sprint 3.0.1) |
| Existing key auto-gen pattern | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/keys/family-keys.ts` | Mirror for `.session-secret` auto-generation |
| Verify page (v3 draft) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/sprint-3.0/verify.html` | Substantially rewrite for v4; move to `public/verify.html` |
| viem version pin | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/package.json:25` | Pin before W1.1 |

---

## Provenance Note

| Doc | What it covers | Status |
|-----|----------------|--------|
| `sprint-3.0/research-3.0.md` (this file) | v4 SIWE / Sign-in-with-Base research | **Current** |
| `sprint-3.0/research-3.0-v3-worldid.md` | v3 World ID / IDKit / nullifier research | Archived (pivoted away) |
| `sprint-3.0/plan-3.0.md` | v4 plan with W1-W5 workstreams + Sprint Contract | Current |
| `sprint-3.0/verify.html` | v3 verify-page draft (World ID UX) | Reference only — substantially rewritten in W2.2 |
