# AllowanceAgent — research.md (Sprint 3.0 — Trimmed)

## Phase 0a: Problem Framing

### Problem Statement

Sprint 2.75 shipped a production-ready allowance system — 187 tests, zero passphrase UX, live on-chain USDC, multi-asset savings, Fitbit OAuth, dual transport, Railway-deployable with per-family key isolation. Two problems remain:

1. **No public distribution channel.** The product works for families who already know about AllowMe LLC. Discovering it requires existing knowledge.
2. **Latent sybil risk at scale.** The moment "kids earn USDC for verified achievements" ships publicly, the economics attract sybil farmers. Invite codes bind a code to a role but can't prove the human accepting it is unique. One attacker could run hundreds of fake Manager accounts against the same treasury.

World Build 3.0 (April 23–August 2026) solves both, but not the way I initially framed it. My first plan assumed the Mini App was the distribution channel — build a polished Next.js app, submit to World App's directory, let parents discover it through World Network's ~30M users. The reframe: **distribution happens through orb-verified parents at partnered school events (Success Academy pilot), not through World App's directory.** This cuts the entire Mini App frontend layer while preserving the sybil-defense backend, which is the actual architectural contribution.

### "What Is" Statement

Sprint 2.75's security architecture: `MASTER_KEY` encrypts per-family keys in `data/family-keys.json`, each family key passes to OWS as wallet passphrase, wallets are encrypted per-family and isolated, no user sees any secret. MoonPay orchestration is Claude-mediated with zero code dependency. HTTP transport supports Claude Mobile and A2A with agent-card discovery. Fitbit OAuth is server-side via one AllowMe LLC developer app. Five-role RBAC enforced at both app layer (`withAccessControl`) and OWS policy layer (`allowance-policy.py` with ERC-20 decoding). The `aixyz` x402 micropayment gating was removed in preparation for a World Chain port. All 12 MCP tools work. The HTTP server exists. What's missing: a verified-human identity binding on Manager and Co-parent roles, and a way for orb-verified parents to complete that binding.

### Solution Hypothesis

Add World ID verification as an optional identity layer on Manager and Co-parent roles. OWS custody stays intact — Option B hybrid architecture. The nullifier returned by World ID is globally unique per (human, action) pair, giving ironclad "one verified human = one role slot per server" guarantees that invite codes alone cannot provide. **Replace the Next.js Mini App with a single static HTML page** hosted at `/verify` on the existing Railway server, rendered using `@worldcoin/idkit` standalone widget. Parents scan a QR code at a school orb event, land on the verify page, complete IDKit verification in any browser, receive a handoff to Claude. Session-based auth bridges verified humans into the existing `resolveCallerRole` middleware. AgentKit for agent-to-agent traffic deferred to Sprint 3.5 (Seoul Build Week) — it requires ecosystem coordination better done on the ground. Kids stay invite-code-only: minors cannot consent to biometric verification and no Minor World ID product exists.

### Scope Boundary

**In scope:**
- World ID verification backend (`src/worldid/verify.ts` + `src/worldid/nullifier-store.ts`)
- Schema extensions: `Member.worldIdNullifier`, `Invite.requiresWorldId`, `AuditEntry` action enum — all optional, backward compat guaranteed
- HTTP endpoints `/api/worldid/verify` and `/api/session`
- Session-based auth in `resolveCallerRole` (additive to Sprint 2 header path)
- `invite-member` + `accept-invite` updates for World ID role gating
- **Single static `public/verify.html` page** served by Express at `GET /verify`
- Developer Portal app registration (dev environment) + 3 action namespaces
- Sybil defense: nullifier uniqueness + action namespacing + replay protection
- Legacy Manager backward compat
- Updated README with World ID + School Pilot section
- Demo video, pitch deck, World Build application

**Cut from original plan (explicit scope reduction):**
- Next.js 15 App Router project (`miniapp/` directory)
- MiniKit SDK integration
- `MiniKitProvider`, onboarding page, invite acceptance page, progress dashboard
- Vercel deployment
- In-World-App rendering

