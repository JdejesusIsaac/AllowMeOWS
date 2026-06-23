# AllowMe Kid Dashboard — Product Design Package

*Produced with the EdTech Product Designer methodology (Product Designer mode). Note: the skill's exact reference templates (`product-designer.md` etc.) weren't available, so this uses faithful standard equivalents — share those files and I'll re-render to match.*

Feature: the kid-facing AllowMe dashboard. Band in scope: **Builders (8–11)**. Companion visual prototype: [`kid-dashboard-builders.html`](./kid-dashboard-builders.html).

---

## Rationale (why this design)

AllowMe pays kids stablecoin for verified learning. The dashboard is the only surface the child actually sees, so it carries the whole product's values. Two forces shape every decision:

1. **Reward can backfire.** Paid-to-learn can crowd out intrinsic motivation (overjustification). So the dashboard makes *progress and mastery* the hero and treats the money as a happy by-product, not the headline.
2. **A kid must never be lost.** Concrete-operational kids need one obvious next action, visible progress, and a clear "you're here." Cognitive load is the enemy.

Everything below serves those two forces, then ties back to measurement.

---

## The Four (defined before any UI)

| | |
|---|---|
| **User** | Primary: learner age 8–11 (Builders). Secondary: parent/guardian. |
| **Goal** | In one glance the kid knows where they are, that they're progressing, and what to do next — and feels capable. |
| **Outcome** | Sustained learning that builds real AI literacy + healthy money habits, with intrinsic motivation preserved. |
| **Measurement** | Weekly return, verified completions, mastery progression, % saving to vault, goal completion, parent trust, and an intrinsic-motivation guardrail. |

---

## 1. Problem statement

Kids who earn rewards for learning often chase the reward and abandon the learning the moment it stops, and they lose motivation when progress is invisible or the next step is unclear. AllowMe needs a kid-facing surface that keeps an 8–11-year-old oriented and motivated by *competence and autonomy* (not just payout), shows verified progress at a glance, and makes the reward feel earned and fair — all without manipulative engagement mechanics.

**Success looks like:** a kid opens the dashboard, immediately knows their next step and how close they are to a goal they chose, completes a lesson, sees transparently why they were rewarded, and returns because they feel capable — not because they're afraid of losing a streak.

---

## 2. Personas

**Maya — 9, the learner (primary)**
- Context: 4th grade, uses a family tablet ~20 min after school. Reads short sentences. Loves drawing.
- Goals: save up for an art set; feel smart; "win" without being scared of losing.
- Frustrations: gets stuck and gives up; can't tell if she's making progress; adult apps feel confusing.
- Motivation drivers (SDT): autonomy (she picked the goal), competence (visible mastery), relatedness (a proud parent).
- Accessibility: still-developing fine motor control; reads slowly; sensitive to overwhelming screens.

**David — 38, the parent (secondary)**
- Context: busy; does not want another app to actively manage.
- Goals: kid builds good habits; trusts the rewards are genuinely earned; can encourage in seconds.
- Frustrations: surveillance-y parent dashboards; manual oversight; not knowing if the kid actually did the work.
- Need: a glanceable, trustworthy summary and a one-tap way to encourage — not a management console.

---

## 3. User stories (with acceptance criteria)

**S1 — Orientation.** As a learner, I want to see how close I am to my goal so I know it's worth continuing.
- AC: goal name, progress %, and amount-of-target are visible on the home screen without scrolling. Progress is shown visually (ring/bar), not just numerically.

**S2 — Next action.** As a learner, I want to know what to do next so I'm never stuck.
- AC: exactly one primary action is obvious on every screen. The home screen surfaces the single recommended next step.

**S3 — Fair reward.** As a learner, I want to understand why I earned a reward so it feels fair and I learn from it.
- AC: every earning event has a plain-language "why you earned this," including the grader's confidence and whether a human checked it.

**S4 — Ownership.** As a learner, I want to choose my own goal so it feels like mine.
- AC: the kid selects/edits the goal (with parent approval); the chosen goal is the one shown on home.

