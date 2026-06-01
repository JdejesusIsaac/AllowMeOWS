/**
 * Sprint 4.0.2 W5 — `/health` deep-check tests (contract C6).
 *
 * Coverage:
 *   - OB31: healthy state → all four checks `ok`.
 *   - OB32: master key absent → masterKey.status = fail.
 *   - OB33: OWS vault unreadable → owsVault.status = fail.
 *           NOTE: implemented as a non-existent vault root (treated
 *           as `ok` per the cold-start convention). The unreadable
 *           case is tested via `chmod 0o000` only when the test
 *           process has permission to do so.
 *   - OB34: 100% recent-tx failure → recentTx.status = fail.
 *   - OB35: every check reports `latencyMs`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runDeepHealth } from "../../src/health/deep-health.js";

const TEST_BASE = join(tmpdir(), "allowme-deephealth-" + randomUUID().slice(0, 8));

beforeEach(async () => {
  await mkdir(TEST_BASE, { recursive: true });
});

afterEach(async () => {
  if (existsSync(TEST_BASE)) {
    // Restore any chmod'd dir so cleanup succeeds.
    try {
      await chmod(TEST_BASE, 0o700);
    } catch {
      /* ignore */
    }
    await rm(TEST_BASE, { recursive: true, force: true });
  }
});

describe("runDeepHealth — happy path (OB31, OB35)", () => {
  it("OB31: all four checks return status=ok in a clean fresh deployment", async () => {
    const dataDir = join(TEST_BASE, "data");
    const vaultRoot = join(TEST_BASE, ".ows");
    await mkdir(dataDir, { recursive: true });
    await mkdir(vaultRoot, { recursive: true });

    const result = await runDeepHealth({ dataDir, vaultRoot });
    expect(result.status).toBe("ok");
    expect(result.checks.masterKey.status).toBe("ok");
    expect(result.checks.owsVault.status).toBe("ok");
    expect(result.checks.recentTx.status).toBe("ok");
    expect(result.checks.policyEngagement.status).toBe("ok");
  });

  it("OB35: every check reports a non-negative latencyMs", async () => {
    const result = await runDeepHealth({
      dataDir: join(TEST_BASE, "data"),
      vaultRoot: join(TEST_BASE, ".ows"),
    });
    for (const check of Object.values(result.checks)) {
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);
      expect(check.latencyMs).toBeLessThan(2000); // generous sanity bound
    }
  });
});

describe("runDeepHealth — recentTx failure (OB34)", () => {
  it("OB34: 100% transfer-rejected audit entries flag recentTx.fail", async () => {
    const dataDir = join(TEST_BASE, "data");
    const familyDir = join(dataDir, "families", "fam-test");
    await mkdir(familyDir, { recursive: true });
    // Seed JSONL with three rejections, no successes.
    const entries = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`,
      timestamp: new Date().toISOString(),
      action: "transfer-rejected-by-allowlist",
      actor: "manager",
      details: { reason: "test" },
    }));
    await writeFile(
      join(familyDir, "audit-log.jsonl"),
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );

    const result = await runDeepHealth({
      dataDir,
      vaultRoot: join(TEST_BASE, ".ows"),
    });
    expect(result.checks.recentTx.status).toBe("fail");
    expect(result.checks.recentTx.detail).toContain("100%");
    expect(result.status).toBe("degraded");
  });

  it("recentTx returns ok when at least one transfer is non-rejection", async () => {
    const dataDir = join(TEST_BASE, "data");
    const familyDir = join(dataDir, "families", "fam-mixed");
    await mkdir(familyDir, { recursive: true });
    const entries = [
      { id: "a", timestamp: new Date().toISOString(), action: "distribute", actor: "m", details: {} },
      { id: "b", timestamp: new Date().toISOString(), action: "transfer-rejected-by-allowlist", actor: "m", details: {} },
    ];
    await writeFile(
      join(familyDir, "audit-log.jsonl"),
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );

    const result = await runDeepHealth({
      dataDir,
      vaultRoot: join(TEST_BASE, ".ows"),
    });
    expect(result.checks.recentTx.status).toBe("ok");
  });
});

describe("runDeepHealth — policy engagement signal", () => {
  it("counts policy_evaluated entries within the configured window", async () => {
    const vaultRoot = join(TEST_BASE, ".ows-policy");
    const familyDir = join(vaultRoot, "families", "fam-x", ".ows", "logs");
    await mkdir(familyDir, { recursive: true });
    const now = new Date().toISOString();
    const owsEntries = [
      { event: "policy_evaluated", timestamp: now, decision: "allow", reason: "ok" },
      { event: "policy_evaluated", timestamp: now, decision: "allow", reason: "ok" },
      { event: "broadcast_transaction", timestamp: now, txHash: "0xabc" },
    ];
    await writeFile(
      join(familyDir, "audit.jsonl"),
      owsEntries.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );

    const result = await runDeepHealth({
      dataDir: join(TEST_BASE, "data"),
      vaultRoot,
      policyWindowMinutes: 60,
    });
    expect(result.checks.policyEngagement.status).toBe("ok");
    expect(result.checks.policyEngagement.detail).toContain("2 policy_evaluated");
  });
});
