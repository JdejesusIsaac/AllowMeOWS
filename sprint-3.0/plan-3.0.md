# AllowanceAgent — plan.md (Sprint 3.0 — Trimmed)

## Feature Summary

Sprint 3.0 ships World ID verification for Manager and Co-parent roles and a single static verification page that hands off to Claude. The distribution channel is **orb-verified parents at partnered school events** (Success Academy pilot), not a Mini App in World Network's app directory. OWS custody stays intact — Option B hybrid architecture. Kids remain invite-code-only. AgentKit deferred to Sprint 3.5 (Seoul Build Week).

**What's new vs the original plan:** No Mini App, no Next.js, no MiniKit, no Vercel, no React. The frontend is one static HTML file (~150 lines) hosted on the existing Railway server at `/verify`. Parents scan a QR code at a school event, land on the verify page, complete IDKit verification, receive a one-line instruction to paste into Claude. The distribution channel is physical (school orb events) not discovery-based (World Network app browse).

**Why this is stronger, not weaker:** The pitch changes from "generic Mini App for families" to "first proof-of-human-gated family financial product with a named B2B distribution partner." That's legible to judges. It also cuts scope from 27 hours to 18 hours, which fits the 48-hour window with real buffer for Sprint 2.75 validation and pitch preparation.

## Problem Statement

Two problems framed the original Sprint 3.0: distribution and sybil resistance. The Mini App was my answer to both. The school-orb reframe splits them:

1. **Distribution:** Handled by the Success Academy partnership and physical orb events at school. Parents don't need to discover AllowanceAgent in World App — they encounter it at PTA night, orientation, or a scheduled orb event. QR code to verify page, verify page to Claude.

2. **Sybil resistance:** Still solved by World ID nullifier uniqueness. Mechanism unchanged from the full plan.

The Mini App UI layer was solving a problem that doesn't exist in the school-partnered model. A 150-line static page with IDKit + handoff instructions does the job cleanly.

## Architecture Decisions

### 1. OWS stays — hybrid architecture (Option B) — unchanged
**Decision:** World ID and OWS solve orthogonal problems. OWS handles custody. World ID handles identity. Both ship.
**Why:** Preserves the "first consumer-ready OWS application" narrative from the OWS Hackathon submission while adding the sybil guarantee World Build judges care about. Same architectural thesis as the original plan.

### 2. No Mini App frontend — static HTML + IDKit only
**Decision:** Skip Next.js entirely. Build one static HTML page at `https://allowme.dev/verify` that loads `@worldcoin/idkit-standalone` via CDN script tag, triggers verification, POSTs the proof to the existing backend, displays handoff instructions.
**Why:** The Mini-App-in-World-App distribution story was the only reason to build the full Next.js frontend. With school orb events as the channel, users arrive via QR code in any mobile browser. IDKit works natively in any browser. A static page is 1–2 hours of work vs 9+ hours for a full Next.js Mini App, and renders more reliably (no React hydration bugs during a demo).

### 3. Distribution channel is physical, not app-directory based
**Decision:** Pitch AllowanceAgent as the AI-native family financial layer for orb-verified parents at partnered schools. Success Academy is the named pilot. QR codes at school events point parents to `/verify`. The app is not submitted to World App's Mini App directory for this sprint.
**Why:** Distribution is the hardest problem for most World Build applicants. Having a named B2B partner with existing relationship (per prior conversations with Success Academy) puts AllowanceAgent ahead of the median applicant. It also aligns with Tools for Humanity's actual go-to-market — biometric verification is a physical-world primitive, and schools are a natural distribution surface.

### 4. World ID gating scoped to Manager + Co-parent
**Decision:** Manager requires orb-level verification. Co-parent requires device-level (most orb-verified parents have World App installed, so device-level is always available to them). Family and Advisor and Learner roles remain invite-code-only.
**Why:** Minors cannot verify. Grandparents with gift-only access don't need the friction. The verification applies where financial authority applies.

### 5. Nullifier as the sybil primitive — unchanged from full plan
**Decision:** Store nullifiers per (human, action) tuple. Separate action namespaces for Manager vs Co-parent to allow legitimate cross-role human. Revocable on Member removal.
**Why:** This is the architectural win of the World integration. The mechanism doesn't change just because the frontend shrank.

