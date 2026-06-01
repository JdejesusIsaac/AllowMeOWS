import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
    fileParallelism: false,
    // Sprint 4.0.2 contract C11 / OB-COV-1 — strict 100% branch coverage
    // gate on the redactor (security boundary). Other observability
    // modules retain the ≥85% bar per the contract.
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/observability/**/*.ts",
        // Sprint 4.0.3 LS-COV-1 — the ledger engine and the only on-chain
        // settlement path are the load-bearing money-integrity surface.
        "src/engine/ledger.ts",
        "src/tools/settle-balance.ts",
      ],
      thresholds: {
        // Module-specific: redactor is the load-bearing security gate.
        // Any uncovered branch is a possible token-leak vector.
        "src/observability/redact.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Other observability modules: standard floor.
        "src/observability/**/*.ts": {
          branches: 85,
          functions: 85,
          lines: 85,
        },
        // Sprint 4.0.3 LS-COV-1 (contract DEL16 / C12). The ledger is the
        // system-of-record for "money owed"; any uncovered branch is a
        // potential ledger-vs-chain divergence vector.
        "src/engine/ledger.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // settle-balance is the only path that reaches chain post-cutover.
        "src/tools/settle-balance.ts": {
          branches: 95,
          functions: 100,
          lines: 95,
        },
      },
    },
  },
});
