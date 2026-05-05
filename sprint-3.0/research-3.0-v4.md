# Sprint 3.0 v4 — Supplementary Research

Addenda to `research-3.0.md` produced during implementation. New findings
landed after the v4 sprint contract was locked go here so the planner /
evaluator pair can trace decisions without re-reading chat transcripts.

---

## Verify-page invite redemption — security/UX trade-off

### Decision

The verify-page invite-redemption flow accepts `?invite=CODE` from the URL
query string and pre-fills the invite code input. Before redemption, the
page calls a new endpoint `GET /api/invites/:code/preview` to resolve the
invite metadata (family name, role, child name for Learner invites,
expiresAt) and renders this context inline so the recipient can confirm
they are joining the intended family before tapping the redeem button.

The recipient (Sofia) receives a URL, opens it, sees "Joining the Asencio
family as Learner — Sofia," confirms with one tap, gets her magic-link
MCP URL.

### Threat model

The "leak" scenario: Cesar generates Sofia's Learner invite, the response
includes `https://allowme.dev/verify?invite=SOFI-LEARN-X7K2&role=learner`,
Cesar texts that URL to Sofia. Plausible intercept paths:

- Sofia screenshots and shares with friends in a group chat
- Sofia's phone backup is compromised
- A sibling or other household member grabs Sofia's phone before she
  redeems
- An attacker gains access to Cesar's outgoing SMS