**Out of scope :**
- AgentKit integration (`@worldcoin/agentkit` + `@x402/hono`)
- AgentBook agent registration for AllowanceAgent's signing wallet
- World Chain USDC support (stays Base + Base Sepolia)
- WLD-denominated payments
- Legacy Manager World ID upgrade flow
- Production Mini App directory submission
- Interactive Mini App cards in Claude conversations
- Notifications via MiniKit
- World App contacts integration

**Explicitly out of scope :**
- Replacing OWS with World App native custody
- In-Mini-App chat UI
- Minor World ID

---

## Phase 0b: Technical Research

### 1. World ID Verification Protocol

**What it is:** Zero-knowledge proof-of-personhood. A verified human holds a Semaphore identity from their iris scan at an Orb. When an app requests verification, World App generates a Semaphore proof that proves (a) the user is a verified human, (b) they haven't used this identity before for this specific action, without revealing who they are. The proof returns a `nullifier_hash` deterministic per (identity, action) pair.

**Verification flow (updated for static page):**
```
Browser (verify.html)             Server (AllowanceAgent)              Developer Portal
     │                                    │                                    │
     │ IDKit.open({ action, level })      │                                    │
     │ (widget triggers inside browser)   │                                    │
     │ → proof, merkle_root, nullifier    │                                    │
     │                                    │                                    │
     │ POST /api/worldid/verify           │                                    │
     │ { proof, action, invite_code? }    │                                    │
     │───────────────────────────────────→│                                    │
     │                                    │ POST /api/v2/verify/{app_id}       │
     │                                    │───────────────────────────────────→│
     │                                    │ { verified: true, nullifier_hash } │
     │                                    │←───────────────────────────────────│
     │                                    │                                    │
     │                                    │ Check NullifierStore               │
     │                                    │ → if used → 409 sybil error        │
     │                                    │ → if free → proceed                │
     │                                    │                                    │
     │                                    │ Create/update Member + session     │
     │                                    │                                    │
     │ { sessionToken, handoff }          │                                    │
     │←───────────────────────────────────│                                    │
     │                                    │                                    │
     │ Render success state with MCP URL  │                                    │
```

**Key endpoints:**
- Cloud verification: `POST https://developer.worldcoin.org/api/v2/verify/{app_id}`
- Request: `{ merkle_root, nullifier_hash, proof, verification_level, action, signal_hash? }`
- Response: `{ success: true, verified: true, nullifier_hash, action, created_at }`

**Verification levels:**
- `device` — anyone with World App (less secure)
- `orb` — verified at a World Orb (biometric-verified proof-of-human)

**Decision:** Manager requires `orb` (high-stakes treasury access). Co-parent allows `device` (can verify achievements but cannot distribute). Family member allows `device` (gift-only access). Security gradient matches role capabilities.

**Critical:** Backend always re-verifies the proof via Developer Portal API. Never trust the client's reported nullifier — independently derive from the submitted proof.

### 2. IDKit Standalone (Browser-Native, No MiniKit)

**What it is:** `@worldcoin/idkit-standalone` is the browser-native JavaScript SDK that renders the World ID verification widget in any web browser. No World App required on the device. Works via QR code: the widget displays a QR code that the user scans with their World App to approve verification, or — if the user opens the page on a device that has World App installed — opens World App directly via deep link.

**Why this fits the school-orb model:**
- At a school orb event, parents just got verified at the physical orb
- They have World App installed and active
- When they scan the AllowanceAgent QR code on the event flyer, the IDKit widget opens on their phone and deep-links directly to World App for the verification prompt
- User taps "Allow" in World App, gets redirected back to the verify page, sees the success state
- Entire flow is ~30 seconds from QR scan to Claude handoff

**Why this is a better fit than MiniKit for Sprint 3.0:**
- MiniKit requires the Mini App to be rendered inside World App's webview. Orb-at-school parents already left the orb screen — they're not in World App anymore.
- IDKit standalone works in any browser. A parent opening a QR code in iOS Safari, Chrome on Android, or anywhere else works identically.
- No React, no build step, no bundler. Just a `<script>` tag.
- Same backend verification path (Developer Portal API is identical for MiniKit proofs and IDKit proofs).

