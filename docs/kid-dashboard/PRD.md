# Kid Dashboard + AI-Literacy Track — PRD

*Produced with the EdTech Product Designer skill, Product Manager mode. Completes the end-to-end pass: Learning Experience (`AI-LITERACY-LEARNING-EXPERIENCE.md`) → Product Designer (`PRODUCT-DESIGN-PACKAGE.md`) → this PRD. Docs only; no `src/` changes are included in this branch.*

## Summary

A graphical, age-banded kid-facing dashboard for AllowanceAgent, plus a parallel AI-literacy learning track that runs on the existing Learning Mode engine. The dashboard makes progress visible on data the MCP tools already return; the track gives the dashboard's goals and badges real pedagogy. Together they turn the kid surface from Markdown cards into a learning product.

## Problem

Today the kid-facing surface is Markdown rich cards, and the only Learning Mode track is math. Progress is hard for an 8–11-year-old to read at a glance, the "AI Learner → Master" badges have no curriculum behind them, and the product's stated mission (incentivizing AI best practices) has no kid-facing learning path. A reward system with invisible progress and no real learning underneath risks paying for activity instead of mastery.

## Goals

1. Make a child's progress, balance (earned-vs-settled), and next action legible in one glance — improving lesson-completion and 7/30-day retention.
2. Stand up an AI-literacy track whose mastery is genuine and gaming-resistant — measured by an integrity metric (≥ 90% of sessions confidence-"ok") and applied-assessment accuracy on novel items.
3. Preserve intrinsic motivation — guardrail: learning continues during a no-reward cohort week.

## Non-Goals

- **Not** redesigning the Learning Mode engine, ledger, RBAC, or payout formula — they are reused as-is.
- **Not** building a standalone consumer web app in this scope (MCP App first; web is Later).
- **Not** KYC/identity verification — this is the family product; integrity is handled by the confidence flag, not identity.
- **Not** changing how money works (chain, OWS, settlement) — USD display only on top of existing USDC-on-Base.
- **Not** shipping the Sprouts/Founders skins in the MVP — Builders first.
- **Not** a new assessment-authoring UI for parents — item banks are seeded by the team.

## Users & Personas

Primary: the learner aged 8–11 (Builders; persona "Maya" in `PRODUCT-DESIGN-PACKAGE.md`). Secondary: the parent (persona "David") who sets goals and encourages. Sprouts (5–7) and Founders (12–16) are fast-follow skins.

## User Stories

Prioritized (full set + acceptance criteria in `PRODUCT-DESIGN-PACKAGE.md`):
- S1 Orientation, S2 Next action, S3 Fair reward (the "why you earned" trace), S5 Patience pays (vault), S7 Parent trust — MVP.
- S4 Ownership (kid-set goal), S6 Calm close — MVP.
- AI-literacy mastery + badges — fast-follow.

## Requirements

### Functional

```
FR-1  configure-policy shall accept a non-math study-plan track ("ai-literacy"), validated like the
      math track, by lifting the math-only enforcement at the configure-policy boundary (plan.md
      success criterion 12).
FR-2  The system shall ship AI-literacy prompt fragments at src/prompts/ai-literacy/{perception,
      patterns,learning,talking,fairness}.md plus a shared engagement-scoring fragment, parallel to
      src/prompts/math/*.
FR-3  learning-mode.resolveCurrentPhase shall be track-aware: an AI PHASE_ORDER
      (ai-perception → ai-patterns → ai-learning → ai-talking → ai-fairness) drives phase resolution
      for ai-literacy study plans; math is unchanged.
FR-4  A session shall count toward phase mastery only when assessmentPassed AND avgEngagement >= 3
      AND confidenceFlag == "ok". A "low"-confidence session settles $0 toward mastery and emits
      learning-session-flagged-low-confidence for human review. (Integrity rule.)
FR-5  The system shall derive badge tiers (AI Learner / Explorer / Pro / Master) from the set of
      mastered phases and expose them as a field on check-progress (or a new read-only tool).
FR-6  The kid dashboard shall render as an MCP App (UI resource) that reads check-progress /
      check-savings / check-goals output: earned-vs-settled balance, weekly categories, savings vault,
      goal/phase steps, badges, and the session receipt ("why you earned").
FR-7  The learner view shall present money in USD only — no wallet addresses, tx hashes, or chain
      jargon. (Parent/manager views may show settlement detail.)
FR-8  The dashboard shall select an age-band skin (Sprouts / Builders / Founders) from the child's
      configured age. Builders is the only skin required for MVP.
FR-9  Mastery assessment items shall be applied and novel (no repeats); a seeded item bank exists per
      AI-literacy phase, including at least one critique ("spot the AI mistake") item per phase.
FR-10 Every dashboard screen shall present exactly one primary action and a calm daily-complete state;
      no streak-loss or FOMO notifications.
```