**S5 — Patience pays.** As a learner, I want to save and watch it grow so I learn that waiting is worth it.
- AC: the vault shows current → grown amount (1.5×), time remaining, framed as growth; never as "don't withdraw or you lose."

**S6 — Calm close.** As a learner, I want a clear "you're done for today" so I'm not pushed to keep going.
- AC: a daily-complete state exists; no FOMO notifications; no streak-loss guilt.

**S7 — Parent trust.** As a parent, I want a quick, trustworthy summary so I can encourage without managing.
- AC: parent sees earned/goal/lessons + a verification line ("verified as the child's own work") + a one-tap "send a cheer."

---

## 4. User flows

**F1 — Onboarding (parent-initiated):** parent connects the family account → parent + kid pick a first goal → kid lands on the dashboard with one recommended next step.

**F2 — Core loop (the daily path):** open dashboard → see progress + single next action → do a lesson → submission verified → reward applied → home updates (progress + "why you earned this") → optional: lock some to the vault → daily-complete state.

**F3 — Goal completion:** progress reaches 100% → celebration moment → redeem (parent-mediated) → choose next goal.

**F4 — Parent loop:** parent asks the family AI ("how's Maya doing?") or opens the view → glanceable summary card → send a cheer / review a flagged answer.

---

## 5. Information architecture

**Kid app (4 sections, one primary action each):**
- **Home** — balance (secondary), chosen goal + progress (primary focus), single next action. *Primary action: "Start today's lesson."*
- **Learn** — current lesson + what's next. *Primary action: continue.*
- **Vault** — current → grown, time left. *Primary action: "Add to vault."*
- **Badges** — earned + next tier and what unlocks it. *Primary action: see next badge.*

**Parent surface:** a single in-conversation summary card (earned, goal, lessons, verification, AI summary) with actions: cheer, add to goal, review flagged. No standalone management console.

Principle applied: progress, mastery level, completion status, and the next recommended action are exposed on every screen. Hidden progress is prohibited.

---

## 6. Wireframe spec (Builders home)

Reference build: [`kid-dashboard-builders.html`](./kid-dashboard-builders.html).

- **Header:** kid avatar + greeting + a *kind* streak chip (informational, never a loss threat).
- **Hero:** "Money you've earned" + large amount in **USD** (not MON/wei) + "this week" delta + mascot. Money is prominent but framed as a by-product.
- **Bento grid (2×2):**
  - Goal card — circular progress ring + "$X of $Y" + "almost there."
  - Vault card — "$5 → $7.50," chunky bar, "12 days to go — patience pays off."
  - Learning card — today's completed lesson + calm "all done today."
  - Badges card — earned sticker + locked next tier + "2 lessons to AI Pro."
- **Why-you-earned strip:** plain-language reason + grader confidence + human-check note.
- **One primary action** on the screen: start today's lesson.

---

## 7. Figma-ready prompt (copy-paste)

```
Design a children's learning-rewards dashboard, "AllowMe — Kid (ages 8–11)". Style: claymorphism — soft inflated cards, 24–28px corners, dual shadow (outer drop 0 12px 22px -12px rgba(86,61,140,.32) + inner highlight inset 0 2px 5px rgba(255,255,255,.7)), matte candy-pastel surfaces. No flat corporate look.

Type scale: Fredoka (display: greeting 24, hero number 48–52, card titles 17–19) + Nunito (body 13–15, weights 600–800). Sentence case.

Color tokens: hero gradient #8B5CF6→#C084FC→#F472B6 (white text). Section accents — goals pink #F472B6, vault mint #2DD4BF + gold #FBBF24, learning sky #60A5FA, badges coral #FB7185. Page bg gradient #F3EEFF→#FDEEF6→#E8FBF4. Body text #3a2d55, muted #8a7aa8.

Layout (max-width 720): header row (avatar 50px rounded-18, greeting, kind streak chip) → hero card (label, $12.50 hero, "+$1.50 this week" pill, coin mascot with a face) → 2-column bento (Goal with circular progress ring at 62%; Vault "$5 → $7.50" + progress bar 60% + "12 days to go"; Learning with check + "all done today"; Badges with one earned sticker + one locked) → "why you earned this" strip (sparkle icon + plain-language reason).

Components: clay card, pill/chip, circular progress ring, chunky progress bar, sticker badge, coin mascot, hero card.

Accessibility (WCAG 2.1 AA): all text ≥4.5:1 contrast (recheck muted purple on light — darken if it fails); 44px min touch targets; visible focus rings; full keyboard nav; respect prefers-reduced-motion (no auto-animation); screen-reader labels on every icon and progress element. One primary action per screen.

Tone: warm, celebratory at reward moments, never anxious. No streak-loss threats, no countdown FOMO, no leaderboards.
```

