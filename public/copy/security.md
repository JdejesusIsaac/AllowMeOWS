# How AllowMe handles your family's data

AllowMe encrypts sensitive material at rest and in transit whenever we control both sides (for example, server-to-server traffic and payloads we store encrypted on disk).

## Outbound transfers and the allowlist

USDC payouts from your family's treasury cannot go anywhere we have not enumerated: every destination sits on your **family allowlist**. That is enforced when `distribute-allowance` runs so kids' funds only reach authorized destinations you configured.

## Transparency and audit

Every meaningful administration action emits an **audit** entry—the same record set that parents review from Claude (`view-policy` / tooling that surfaces the ledger). We would rather expose what happened than pretend nothing was logged.

## What we are careful *not* to claim

Today's pilot relies on delegated infrastructure operated on your behalf. We do **not** describe AllowMe today as handing every key directly to minors with zero intermediary—that **noncustodial** marketing frame is deliberately reserved until **Sprint 4**.

## Where self-custody fits

**Sprint 4** narrows custody questions by onboarding families through **Coinbase Smart Wallet** and related **self-custodial** patterns so children can progressively hold keys alongside policy guardrails. Until that rollout ships, assume the treasury and savings vault semantics you see in tooling are stewarded as described above—not yet the full decentralized story.