### Non-Functional

```
NFR-1 Performance — the dashboard renders from existing tool output; no new per-render on-chain calls
      beyond the already-gated balanceOf in check-progress. UI resource is cacheable.
NFR-2 Accessibility — WCAG 2.1 AA: 4.5:1 contrast (recheck the muted purple), full keyboard nav,
      screen-reader labels on every icon/progress element, prefers-reduced-motion honored, 44px targets.
NFR-3 Privacy — COPPA (under-13): minimal data, parental consent via the existing Sign-in-with-Base /
      invite flows, no third-party trackers, no behavioral-ad data. FERPA applies if a school
      distributes it. Raised explicitly — minors' data is a legal + product risk.
NFR-4 Integrity — the confidence flag is the anti-gaming control; no item bank ships without at least
      one AI-resistant (applied + personalized + novel) item per phase.
NFR-5 Scale — per-family JSON store today; unaffected by the Postgres migration (Sprint 4.0).
```

## Acceptance Criteria

```
FR-1
Given a parent configuring a child with an ai-literacy learning goal + study plan
When  configure-policy runs
Then  the goal persists with its studyPlan and no math-only rejection fires; math goals still validate.

FR-4 (the load-bearing one)
Given an ai-literacy session completes with medianTurnIntervalSeconds < 5
When  settle-session-payout / mastery evaluation runs
Then  the phase does NOT advance, $0 settles toward mastery, and a
      learning-session-flagged-low-confidence audit entry is written.

Given a session with assessmentPassed == true, avgEngagement >= 3, confidenceFlag == "ok"
When  it completes on novel items
Then  the phase advances and the receipt + payout settle normally.

FR-5
Given a child has mastered ai-perception and ai-patterns
When  check-progress runs
Then  the response includes badgeTier == "AI Learner".

FR-6 / FR-7
Given a learner opens the dashboard MCP App
When  it renders
Then  it shows ready-to-spend and pending (settles Sunday), weekly categories, the vault, goal steps,
      badges, and the "why you earned" line — with no wallet address or tx hash anywhere in the view.

FR-10
Given a learner has completed today's session
When  the dashboard renders
Then  a calm "all done today" state shows and no streak-loss/FOMO notification is emitted.
```

## Sprint Tickets

```
T1  Lift math-only boundary in configure-policy
    Desc:        Allow an "ai-literacy" study-plan track to validate + persist alongside math.
    Acceptance:  FR-1 criteria; existing math validation + tests unchanged.
    Dependencies: —
    Estimate:    S
    References:  FR-1, configure-policy.ts, plan.md criterion 12

T2  Add AI-literacy prompt fragments + AI PHASE_ORDER
    Desc:        Author 5 phase fragments + reuse engagement-scoring; add ai PHASE_ORDER constant.
    Acceptance:  Fragments load via loadFragment; resolveCurrentPhase walks the AI order.
    Dependencies: —
    Estimate:    M
    References:  FR-2, FR-3, learning-mode.ts, src/prompts/

T3  Make resolveCurrentPhase / payout track-aware
    Desc:        Thread the track through phase resolution; math path untouched.
    Acceptance:  Unit tests for AI phase progression + knownGaps revisit.
    Dependencies: T2
    Estimate:    S
    References:  FR-3, learning-mode.ts

T4  Mastery + integrity gate
    Desc:        Enforce assessmentPassed && engagement>=3 && confidence=="ok" for phase advance;
                 low-confidence → $0 + flagged audit entry.
    Acceptance:  FR-4 criteria; both branches covered by tests.
    Dependencies: T3
    Estimate:    M
    References:  FR-4, complete-learning-session.ts, settle-session-payout.ts

T5  Badge-tier derivation on check-progress
    Desc:        Compute AI Learner/Explorer/Pro/Master from mastered phases; expose as a field.
    Acceptance:  FR-5 criteria.
    Dependencies: T4
    Estimate:    S
    References:  FR-5, check-progress.ts

T6  Seed AI-literacy assessment item banks
    Desc:        Applied + novel items per phase incl. one "spot the AI mistake" critique each.
    Acceptance:  FR-9; each phase has >=1 AI-resistant item.
    Dependencies: T2
    Estimate:    M
    References:  FR-9, src/prompts/ai-literacy/

T7  Kid dashboard MCP App (Builders) — UI resource + data binding
    Desc:        Ship the Builders skin as an MCP App reading check-progress/savings/goals; USD only.
    Acceptance:  FR-6, FR-7, FR-10 criteria; renders inline in Claude.
    Dependencies: —  (works on existing math data; AI track not required)
    Estimate:    L
    References:  FR-6/7/10, docs/kid-dashboard/kid-dashboard-builders.html

T8  Age-band skin selection
    Desc:        Pick Sprouts/Builders/Founders from child age; Builders default.
    Acceptance:  FR-8.
    Dependencies: T7
    Estimate:    S
    References:  FR-8

T9  Accessibility pass
    Desc:        Contrast fix (muted purple), keyboard nav, SR labels, reduced-motion, 44px targets.
    Acceptance:  NFR-2 audited.
    Dependencies: T7
    Estimate:    S
    References:  NFR-2

T10 Pilot instrumentation
    Desc:        Log the integrity metric (% confidence "ok") + wire the no-reward guardrail cohort.
    Acceptance:  Metrics queryable; A/B cohort assignable.
    Dependencies: T4, T7
    Estimate:    M
    References:  Success Metrics
```