### 6. Session auth for verified humans is additive
**Decision:** After World ID verification, issue a short-lived session token (24h JWT). Session token is a third priority in `resolveCallerRole` behind the existing `X-Member-Id` header and `_callerId` arg paths. Legacy Sprint 2 auth paths unchanged.
**Why:** Session auth is useful for the verify page to issue calls on behalf of the newly-verified user. Doesn't break anything from Sprint 2.

### 7. Claude remains the only conversational surface
**Decision:** Verify page is a pure handoff. It shows the MCP connector URL and a starter prompt. No attempt to embed a chat interface. Everything the parent does after verification happens in Claude.
**Why:** Building an in-app chat is out of scope and dilutes the "Claude as family AI" story. Clean handoff is the right pattern.

### 8. AgentKit scoped to research only
**Decision:** No `@worldcoin/agentkit` or `@x402/hono` integration in this sprint. Research doc captures the full integration for Sprint 3.5 (Seoul Build Week).
**Why:** AgentKit requires coordinating with agent operators (OpenMAIC, Fitbit-as-agent, potential StableShield integration). That's ecosystem work better done on the ground in Seoul with the World team available for questions.

### 9. Success Academy pilot is real or cut
**Decision:** Before submission, confirm at least one concrete artifact from Success Academy or from World orb operations — a scheduled event, a written expression of interest, or a conversation with World's orb operations team about school-based events. If nothing concrete exists by end of Day 1, reframe the pitch to "we're building for orb-verified parents; Success Academy is our target pilot" rather than "Success Academy is onboarding with us."
**Why:** Judges can tell the difference between a real partner and aspirational language. A two-sentence email confirmation is the difference between a credible B2B story and hand-waving. If the reality is aspirational, be honest about it — judges still reward clear target-customer thinking, but they punish over-claiming.

---

## Implementation Steps

### Workstream W1: World ID Verification Backend 

Unchanged from the full plan. All 10 steps ship.

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| W1.1 | `src/worldid/verify.ts` — Developer Portal API integration | Medium | 1h |
| W1.2 | `src/worldid/nullifier-store.ts` — persistence with action namespacing | Medium | 1h |
| W1.3 | Schema: extend `MemberSchema` with worldId fields (optional) | Low | 15m |
| W1.4 | Schema: extend `InviteSchema` with `requiresWorldId` field | Low | 15m |
| W1.5 | Schema: add `world-id-verified` to `AuditEntrySchema` action enum | Low | 5m |
| W1.6 | Update `invite-member` — auto-set `requiresWorldId` for gated roles when `WORLD_APP_ID` is configured | Low | 30m |
| W1.7 | Update `accept-invite` — World ID verification + nullifier uniqueness check | High | 1.5h |
| W1.8 | HTTP endpoint `POST /api/worldid/verify` for the verify page | Medium | 45m |
| W1.9 | HTTP endpoint `POST /api/session` — JWT token issuance | Medium | 45m |
| W1.10 | Update `resolveCallerRole` — session token as priority 1, additive | Medium | 45m |

### Workstream W2: Static Verify Page 

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| W2.1 | `public/verify.html` — single-file HTML with IDKit script tag, Tailwind CDN, vanilla JS | Medium | 1h |
| W2.2 | Express route `GET /verify` serving `public/verify.html`. Add QR-friendly query params: `?invite=AIDEN-COPRT-4K7W` auto-fills invite code, `?role=manager` selects action namespace | Low | 30m |
| W2.3 | Register app on developer.worldcoin.org (dev environment). Create 3 actions: `allowme-become-manager` (orb), `allowme-become-coparent` (device), `allowme-become-family` (device). Set app URL to `https://allowme.dev/verify` | Low | 30m |

**The verify page UX (sketch):**
- Lands at `/verify` (for new Manager) or `/verify?invite=CODE&role=X` (for invite acceptance)
- Shows the AllowMe logo and one-line context ("Verify you're a real human to set up allowance for your family")
- IDKit widget renders inline
- On success, POSTs proof to `/api/worldid/verify`
- On backend success, displays two things: (1) the MCP connector URL with copy-to-clipboard button, (2) a suggested starter prompt ("Set up allowance for the Isaac family. Aiden gets $15/week, 100% education.") with copy-to-clipboard
- Shows "Don't have Claude? Download the app" links below
- On sybil rejection, displays user-friendly error: "This World ID is already registered as a Manager. If you're switching families, have the current Manager remove you first."

