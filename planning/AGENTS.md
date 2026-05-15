# Planning Phase (Phase 1)

- Inputs: Phase 0a problem framing + `research/research.md` with spike results.
- Outputs: `planning/plan.md` + negotiated `planning/contract.md`.
- Do NOT plan if `research/research.md` has unresolved `⚠️` spike candidates.

## Sprint Contract Negotiation

The contract is NEGOTIATED, not dictated:

1. Planner drafts `contract.md` with proposed scope, deliverables, and verification criteria.
2. Evaluator reviews `contract.md` and proposes changes.
3. Both iterate in `contract.md` until aligned.
4. Only then does implementation begin.

## Dynamic Rubric Weights

- Security-critical (wallet ops, approvals): Func 30%, Auth/Security 50%, Design 10%, Orig 10%.
- Frontend/UX: Func 35%, Auth 15%, Design 40%, Orig 10%.
- Infrastructure: Func 45%, Auth 25%, Design 10%, Orig 20%.

## Available MCPs

- sequential-thinking: Architecture decision reasoning
- brave-search: Verify technical assumptions
- figma: Design reference when frontend work is in scope