**Integration pattern:**
```html
<script src="https://unpkg.com/@worldcoin/idkit-standalone@latest"></script>
<button onclick="verify()">Verify with World ID</button>
<script>
  async function verify() {
    const result = await IDKit.open({
      app_id: 'app_xxx_from_developer_portal',
      action: 'allowme-become-manager',
      verification_level: 'orb',
      signal: ''  // optional; invite code when accepting invite
    });
    // result.proof, result.merkle_root, result.nullifier_hash
    await fetch('/api/worldid/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    });
  }
</script>
```

**Fallback:** If CDN is unreliable, download `idkit-standalone` JS bundle and serve from `/public/lib/idkit.js`. Same behavior, no external dependency at runtime.

### 3. Nullifier Scoping — The Sybil Primitive

Unchanged from original plan.

**The core guarantee:** For a given World ID action, a human's `nullifier_hash` is globally unique. If `0xabc...` has been seen for action `allowme-become-manager`, that nullifier cannot be produced again by any other human, and the same human cannot produce a different nullifier for that action.

**Action namespacing:**
- `allowme-become-manager` — orb-level, one nullifier allowed per server
- `allowme-become-coparent` — device-level, independent namespace
- `allowme-become-family` — device-level, independent namespace

**Why separate namespaces matter:** A human can legitimately be a Manager in their own family AND a Co-parent in their parents' family. Different actions → different nullifiers → no false collision.

**Nullifier storage:**
```typescript
// data/world-id-nullifiers.json
{
  "allowme-become-manager": {
    "0xabc123...": { memberId: "uuid-1", familyId: "uuid-A", verifiedAt: "..." }
  },
  "allowme-become-coparent": {
    "0xabc123...": { memberId: "uuid-3", familyId: "uuid-C", verifiedAt: "..." }
  }
}
```
Same nullifier appears in both namespaces — same human, two legitimate roles, zero collision.

**Revocation:** When `manage-members` removes a Manager or Co-parent, revoke the nullifier. Human can re-register. Revocation is reversible.

**Privacy:** Nullifiers are opaque hashes but ARE persistent identifiers scoped to the action. Do not log in plaintext. Store in `0o600` permissions file. Audit log entries truncate to `nullifier.slice(0, 10) + "..."` for debugging without leaking.

### 4. Session Architecture

**Why sessions:** The verify page needs to authenticate API calls on behalf of the newly-verified user. The MCP transport also benefits from session auth for future integrations. Claude Desktop users continue using the Sprint 2 `X-Member-Id` header pattern — session is additive.

**Session lifecycle:**
1. User completes IDKit verification on `/verify`
2. Backend validates proof via Developer Portal API
3. If invite acceptance flow: call `accept-invite` internally, create Member with nullifier + invite context
4. If new Manager flow: store verification pending Member creation (happens when parent runs `configure-policy` in Claude)
5. Issue session token: signed JWT with `{ memberId, role, nullifier, expiresAt }` (24h expiry)
6. Verify page stores session token in-memory; if user needs to re-auth (e.g., comes back later), they re-verify

**For Sprint 3.0:** Sessions are in-memory (Map keyed by token). Lost on Railway restart. Acceptable for hackathon. Production uses Redis or DB.

**Token validation in middleware:**
```typescript
// src/middleware/access-control.ts (updated)
export async function resolveCallerRole(
  args: Record<string, unknown>,
  headers?: IncomingHttpHeaders
): Promise<CallerContext> {
  // Priority 1 (new): session token
  if (headers?.authorization?.startsWith('Bearer ')) {
    const token = headers.authorization.slice(7);
    const session = await verifySessionToken(token);
    if (session && session.expiresAt > Date.now()) {
      const member = await loadMember(session.memberId);
      if (member?.active) {
        return { role: member.role, memberId: member.id, childName: member.childName };
      }
    }
  }
  // Priority 2 (Sprint 2, unchanged): X-Member-Id header
  // Priority 3 (Sprint 2, unchanged): _callerId arg
  // Priority 4 (stdio default, unchanged): manager
}
```

**Signing secret:** Use `SESSION_SECRET` env var. Auto-generate to `data/.session-secret` if not set (same pattern as Sprint 2.75 master key).

