# AllowanceAgent — progress.md (Sprint 3.0 — Trimmed)

## Sprint History
- Sprint 1: COMPLETE (88/100) — 9 tools, 84 tests, live on-chain USDC
- Sprint 2: COMPLETE (73.3% → PASS after remediation) — Learner role, HTTP, x402, Fitbit. 151 tests
- Sprint 2.5: COMPLETE (91.3/100) — convert-savings, multi-asset. 165 tests
- Sprint 2.75: COMPLETE — Per-family keys, zero passphrase. 187 tests. Railway-ready

## Sprint 3.0 (Trimmed): World ID + School Orb Pilot

### Approach
Hybrid OWS + World ID. Single static verify page replaces full Mini App. Distribution via orb events at partnered schools (Success Academy pilot). AgentKit deferred to Sprint 3.5. Scope reduced from 27 hours to 18 hours to fit 48-hour hackathon with real buffer.

### Pre-Sprint 
- [ ] Run 19-step Sprint 2.75 validation with wife (test document from prior conversation)
- [ ] Fix any Sprint 2.75 bugs surfaced during validation
- [ ] Confirm Success Academy status: scheduled event / written interest / aspirational? Adjust pitch accordingly
- [ ] Register AllowanceAgent on developer.worldcoin.org (dev environment)
- [ ] Create 3 actions: `allowme-become-manager` (orb), `allowme-become-coparent` (device), `allowme-become-family` (device)
- [ ] Save `WORLD_APP_ID` to password manager
- [ ] Confirm Base Sepolia faucet access + treasury funded for demo

### Workstream W1: World ID Backend 
- [ ] W1.1: `src/worldid/verify.ts` — Developer Portal API integration
- [ ] W1.2: `src/worldid/nullifier-store.ts` — atomic persistence, action namespacing
- [ ] W1.3: Extend `MemberSchema` with worldId fields (optional)
- [ ] W1.4: Extend `InviteSchema` with `requiresWorldId`
- [ ] W1.5: Add `world-id-verified` to `AuditEntrySchema` actions
- [ ] W1.6: Update `invite-member` — auto-set `requiresWorldId` for gated roles
- [ ] W1.7: Update `accept-invite` — World ID verification + nullifier uniqueness
- [ ] W1.8: HTTP endpoint `POST /api/worldid/verify`
- [ ] W1.9: HTTP endpoint `POST /api/session`
- [ ] W1.10: Update `resolveCallerRole` — session token as priority 1

### Workstream W2: Static Verify Page
- [ ] W2.1: `public/verify.html` — single-file IDKit integration
- [ ] W2.2: Express route `GET /verify` + query params (`?invite=X&role=Y`)
- [ ] W2.3: Developer Portal app registration + action setup

### Workstream W3: Sybil Defense 
- [ ] W3.1: Nullifier uniqueness enforcement with user-friendly error
- [ ] W3.2: Nullifier revocation on member removal
- [ ] W3.3: Legacy Manager backward compat
- [ ] W3.4: Action mismatch rejection
- [ ] W3.5: Replay protection (5-min window)

### Workstream W4: Tests 
- [ ] W4.1: World ID verify unit tests (WI1-WI6)
- [ ] W4.2: Nullifier store tests (NS1-NS5)
- [ ] W4.3: Invite + accept with World ID tests (IA1-IA7)
- [ ] W4.4: HTTP endpoint tests (HE1-HE5)
- [ ] W4.5: Session middleware tests (SM1-SM5)
- [ ] W4.6: Schema backward compat tests (SC1-SC3)
- [ ] W4.7: E2E sybil rejection (SB1-SB3)
- [ ] W4.8: E2E legacy Manager backward compat (LM1-LM4)
- [ ] W4.9: E2E Claude Desktop unchanged — Sprint 2 regression guard (CD1-CD3)

### Workstream W5: Demo Prep + Submission 
- [ ] W5.1: README — World ID + School Pilot section
- [ ] W5.2: Demo video (3 min) — record + edit + final cut
- [ ] W5.3: Pitch deck (10 slides)
- [ ] W5.4: World Build application submission before deadline



## Current Blocker
_Sprint not yet started. Begins at hackathon kickoff April 23, 2026._

## Test Results
_To be populated._

**Target new tests:** ~35. **Total after Sprint 3.0 (trimmed):** ~222.
**Ship floor if tests slip:** 22 tests (WI1-WI6 + NS1-NS5 + IA1-IA5 + SB1-SB3 + CD1-CD3).

## Dependencies Status
| Dependency | Status |
|------------|--------|
| `@worldcoin/idkit-standalone` CDN | 🔜 Add script tag to verify.html |
| World Developer Portal app | 🔜 Register pre-sprint |
| Railway deployment (Sprint 2.75) | ✅ Already deployed |
| Base Sepolia treasury funded | 🔜 Fund pre-sprint |
| `jsonwebtoken` for session | 🔜 npm install |
| Success Academy partnership confirmation | 🔜 Confirm pre-sprint (see Decision 9 in plan) |

## Failed Approaches (Carried Forward)
_Sprint 1-2.75:_
- OWS `signAndSend`/`signTransaction` → viem walletClient
- `process.cwd()` for dataDir → `import.meta.url`
- MCP SDK global RBAC intercept → per-tool guards
- Single `OWS_PASSPHRASE` → per-family keys
- x402 on learner tools → B6 override
- Learner cross-child verify → B7 strict enforcement

_Sprint 3.0:_
- Full Next.js Mini App frontend → static HTML page (scope cut, distribution via school orb events instead of World App directory)
- AgentKit integration → deferred to Sprint 3.5 (ecosystem coordination requires Seoul presence)

## Open Risks Entering Sprint 3.0

1. **Success Academy partnership status** — needs honest classification before pitch writing. Aspirational language in deck hurts credibility.
2. **Developer Portal rate limits at test frequency** — mitigation: mock proof verification in unit tests, live API only in E2E
3. **IDKit rendering in target browser** — unverified until Spike phase. Backup: mock verification in demo with disclosure
4. **Sprint 2.75 latent bugs** — 3 hours allocated for validation + fixes. If validation surfaces issues past hour 6, cancel Sprint 3.0 and submit Sprint 2.75 as production-ready
5. **Solo execution with no teammate** — buffer is the mitigation; 22 hours of slack covers realistic surprises

## Post-Sprint Outcomes

### If advance to Seoul:
- Sprint 3.5 scope: AgentKit, World Chain USDC, legacy Manager upgrade, production Mini App review, Success Academy pilot event
- May 10-18 Build Week attendance
- Grant conversation with World Foundation

### If do not advance:
- Verify page still ships — strengthens public sybil posture for any deployment
- World ID backend still ships — unblocks Success Academy pitch
- Demo video reusable as standalone marketing asset
- Sprint 3.1 becomes smaller polish pass without Seoul cohort support