No routing, no state management, no React. Just a form, a widget, and two success/error states.

### Workstream W3: Sybil Defense + Edge Cases 

Unchanged from full plan.

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| W3.1 | Nullifier uniqueness enforcement with clear error message | Medium | 30m |
| W3.2 | Nullifier revocation on member removal | Low | 20m |
| W3.3 | Legacy Manager backward compat (pre-Sprint 3.0 Members work without verification) | Low | 20m |
| W3.4 | Action mismatch rejection | Low | 15m |
| W3.5 | Proof replay protection (5-min window, defense-in-depth) | Low | 20m |

### Workstream W4: Tests (4 hours — trimmed from 6 hours)

Cuts the Mini-App-specific E2Es. Keeps the architecturally-important ones.

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| W4.1 | World ID verify unit tests (WI1-WI6) | Medium | 45m |
| W4.2 | Nullifier store tests (NS1-NS5) | Medium | 30m |
| W4.3 | Invite + accept with World ID tests (IA1-IA7) | Medium | 1h |
| W4.4 | HTTP endpoint tests (HE1-HE5) | Medium | 45m |
| W4.5 | Session middleware tests (SM1-SM5) | Medium | 30m |
| W4.6 | Schema backward compat tests (SC1-SC3) | Low | 20m |
| W4.7 | E2E sybil rejection (SB1-SB3) | Medium | 45m |
| W4.8 | E2E legacy Manager backward compat (LM1-LM4) | Low | 20m |
| W4.9 | E2E Claude Desktop unchanged — Sprint 2 regression guard (CD1-CD3) | Low | 20m |

**Cut from full plan:** E2E Mini App onboarding , E2E Co-parent invitation full flow (CP1-CP8, 1h), E2E cross-role legitimate use (XR1-XR3, 45m), edge cases EC1-EC10 (covered implicitly by unit tests). The cut tests are still documented in research for Sprint 3.5.

**Target new tests:** ~35 (down from 70 in the full plan). **Total after Sprint 3.0: ~222.** Ship floor if things slip: WI1-WI6 + NS1-NS5 + IA1-IA5 + SB1-SB3 + CD1-CD3 = 22 tests.

### Workstream W5: Demo Prep + Documentation 

| Step | Task | Complexity | Est. |
|------|------|------------|------|
| W5.1 | README — "World ID + School Pilot" section, updated architecture diagram | Medium | 45m |
| W5.2 | Demo video (3 min) — see script below | Medium | 1h |
| W5.3 | Pitch deck (10 slides) — see outline below | High | 1.5h |
| W5.4 | World Build application submission before April 26 deadline | Low | 30m |

**Demo video script (3 minutes):**
1. **0:00–0:20** — Problem: Show Roblox microtransaction screen. Voiceover: "Kids beg for Robux because the attention economy trained them to. Parents pay $50/month so their kid can buy virtual items."
2. **0:20–0:40** — Solution framing: "AllowanceAgent redirects that loop. Kids earn USDC for verified real-world achievements. Parents fund it. Claude runs it. World ID keeps it sybil-proof."
3. **0:40–1:15** — School orb flow: Show QR code at a school event (mock-up if no real event exists yet). Parent scans → `/verify` page loads → IDKit widget → verification succeeds → copy MCP URL → paste into Claude → Claude responds "Family configured!"
4. **1:15–2:00** — Allowance flow in Claude: "Aiden finished his reading — 85 out of 100." "How's Aiden doing?" "Distribute what Aiden earned." Show USDC moving on-chain on Basescan.
5. **2:00–2:30** — Sybil rejection: Second browser, same human, attempts to become Manager of a second family. Mini App rejects with clear error.
6. **2:30–3:00** — Close: "Success Academy is our pilot partner. Orb-verified parents. AI-native allowance. Sybil-resistant by design. World Build 3.0."

