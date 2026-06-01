/**
 * Sprint 4.1 W0 + W8 — `WalletDistributor` perf benchmark harness.
 *
 * Methodology (per plan §4 W0 + research §7):
 *   - 100 sequential `transferUSDC` calls on Base Sepolia from a
 *     pre-funded treasury to an authorized child wallet.
 *   - Measure `performance.now()` wall-clock per call.
 *   - Capture p50, p95, p99, mean, stddev.
 *   - Decompose into the scrypt window (pre-4.1) or HKDF window
 *     (post-4.1) vs the RPC-bound tail.
 *
 * Outputs:
 *   - `sprint-4.0.1/baselines/pre-4.1.json`  — captured before the W6
 *     cutover (operator runs against the `pre-sprint-4.1` git tag).
 *   - `sprint-4.0.1/baselines/post-4.1.json` — captured after cutover.
 *
 * The locked assertion (C9) lives in
 * `tests/bench/distributor.bench.test.ts` and compares the two JSON
 * files. It skips if either baseline is missing (the operator runs the
 * harness once per direction; CI just enforces the delta thereafter).
 *
 * Run locally:
 *   OWS_BENCH_TREASURY_PRIVKEY=0x… \
 *     OWS_BENCH_AUTHORIZED_CHILD_ADDRESS=0x… \
 *     BASE_SEPOLIA_RPC_URL=… \
 *     OWS_BENCH_FAMILY_ID=… \
 *     OWS_BENCH_OUTPUT=sprint-4.0.1/baselines/post-4.1.json \
 *     npx tsx tests/bench/distributor.bench.ts
 *
 * This file intentionally exports a `main()` instead of `describe()`
 * blocks — vitest's `include: ["tests/**\/*.test.ts"]` glob excludes it
 * from regular runs.
 */
import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import { WalletDistributor } from "../../src/wallet/distributor.js";
import { FamilyApiTokenManager } from "../../src/keys/family-api-tokens.js";
import { CHAIN_IDS, USDC, WALLET_NAMES } from "../../src/constants.js";
import { getFamilyVaultPath } from "../../src/engine/state.js";

interface BenchSummary {
  generatedAt: string;
  sample: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  mean_ms: number;
  stddev_ms: number;
  min_ms: number;
  max_ms: number;
  notes: string;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

function summarize(samples: number[], notes: string): BenchSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((s, n) => s + n, 0) / sorted.length;
  const variance =
    sorted.reduce((s, n) => s + (n - mean) ** 2, 0) / sorted.length;
  return {
    generatedAt: new Date().toISOString(),
    sample: sorted.length,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    p99_ms: percentile(sorted, 99),
    mean_ms: mean,
    stddev_ms: Math.sqrt(variance),
    min_ms: sorted[0]!,
    max_ms: sorted[sorted.length - 1]!,
    notes,
  };
}

export async function runBenchmark(opts: {
  familyId: string;
  iterations?: number;
  output: string;
  notes?: string;
}): Promise<BenchSummary> {
  const iterations = opts.iterations ?? 100;
  const tokens = new FamilyApiTokenManager();
  const token = tokens.getToken(opts.familyId);
  if (!token) {
    throw new Error(
      `Bench: no API token for family ${opts.familyId}. ` +
        `Bootstrap the family or run lazyMintTokenForLegacyFamily first.`
    );
  }
  const dist = new WalletDistributor(token, getFamilyVaultPath(opts.familyId));

  // Tiny amount so 100 sequential transfers stay within a reasonable
  // testnet USDC budget. Adjust via env if the treasury is well-funded.
  const amount = Number(process.env.OWS_BENCH_AMOUNT_MICRO ?? "1000");
  const destination =
    process.env.OWS_BENCH_AUTHORIZED_CHILD_ADDRESS ??
    (() => {
      throw new Error(
        "OWS_BENCH_AUTHORIZED_CHILD_ADDRESS env var is required"
      );
    })();

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await dist.transferUSDC(
      WALLET_NAMES.TREASURY,
      "child-bench",
      amount,
      CHAIN_IDS.BASE_SEPOLIA,
      USDC.BASE_SEPOLIA,
      destination
    );
    samples.push(performance.now() - start);
    if (i % 10 === 9) {
      console.error(`[bench] ${i + 1}/${iterations} done`);
    }
  }

  const summary = summarize(samples, opts.notes ?? "");
  const outputDir = dirname(opts.output);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(opts.output, JSON.stringify(summary, null, 2), "utf-8");
  console.error(`[bench] wrote ${opts.output}`);
  console.error(
    `[bench] p50=${summary.p50_ms.toFixed(1)}ms ` +
      `p95=${summary.p95_ms.toFixed(1)}ms ` +
      `p99=${summary.p99_ms.toFixed(1)}ms ` +
      `mean=${summary.mean_ms.toFixed(1)}ms (n=${summary.sample})`
  );
  return summary;
}

// CLI entry point.
if (process.argv[1]?.endsWith("distributor.bench.ts")) {
  const familyId = process.env.OWS_BENCH_FAMILY_ID;
  const output = process.env.OWS_BENCH_OUTPUT;
  if (!familyId || !output) {
    console.error(
      "Usage: OWS_BENCH_FAMILY_ID=<uuid> OWS_BENCH_OUTPUT=<path> " +
        "OWS_BENCH_AUTHORIZED_CHILD_ADDRESS=0x… " +
        "npx tsx tests/bench/distributor.bench.ts"
    );
    process.exit(1);
  }
  runBenchmark({
    familyId,
    output,
    notes: process.env.OWS_BENCH_NOTES ?? "",
  }).catch((err) => {
    console.error("[bench] failed:", err);
    process.exit(1);
  });
}
