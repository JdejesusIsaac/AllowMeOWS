/**
 * Sprint 4.1 W8 — locked performance assertion (AM-PERF-1, contract C9).
 *
 * Compares the two baseline JSON files written by
 * `tests/bench/distributor.bench.ts`:
 *   - `sprint-4.0.1/baselines/pre-4.1.json`  (captured against the
 *     `pre-sprint-4.1` tag, owner-mode signing + scrypt per transfer).
 *   - `sprint-4.0.1/baselines/post-4.1.json` (captured after the W6
 *     cutover, agent-mode signing).
 *
 * Skips (with a warning) if either file is missing — CI shouldn't fail
 * just because the operator hasn't run the harness yet. After the first
 * operator run captures BOTH files, the assertion locks in.
 *
 * The locked deltas come from contract C9:
 *   - p50 drops by ≥ 40ms.
 *   - p95 drops by ≥ 60ms.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PRE = join(process.cwd(), "sprint-4.0.1/baselines/pre-4.1.json");
const POST = join(process.cwd(), "sprint-4.0.1/baselines/post-4.1.json");

interface BenchSummary {
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  mean_ms: number;
  sample: number;
}

const baselinesAvailable = existsSync(PRE) && existsSync(POST);

(baselinesAvailable ? describe : describe.skip)(
  "AM-PERF-1: locked scrypt-elimination assertion (Sprint 4.1 W8, contract C9)",
  () => {
    it("AM-PERF-1: post-4.1 p50 drops by ≥40ms and p95 drops by ≥60ms vs pre-4.1 baseline", () => {
      const pre = JSON.parse(readFileSync(PRE, "utf-8")) as BenchSummary;
      const post = JSON.parse(readFileSync(POST, "utf-8")) as BenchSummary;

      // Document the sample sizes so a regression isn't traced back to
      // an undersized run.
      expect(pre.sample).toBeGreaterThanOrEqual(50);
      expect(post.sample).toBeGreaterThanOrEqual(50);

      expect(
        post.p50_ms,
        `post-4.1 p50=${post.p50_ms.toFixed(1)}ms vs pre=${pre.p50_ms.toFixed(1)}ms — ` +
          `expected at least 40ms drop (scrypt elimination)`
      ).toBeLessThan(pre.p50_ms - 40);

      expect(
        post.p95_ms,
        `post-4.1 p95=${post.p95_ms.toFixed(1)}ms vs pre=${pre.p95_ms.toFixed(1)}ms — ` +
          `expected at least 60ms drop`
      ).toBeLessThan(pre.p95_ms - 60);
    });
  }
);

if (!baselinesAvailable) {
  // Vitest's describe.skip swallows the body silently; emit a single
  // line so operators know what to do.
  // eslint-disable-next-line no-console
  console.error(
    `[bench] AM-PERF-1 skipped — missing ` +
      (existsSync(PRE) ? "" : "sprint-4.0.1/baselines/pre-4.1.json ") +
      (existsSync(POST) ? "" : "sprint-4.0.1/baselines/post-4.1.json. ") +
      `Run \`npx tsx tests/bench/distributor.bench.ts\` per plan §4 W0+W8.`
  );
}