**Pitch deck outline (10 slides):**
1. Title — AllowanceAgent: AI-Funded UBI for Families
2. Problem — The attention economy extracts $X from families via Roblox/TikTok/gacha. Kids learn to beg, not to earn.
3. Solution — Achievement-gated USDC allowance. Kids earn by doing verified real-world things. AllowanceAgent is the first Mini App where the product *is* the UBI mechanism.
4. How it works — 3-step diagram: Parent verifies at school orb → Claude configures family → Kid earns USDC for achievements
5. Architecture — Hybrid OWS + World ID. OWS = invisible custody. World ID = sybil-proof identity. Together = no keys, no fake families.
6. Traction — 222 tests, live on-chain USDC on Base, working product shipped under AllowMe LLC, existing OWS Hackathon submission.
7. Why now — World ID made proof-of-human a primitive. Claude made consumer agents real. USDC made programmable allowance possible. The stack arrived.
8. Go-to-market — Success Academy pilot (school-based orb events). B2B charter school sales. Expansion to World App directory after pilot validation.
9. Team — Juan Isaac. Security researcher, smart contract auditor, multi-time Code4rena placer, OWS builder, bilingual (English/Spanish), NYC. Building this for my own kids.
10. Ask — Seoul Build Week invitation. World Foundation grant consideration. Introductions to Success Academy operations / World orb operations.

---

## Time Allocation 

| Phase | Hours | Focus |
|-------|-------|-------|
| Sprint 2.75 validation | 0–3 | Run the 19-step test sequence with wife. Fix any bugs discovered. |
| Spike (MiniKit/IDKit + Developer Portal) | 3–5 | Confirm IDKit standalone works in browser + proof verification round-trips through Developer Portal API |
| Core backend (W1) | 5–12 | All 10 backend steps |
| Sybil defense + edge cases (W3) | 12–14 | All 5 steps |
| Tests (W4) | 14–18 | All 9 test suites |
| Static verify page (W2) | 18–20 | HTML + Express route + Developer Portal registration |
| End-to-end integration test | 20–22 | Full flow: QR → verify → Claude handoff → allowance → sybil reject |
| Demo video + deck + submission (W5) | 22–26 | Record, iterate, submit |




---

## Dependencies and Risks (Updated)

| Dependency | Risk | Mitigation |
|------------|------|------------|
| `@worldcoin/idkit-standalone` via CDN | Low | Mature SDK, CDN is reliable. Cache the script tag locally as fallback if CDN fails. |
| World Developer Portal (dev environment) | Medium | Registration is instant. Rate limits unclear at test frequency. Mitigation: mock proof verification in unit tests, only hit live API for E2E. |
| Railway existing deployment | Low | Unchanged from Sprint 2.75. New env vars + one static file route only. |
| Success Academy partnership verification | Medium | Need to confirm before submission. If aspirational, reframe pitch honestly (see Decision 9). |
| Base Sepolia RPC + faucet for demo video | Low | Alchemy endpoint in Sprint 2.75 config. Faucet via cdp.coinbase.com or alchemy.com. |
| QR code generation for school-event mock-up | Low | Any QR generator. Include "scan me" image in demo video. |
| Solo execution speed | Medium | Scope now fits in 48h with buffer. If W1 debugging extends past hour 12, invoke fallback: ship backend + unit tests only, demo via curl instead of browser. Frontend becomes Sprint 3.1 polish. |

## Fallback Approaches

- **IDKit widget fails in demo browser:** Use curl with a Developer Portal test token to simulate the verify flow. Disclose in voiceover. Judges will understand tooling hiccups.
- **Developer Portal rate-limited during demo:** Pre-record the IDKit verification in a clean environment beforehand. Use the recorded clip in the demo video if live capture fails.
- **Success Academy can't be confirmed by submission:** Reframe pitch Slide 8. "Go-to-market: Orb-verified parents at partnered schools. Success Academy is our target pilot — conversations in progress." Less punchy but honest.
- **World ID verification breaks mid-sprint:** Ship backend + all non-World-ID tests. Demo with mocked verification (disclosed). Pitch becomes "here's the architecture, here's the rigor, here's why we need Seoul to finish the World integration." Not ideal but recoverable.
- **Sprint 2.75 validation surfaces bugs:** Stop. Do not proceed with Sprint 3.0 until Sprint 2.75 is green. Fixing bugs is the highest-priority use of the first 3 hours. If bugs extend past hour 6, cancel Sprint 3.0 and submit as "Sprint 2.75 production-ready with World ID in Sprint 3.1."

---

## Sprint Contract — Sprint 3.0 (Trimmed)

### Success Criteria