### 5. Action Name Design

**Registering actions in Developer Portal:**
- Each action registered at developer.worldcoin.org → App → Actions
- Set max uses per person (1 for all three AllowanceAgent actions — enforced by nullifier)
- Set display name, description shown during user consent

**User consent screen:** When a user taps "Verify," World App shows:
> "AllowanceAgent wants to verify you as a Manager.
> Action: allowme-become-manager.
> This proves you're a unique real human without revealing your identity."

**Actions to pre-register for Sprint 3.0:**
1. `allowme-become-manager` — orb-level, display name "Become a Manager"
2. `allowme-become-coparent` — device-level, display name "Become a Co-parent"
3. `allowme-become-family` — device-level, display name "Join as Family Member"

### 6. Mini App Architecture (CUT) — What Changed

**Original plan:**
- Next.js 15 App Router with ~8 pages
- MiniKit provider, MiniKit verify command
- `miniapp/` directory as separate Vercel deployment
- ~9 hours of W2 work

**What replaces it:**
- Single `public/verify.html` file served by Express
- IDKit standalone widget via CDN script tag
- Query-param-driven UI state (`?role=X&invite=Y`)
- ~2 hours of W2 work

**What's preserved functionally:**
- Manager onboarding flow (QR → verify → handoff to Claude)
- Invite acceptance flow (QR with invite code → verify → handoff)
- Sybil rejection UX
- Error states
- Deep-link to claude.ai connector settings

**What's lost:**
- In-World-App rendering (replaced by "open in any browser")
- Interactive progress dashboard (replaced by "use Claude")
- Polish (replaced by "functional is enough for Sprint 3.0")

### 7. AgentKit — Research for Sprint 3.5 Only

Unchanged from original plan. Documented here for Seoul Build Week reference.

**What AgentKit is:** Layer on top of x402 that adds human-attestation to agent-to-agent payment flows. The calling agent's signing wallet must be registered in AgentBook on World Chain via `npx @worldcoin/agentkit-cli register 0xAgentAddress`. Registration links agent wallet to a verified human (the developer). When the agent calls an AgentKit-gated endpoint, the server does an AgentBook lookup to confirm the agent is backed by a verified human before processing the payment.

**Integration pattern (for Sprint 3.5):**
```typescript
import { Hono } from 'hono';
import { createAgentkitHooks, createAgentBookVerifier, declareAgentkitExtension } from '@worldcoin/agentkit';
import { JsonAgentKitStorage } from './worldid/agentkit-storage.js';

const hooks = createAgentkitHooks({
  agentBook: createAgentBookVerifier(),
  storage: new JsonAgentKitStorage(),
  mode: { type: 'free-trial', uses: 3 }
});

const agentRoutes = {
  'POST /mcp/verify-achievement': {
    accepts: [
      { scheme: 'exact', price: '$0.02', network: 'eip155:480', payTo },
      { scheme: 'exact', price: '$0.02', network: 'eip155:8453', payTo }
    ],
    extensions: declareAgentkitExtension({
      statement: 'Verify your agent is backed by a real human',
      mode: { type: 'free-trial', uses: 3 }
    })
  }
};
```

**Why deferred:** AgentKit requires every A2A caller (OpenMAIC, future Fitbit-as-agent, StableShield integration) to register their agent wallet in AgentBook. This is ecosystem coordination work. Sprint 3.0 ships World ID + verify page for a complete Manager onboarding story; Sprint 3.5 in Seoul adds AgentKit with the World team on the ground.

**What Sprint 3.0 does leave scaffolded for 3.5:**
- This research section captures the integration plan
- Env vars documented in deployment guide: `AGENTKIT_PAYOUT_ADDRESS`, `AGENTKIT_AGENT_ADDRESS`
- Railway deployment guide will get "Add in Sprint 3.5" notes

### 8. Deployment Architecture (Simplified)

**Original plan: 3 surfaces.** Railway backend + Vercel Mini App + Developer Portal.

**Trimmed plan: 2 surfaces.** Railway backend (with static file) + Developer Portal.