---

## 8. Acceptance criteria (feature-level — "done" means)

- [ ] Goal, progress %, and next action visible on home without scrolling.
- [ ] Exactly one primary action per screen.
- [ ] Money shown in kid-legible USD; no MON/wei/tx-hashes in the child's view.
- [ ] Every reward has a plain-language "why," with grader confidence + human-check note.
- [ ] Vault framed as growth; no loss-aversion language anywhere.
- [ ] A daily-complete state exists; zero FOMO/streak-loss notifications.
- [ ] No leaderboards ranking kids against kids.
- [ ] WCAG 2.1 AA: contrast, keyboard, screen-reader labels, reduced-motion, 44px targets.
- [ ] Parent summary shows a verification/trust line.

---

## 9. Success metrics (close every feature with measurement)

**Learner (student) metrics**
- Weekly return rate (≥3 days/week) — target 55–65%.
- Verified lesson completions / learner / week — track trend up.
- Mastery progression — % advancing a badge tier per month.
- First-/second-attempt assessment pass rate — quality of learning, not just completion.

**Healthy-behavior metrics**
- % of earners who lock to the vault at least once — target ≥40%.
- Goal completion rate — target ≥50% of started goals.

**Intrinsic-motivation guardrail (the critical one)**
- % of sessions that are self-initiated vs reward-prompted.
- Learning continuation during a deliberate no-reward cohort week — if it collapses, the reward is crowding out curiosity and the design must change.

**Parent metrics**
- Parent trust score ("I can see and believe my child's progress").
- Encouragement actions (cheers) / week — relatedness, not surveillance.

**Business metrics**
- W4 retention; conversion to paid (if applicable); parent NPS.

**Anti-metric (explicitly NOT optimized):** time-in-app. We treat long sessions as a health flag, not a win. A kid who learned and left is a success.

---

## Learning-first check (push-back)

Per the skill's rule — every feature must improve knowledge, retention, assessment, engagement, or (here) parent efficiency, or it gets challenged:

- **Hero balance:** improves engagement but risks overjustification. *Mitigation:* keep mastery/progress co-equal with money; never let the number be the only hero. This is the one place to watch hardest.
- **Vault:** improves healthy behavior + teaches delayed gratification (knowledge). Keep.
- **Badges:** improve engagement + make mastery visible. Keep.
- **Mascot:** improves engagement only — acceptable as delight, but it must never gate or guilt. Keep, bounded.
- **Rejected by this rule:** kid-vs-kid leaderboards (harm the bottom cohort, no learning gain) — not in the design.

---

## Accessibility (WCAG 2.1 AA — not an afterthought)

- Contrast: white-on-gradient hero passes; **recheck muted purple (#8a7aa8) on light backgrounds** for small text — darken toward #6a5a88 if it fails 4.5:1.
- Touch: 44px minimum targets (kid motor skills).
- Keyboard: full navigation; visible focus rings.
- Screen reader: labels on every icon, progress ring, and badge state.
- Motion: respect `prefers-reduced-motion`; celebrations are optional and gentle.
- Reading: icon + (for younger bands) audio support so function never depends on reading speed.