## Prioritization & Scope

Value-vs-effort call:

- **MVP** — T7 (Builders dashboard MCP App on existing data) + T5 + T4. This ships a real, legible kid surface on data that already exists *today* (no AI track needed), with the integrity rule live. Smallest version that improves the core outcome (visible progress → engagement/retention) and is measurable.
- **Fast-follow** — T1, T2, T3, T6 (the AI-literacy track) + T8 (Sprouts/Founders skins) + T9 + T10. High value; deferred only to keep the MVP shippable.
- **Later** — standalone web dashboard; ZK selective-disclosure credentials; teen gold (PAXG) flows in-dashboard; school/FERPA distribution; parent assessment-authoring.

Why this cut: the dashboard delivers value on the math data that exists now, so it shouldn't wait on the AI-literacy track. The cost of cutting the AI track from MVP is that the badges read against math at first — acceptable, because the surface and the integrity rule are the load-bearing pieces, and the AI track lands right after.

## Risks & Open Questions

- **Overjustification** (existential) — the reward could crowd out curiosity. Mitigation: informational framing, mastery-as-hero, the guardrail metric. Monitored, not assumed away.
- **Gameability** — an AI completing the AI-literacy test. Mitigation: FR-4 integrity rule + FR-9 AI-resistant items. This is the make-or-break.
- **MCP App reach** — the youngest kids don't own Claude/ChatGPT accounts (Path A: parent's device). Open question: is the parent-device path enough for MVP, or is a standalone web surface needed sooner?
- **configure-policy lift regression** — touching the math-only boundary risks existing validation. Mitigation: keep math path byte-identical; lock with the existing test suite.
- **Pilot size** — open: which cohort? (Candidate: the NYC/Yonkers AI-literacy workshop families.)

## Rollout

Feature-flag the dashboard MCP App. Pilot with a small cohort first; A/B the no-reward guardrail week to test intrinsic motivation. Ship Builders → measure → add the AI track → add Sprouts/Founders. No big-bang.

## Closing — measurement plan (instrumented)

```
Student metric:   Lesson-completion rate — target +15% vs current baseline (hypothesis; set baseline
                  in pilot), measured by started-vs-completed sessions.
Student metric:   7/30-day retention — target ≥ 40% W4 (hypothesis), measured by returning-learner cohort.
Learning metric:  Applied-assessment accuracy on NOVEL items — target ≥ 75% by phase 3, measured by
                  SessionRecord.assessmentScore on transfer items.
Integrity metric: % sessions confidenceFlag == "ok" — target ≥ 90%, measured from SessionRecord.
Guardrail metric: Intrinsic motivation — % self-initiated sessions + learning continuation in a no-reward
                  cohort week, measured by session-start source + A/B cohort.
Parent metric:    Trust + hours saved — measured by survey + auto-graded-session count.
Business metric:  Activation = first badge (AI Learner) earned within 2 weeks of goal set, measured by
                  time-from-goal-create to first tier.
```
