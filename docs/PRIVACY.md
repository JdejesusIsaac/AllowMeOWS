# AllowMe Privacy — what we collect and why

> Privacy commitment for the AllowMe MCP service. Reflects the
> observability architecture introduced in Sprint 4.0.2 (Axiom for
> metrics/logs, Sentry for errors).

## What we collect

AllowMe's observability layer collects four kinds of data:

1. **Trace spans** for every MCP tool call — name, role, family ID,
   duration, success/failure. Sent to Axiom (`mcp-events` dataset).
2. **Audit log entries** from two on-disk streams: the AllowMe per-family
   audit log (`data/families/<id>/audit-log.jsonl`) and the OWS per-family
   audit log (`~/.ows/families/<id>/.ows/logs/audit.jsonl`). Forwarded
   via Vector to Axiom (`audit-logs` dataset).
3. **Error events** when an unhandled exception or 5xx response occurs.
   Sent to Sentry, with PII redaction (see below).
4. **Health-check telemetry** — the per-check latency and status for the
   four `/health` deep checks. Surfaces via the health endpoint, not
   forwarded to any third party.

## Two-tier PII model

We separate sensitive data into two tiers. **Tier 1 is always redacted.
Tier 2 is preserved by design.**

### Tier 1 — always redacted (security boundary)

Four patterns are stripped before any data leaves the process:

- `ows_key_…` — OWS API tokens (bearer credentials)
- `SETUP-XXXX-XXXX` — invite setup codes
- `0x` + 64 hex chars — raw private-key material
- `OWS_PASSPHRASE=…` — environment-variable-style passphrase strings

These are credentials. Their presence in a Sentry breadcrumb or Axiom
audit event would be a security incident. The redactor at
`src/observability/redact.ts` enforces this with strict 100% branch
coverage; any uncovered branch in CI is a build failure.

The redactor is **fail-closed**: if it throws while processing a Sentry
event, the event is dropped rather than sent. A missing error report is
recoverable (we have OTel spans). A leaked token in Sentry's UI is not.

### Tier 2 — preserved by design (transparency commitment)

The following data is kept in audit logs and traces so the system stays
operable:

- **Child names** — required to attribute achievements, savings, and
  transfers to the right person. A parent who configured the family
  knows the names they entered.
- **Family names** — same reasoning.
- **Wallet addresses** — public information on a public blockchain.
- **Transaction amounts** — required to render dashboards and reconcile
  on-chain activity with the application audit trail.

We do not redact these because doing so would make the observability
data useless for diagnosing real problems (e.g. "why didn't Maya's
allowance go through this week?"). The privacy/operability trade-off is
made explicitly here; mixing the two tiers would create a false sense
of security around credentials while obscuring legitimately needed
operational data.

We do **not** collect:
- Social Security numbers, government IDs, or any real-world identity.
- Payment card numbers or banking credentials.
- Geolocation data.
- Browser fingerprints or device identifiers (beyond what's required
  for the Sign-in-with-Base flow's wallet connection).
- Child schooling records, medical data, or any third-party
  reproductively-sensitive content. Achievement descriptions written
  by a parent during `verify-achievement` flow through to Axiom, but
  these are short free-text strings (e.g. "Maya read 30min today,
  score 85, reading") authored by the parent, not gathered from any
  external service.

## Where the data lives

- **Axiom** — third-party SaaS, US-hosted (research §4.0.1). Retention:
  30 days for both `mcp-events` (traces) and `audit-logs` (forwarded
  audit streams).
- **Sentry** — third-party SaaS, US-hosted. Retention: 90 days
  (Sentry's default).
- **On-disk audit logs** — `data/families/<id>/audit-log.jsonl` (AllowMe)
  and `~/.ows/families/<id>/.ows/logs/audit.jsonl` (OWS). Owned and
  controlled by the deploying operator. Not deleted on a schedule —
  the parent's existing data-control story includes these files.

## How to exercise your rights

If you operate an AllowMe deployment and want to delete a family's
observability footprint:

1. Delete the family's local audit logs:
   - `rm -rf data/families/<family-id>/`
   - `rm -rf ~/.ows/families/<family-id>/`
2. Issue a deletion request to Axiom for events tagged with the
   family's UUID (see Axiom's data-deletion API).
3. Issue a deletion request to Sentry for any events whose payload
   includes the family's UUID. The Sentry UI's "delete events" tool
   supports targeted deletion by tag.

The wallet addresses associated with the family are recorded on the
public blockchain and cannot be deleted from there — that's a property
of the chain, not of AllowMe.

## Changes to this policy

This document ships with the codebase. Changes go through the same
review process as code; the commit history is the change log.

- **2026-05-24** — Initial version. Sprint 4.0.2.