**Railway deployment (existing Sprint 2.75 setup):**
- Dockerfile unchanged
- Volume mount `/app/data` unchanged
- New env vars:
  - `WORLD_APP_ID` — from developer.worldcoin.org dev environment
  - `SESSION_SECRET` — auto-generated to `data/.session-secret` if not set
- New static file: `public/verify.html`
- New Express route: `GET /verify` serving the HTML with `WORLD_APP_ID` injected
- New API endpoints: `POST /api/worldid/verify`, `POST /api/session`

**World Developer Portal (new):**
- Create app "AllowanceAgent" (dev environment)
- App URL: `https://allowme.dev/verify`
- 3 actions registered (manager, coparent, family)
- Privacy policy URL: `https://juanisaac.dev/privacy` (create if missing)
- Terms URL: `https://juanisaac.dev/terms` (create if missing)

**What's cut:** Vercel account setup, Next.js build configuration, separate domain for Mini App, MiniKit environment variables, React provider setup.

### 9. Backward Compatibility Strategy

Unchanged from original plan.

**Existing Members (Sprint 2.75 era):**
- No `worldIdNullifier` field — optional, defaults undefined
- All Manager tools continue to work (no verification check on legacy Members)
- Startup warning: `[worldid] N legacy managers without World ID verification`
- Upgrade path deferred to Sprint 3.5

**Existing Invites:**
- No `requiresWorldId` field — optional, defaults false
- Invites generated pre-Sprint 3.0 work unchanged

**Existing HTTP callers:**
- `X-Member-Id` header path preserved exactly
- `_callerId` / `_callerRole` args preserved
- Session token is additive, never replacive

**Data migration:** None required. All new fields optional with defaults. All existing `data/` files load without error.

---

## Phase 0.5: Spike Validation

### Spike 1: IDKit Standalone End-to-End

**Question:** Does `@worldcoin/idkit-standalone` via CDN script tag successfully render a verification widget in a browser, trigger World App via deep link on a mobile device, receive a valid proof, and POST it to a backend endpoint that validates via the Developer Portal API?

**Rationale:** Everything in Sprint 3.0 hinges on this. Original plan had this spike with MiniKit; the pivot to IDKit standalone means the spike must be re-run with the new library.

**Spike code:**
```html
<!-- public/spike.html -->
<!DOCTYPE html>
<html>
<body>
  <button id="verify">Spike Verify</button>
  <pre id="result"></pre>
  <script src="https://unpkg.com/@worldcoin/idkit-standalone@latest"></script>
  <script>
    document.getElementById('verify').onclick = async () => {
      try {
        const result = await IDKit.open({
          app_id: 'APP_ID_PLACEHOLDER',
          action: 'allowme-spike-test',
          verification_level: 'device'
        });
        const res = await fetch('/api/spike/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result)
        });
        document.getElementById('result').textContent = await res.text();
      } catch (err) {
        document.getElementById('result').textContent = 'Error: ' + err.message;
      }
    };
  </script>
</body>
</html>
```

```typescript
// app/spike-route.ts (temporary)
app.post('/api/spike/verify', async (req, res) => {
  const payload = req.body;
  const verifyRes = await fetch(
    `https://developer.worldcoin.org/api/v2/verify/${process.env.WORLD_APP_ID}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merkle_root: payload.merkle_root,
        nullifier_hash: payload.nullifier_hash,
        proof: payload.proof,
        verification_level: payload.verification_level,
        action: 'allowme-spike-test'
      })
    }
  );
  res.json(await verifyRes.json());
});
```

**Expected result:** `{ success: true, verified: true, nullifier_hash, action }`. If anything else, the spike reveals the blocker before full implementation.

**Spike status:** 🔜 Run on Day 1, hour 3-5.

### Spike 2: Session Token + MCP Call Integration

**Question:** Can a session token issued after World ID verification successfully authenticate an MCP call to an existing Sprint 2 tool (e.g., `check-progress`) without breaking the existing `X-Member-Id` header path?

**Rationale:** If session auth accidentally breaks Sprint 2's header auth, all 187 existing tests regress and Claude Desktop stops working.

**Spike code:**
```typescript
// Issue session for existing test member
const session = await issueSessionForMember('test-manager-id');