Whoever clicks the URL before Sofia does can redeem the invite as
themselves and become a Learner-role Member in the Asencio family,
scoped to Sofia's child record. Capabilities granted to that attacker:
`verify-achievement` (can fabricate fake achievements), `check-progress`,
`check-savings` (can read Sofia's data).

### Why this is not a new risk class

The invite code itself has always been a bearer credential under
Sprint 2.9. `accept-invite` accepts the code from any caller from any
Claude session — it never validated the redeemer's identity beyond
"holds the code." The verify-page URL makes the existing intercept path
*easier* (one tap vs paste-into-Claude) but does not introduce a new
attack class. The URL is no more sensitive than the invite code itself,
which is a 14-character bearer token already treatable as
secret-but-low-value.

### Mitigations relied upon (existing, Sprint 2.9)

- **Single-use enforcement.** `accept-invite` marks invites as
  `used: true` after redemption; subsequent attempts fail. The verify
  page redemption path goes through the same `acceptInviteCore`
  function (W1.12 extraction), so single-use is enforced uniformly.
  Test HE7 confirms this round-trips correctly through the verify-page
  HTTP path.
- **48-hour expiry.** Sprint 2.9.1 default for invite TTL
  (`INVITE.EXPIRY_HOURS = 48` in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/constants.ts:99`).
  Limits the window during which an intercepted URL is exploitable.
- **Per-family scoping.** A Learner invite for the Asencio family
  cannot be redeemed against another family. The intercept yields
  Asencio-family Learner access only.

### What the preview endpoint discloses

`GET /api/invites/:code/preview` returns, for a valid unconsumed invite:

- `familyName` — already disclosed in the verify-page success state
  regardless, so previewing is no incremental leak.
- `role` — same as above; the role is implied by the `?role=` query
  param the URL already carries.
- `childName` — for Learner-role invites only. **Small PII disclosure
  (child's first name).** Considered acceptable because the URL
  recipient already holds the bearer credential, and recognition
  ("Joining as Learner — Sofia") is meaningful UX feedback for the
  child that they are in the right place. For non-Learner roles,
  `childName` is omitted from the preview response.
- `expiresAt` — informational, used to render "this invite expires in
  X hours" warnings in the UI.

The preview endpoint deliberately does **not** disclose: the invite
creator's identity, the family's wallet addresses, member counts, or
any economy state (balances, achievements, savings).

### Rate limiting

The preview endpoint is rate-limited to mitigate enumeration. Invite
codes have ~20 bits of entropy (4-character alphanumeric suffix in the
Sprint 2.9.1 generator over a 32-char alphabet; the prefix/role-hint
segments are structurally knowable), which is below brute-force-resistance
thresholds for an unrate-limited endpoint. Limit: **30 preview requests
per IP per minute**, with a 429 response carrying a `Retry-After` header
on excess. This is loose enough that legitimate users (refreshing the
page, retrying after expired session) are not affected.

The same rate-limit middleware is reusable for `/api/auth/nonce`,
which has the same enumeration risk surface and was previously
unaddressed in the v4 plan.

### What is explicitly NOT done in Sprint 3.0 v4

- **Parent-confirmation OTP.** A separate code sent to the parent that
  must be entered alongside the invite code. Friction without
  proportional security gain — an attacker with URL access likely
  also has SMS context. Sprint 3.5+ if pilot data surfaces actual
  abuse.
- **"Type the child's name to confirm" challenge.** Casually defeated
  by an attacker who has the URL (childName is in the preview
  response).
- **Multi-factor invite redemption.** Same reasoning.
- **Invite-code masking by default in the input.** Considered, rejected.
  Visual masking is a security theatre cue without real benefit when
  the code is already in the URL the user can see in their browser
  address bar. The input renders the code in plain text. UX copy
  ("Don't share this link") carries the appropriate user-facing
  guidance.

### Failure modes the preview must handle cleanly

| Scenario | Preview response | UI rendering |
|----------|------------------|--------------|
| Code is well-formed, invite exists, not used, not expired | 200 with metadata | Success state — render family context, "Join family" button |
| Code is well-formed, invite does not exist | 404 | Error state — "This invite was not found. Ask your parent for a new one." |
| Code is well-formed, invite exists, already used | 410 Gone | Error state — "This invite has already been redeemed." |
| Code is well-formed, invite exists, expired | 410 Gone with `expired: true` payload | Error state — "This invite expired. Ask your parent for a new one." |
| Code is malformed (wrong shape) | 400 | Error state — "This invite link looks broken. Check the URL or ask for a new one." |
| Rate limit exceeded | 429 with `Retry-After` | Soft error — "Too many checks, try again in a minute." Does not lose the user — they can retry. |

Critically, the preview endpoint **does not consume the invite under any
circumstance**, including transient backend errors. Consumption happens
only at `/api/redeem-invite`, on successful redemption. This separation
ensures a flaky preview cannot accidentally burn a parent-generated
invite. **HE8d** is the regression test that locks this contract.

### Implementation surfaces (landed in Sprint 3.0 v4)

- **Core function** — `previewInvite(code)` + `InviteUsedError`,
  `InviteExpiredError`, `InviteMalformedError` in
  `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/invite-preview.ts`.
  Sibling to `accept-invite.ts` rather than appended to it so the
  read-only preview path can never accidentally share state-mutation
  helpers with the consumption path.
- **HTTP route** — `GET /api/invites/:code/preview` in
  `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/app/verify-routes.ts`,
  rate-limited via `previewRateLimit`.
- **Rate-limit middleware** —
  `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/middleware/rate-limit.ts`
  exports `makeRateLimiter({ perMinute, keyFn })` and a preset
  `previewRateLimit` (30/min/IP). In-memory token bucket, sufficient
  for single-instance Railway. Sprint 4.0 multi-instance → Redis.

### Why this is the right cut

The alternative designs considered:

- **No preview, blind redemption.** Sofia opens URL, sees an empty
  form-like state with no confirmation of which family she is joining.
  Defeats the magic-link UX win.
- **Preview without childName.** Slight reduction in PII leak but loses
  the recognition UX for the child. Children confirming "yes that is my
  family, that is my name" is genuine usability, not vanity. Adults
  also benefit — a Co-parent invite preview shows the family they are
  joining without needing to know in advance.
- **Preview with full family context (members list, child count, etc).**
  Significant PII leak for marginal UX gain. Rejected.

The chosen middle ground (family + role + childName + expiresAt) trades
a small first-name PII disclosure for meaningful UX confirmation, with
the threat model documented and the trade-off explicit.