1. **World ID verification for Manager role works end-to-end:** Parent scans QR (or visits `/verify`) → IDKit widget → proof validated by backend via Developer Portal API → nullifier recorded → session issued → parent can use all Manager MCP tools via Claude.
2. **World ID verification for Co-parent role works end-to-end:** Same as Manager but with device-level verification and `allowme-become-coparent` action namespace.
3. **Sybil defense functional:** Human A attempting second Manager registration with same World ID rejected with user-friendly error. Cross-role acceptance (Manager in Family A, Co-parent in Family B) succeeds.
4. **Kids stay invite-code-only:** Learner role invite flow unchanged. Minors never verify.
5. **Legacy Manager backward compat:** Pre-Sprint 3.0 Members (no `worldIdNullifier` field) continue to function. Startup warning logged. All 187 Sprint 2.75 tests still pass.
6. **Static verify page renders correctly:** QR code → page loads on any mobile browser → IDKit widget fires → handoff instructions display on success.
7. **Claude Desktop/Mobile integration unchanged:** Existing Sprint 2 auth paths (`X-Member-Id` header, `_callerId` arg) work without modification. Session token is additive.
8. **Deployment extends Sprint 2.75 pattern:** Railway backend gets new env vars + one static file + two new endpoints. No new service, no new platform, no new deploy target.
9. **Demo video captures three critical moments:** (a) orb-at-school verification (can be mocked visually), (b) allowance distribution via Claude, (c) sybil rejection. ≤3 minutes.
10. **World Build application submitted by April 26 deadline** with demo video, pitch deck, GitHub link, verify page URL.

### Dynamic Rubric

| Category | Weight | Justification |
|----------|--------|---------------|
| Functionality | 30% | World ID verify, nullifier uniqueness, verify page handoff, session auth, backward compat |
| Auth/Security | 30% | Sybil defense, action namespacing, replay protection, legacy Manager protection, no plaintext nullifier storage |
| Design/UX | 25% | Orb-at-school framing, static verify page clarity, handoff to Claude flow, demo video, pitch narrative |
| Originality | 15% | Hybrid OWS + World ID, orb-at-school distribution model, AI-funded UBI framing for families, first sybil-resistant consumer MCP product |

### Grading Thresholds

- **Pass:** All categories ≥ 70%. No category below 60%. Submission accepted by World Build. At minimum receives constructive feedback signaling Stage 2 candidacy.
- **Fail:** Any category below 60%, OR Functionality below 70%, OR Auth/Security below 70%, OR sybil defense demo fails on camera, OR submission missed.

### Success Conditions Beyond the Rubric

- World Build judges invite AllowanceAgent to Seoul Build Week
- At least one VC on the Demo Day list engages during the cohort
- Success Academy conversation advances concretely as a result of the deck
- Demo video is usable as a standalone marketing asset after the hackathon regardless of Seoul outcome

---

## Scope Guard — Explicitly NOT Building in Sprint 3.0

1. **Next.js Mini App frontend** — replaced by static HTML
2. **Vercel deployment** — not needed; Railway serves the static file
3. **MiniKit SDK integration** — using IDKit standalone instead
4. **Progress dashboard** — Claude is the progress UI
5. **Invite acceptance UI** — invite codes + SMS (Sprint 2 pattern) still work
6. **In-app chat** — Claude is the conversational surface
7. **AgentKit / x402 re-integration** — Sprint 3.5 in Seoul
8. **WLD payments** — USDC-only unchanged
9. **World Chain USDC** — Base + Base Sepolia unchanged
10. **Production Mini App directory submission** — dev environment sufficient for hackathon
11. **Legacy Manager World ID upgrade flow** — Sprint 3.5
12. **Full orb event coordination with Success Academy** — conversation-stage in pitch is acceptable; operationalizing is post-Seoul work

---

## Sprint 3.5 Preview (Seoul Build Week, May 10–18)

Assuming Sprint 3.0 passes and AllowanceAgent advances to Stage 2:

- AgentKit integration for agent-to-agent traffic (OpenMAIC, Fitbit-as-agent)
- AllowanceAgent's signing wallet registered in AgentBook
- World Chain USDC support alongside Base
- Legacy Manager upgrade flow (`/upgrade` for pre-Sprint 3.0 Members)
- Mini App directory submission (production review)
- First 10 test families onboarded at Success Academy pilot event
- World Foundation grant conversation initiated
- Interactive Mini App cards in Claude conversations (progress charts, streak visualizations)
- WLD denomination as an option alongside USDC

Sprint 3.5 is additive polish + ecosystem work. Sprint 3.0 proves the thesis; Sprint 3.5 productionizes it.