// Test 1: session auth works
const res1 = await fetch('http://localhost:3001/mcp', {
  method: 'POST',
  headers: { Authorization: `Bearer ${session.token}` },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'check-progress', arguments: {} }
  })
});
// Expect: 200 with progress report

// Test 2: existing X-Member-Id path still works in parallel
const res2 = await fetch('http://localhost:3001/mcp', {
  method: 'POST',
  headers: { 'X-Member-Id': 'test-manager-id' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'check-progress', arguments: {} }
  })
});
// Expect: 200 with same progress report
```

**Expected result:** Both auth paths work independently. No session precedence bugs.

**Spike status:** 🔜 Run on Day 1

### Spike 3: Nullifier Uniqueness Under Concurrent Verification (Nice-to-Have)

**Question:** If two requests attempt to verify the same nullifier for the same action simultaneously (race condition), does the nullifier store correctly reject the second?

**Rationale:** In production, two verify sessions on two devices could verify the same World ID at nearly the same time. The nullifier store must be atomic.

**Mitigation:** Atomic rename pattern from Sprint 1 `state.ts` should cover this. Manual test in E2E sufficient; formal spike not required for Sprint 3.0.

**Spike status:** 🟡 Skip unless time allows. Atomic rename inherits from existing code.

---

## Open Questions

| Question | Status | Resolution |
|----------|--------|------------|
| Does Developer Portal require app review before enabling verification? | ✅ Resolved | Dev environment is instant. Production review needed for launch. Hackathon uses dev. |
| Can we use a single app for staging + production? | ✅ Resolved | No — separate Dev and Prod apps on developer.worldcoin.org, each with its own `WORLD_APP_ID`. |
| What if a user's World App is on an older version? | ✅ Resolved | IDKit standalone handles version checks. Device-level always works; orb-level requires prior Orb verification. |
| Can the same action be registered with different verification levels? | ✅ Resolved | No — each action has a fixed level. Separate actions for Manager (orb) vs Co-parent (device). |
| What's the nullifier lifetime? | ✅ Resolved | Permanent. Only way to "reset" is to revoke the Member in `manage-members`. By design. |
| How does IDKit handle a user who never visited an Orb? | ✅ Resolved | For `orb` action, rejected at World App with prompt to visit an Orb. For `device`, proceeds normally. Manager requires orb; Co-parent accepts device. |
| Can we gate by region? | ✅ Resolved | Not via World ID. Privacy-preserving by design. IP geolocation is app-level concern. Out of scope. |
| What if user wants to switch families? | 🔜 Sprint 3.5 | Remove Member → nullifier revoked → re-register. UI flow deferred. |
| Can Claude Desktop users verify their World ID without the verify page? | 🔜 Sprint 3.5 | Yes — `/upgrade` endpoint with IDKit in a browser. Deferred. |
| Mini App privacy policy? | ✅ Resolved | Need `juanisaac.dev/privacy` before Developer Portal submission. Standard language sufficient for hackathon. |
| What if `WORLD_APP_ID` is missing in production? | ✅ Resolved | Server starts, `invite-member` doesn't set `requiresWorldId`. Hybrid architecture means OWS still works fully. |
| Can we test without a real World ID? | ✅ Resolved | Yes — Developer Portal dev environment issues test proofs. Documented in IDKit docs. |
| How do we handle accidental double-registration? | ✅ Resolved | Error message explains recovery path: "Contact the current Manager to remove you first, then retry." |
| Does the verify page compete with Claude UX? | ✅ Resolved | No — complementary. Verify page handles onboarding. Claude handles all deep flows. Verify page explicitly hands off. |
| What's the storage pattern for nullifiers at scale? | 🔜 Sprint 3.5+ | JSON file works for low hundreds. Postgres with unique index `(action, nullifier_hash)` for production. Deferred until volume justifies. |
| Why not Next.js + Vercel? | ✅ Resolved (Sprint 3.0 pivot) | Distribution is physical (school orb events) not app-directory. Static page covers functionality. Scope reduction fits 48h window. |
| Success Academy partnership status? | 🔜 Confirm pre-sprint | See plan.md Decision 9. Classify as scheduled / written interest / aspirational. Adjust pitch accordingly. |