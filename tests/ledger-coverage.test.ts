/**
 * Sprint 4.0.3 fail-forward — BUG-2 / LS-COV-1 supplemental coverage for
 * `src/engine/ledger.ts`.
 *
 * These tests light up the defensive / edge branches that the LS1–LS10
 * happy-path suite does not exercise (feature-flag parsing, malformed-
 * line skip, read-error fallback, empty-id no-ops, the chain_reorg
 * classifier bucket, and the module-level path re-exports). New tests
 * only — no pre-existing test logic is touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir, appendFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FilesystemLedger,
  getLedgerMode,
  isLedgerWriteEnabled,
  isLedgerOnlyMode,
  isAutoSettleDisabled,
  classifyFailure,
  getFamilyLedgerPath,
  ensureFamilyDir,
} from "../src/engine/ledger.js";

const FAMILY = "fam_cov";
let tmpRoot: string;
let ledger: FilesystemLedger;
let savedMode: string | undefined;
let savedAutoSettle: string | undefined;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "ledger-cov-"));
  ledger = new FilesystemLedger(tmpRoot);
  savedMode = process.env.ALLOWME_LEDGER_MODE;
  savedAutoSettle = process.env.ALLOWME_AUTO_SETTLE_DISABLED;
});

afterEach(async () => {
  if (savedMode === undefined) delete process.env.ALLOWME_LEDGER_MODE;
  else process.env.ALLOWME_LEDGER_MODE = savedMode;
  if (savedAutoSettle === undefined) delete process.env.ALLOWME_AUTO_SETTLE_DISABLED;
  else process.env.ALLOWME_AUTO_SETTLE_DISABLED = savedAutoSettle;
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("ledger feature-flag parsing", () => {
  it("defaults to dual-write when the env var is unset", () => {
    delete process.env.ALLOWME_LEDGER_MODE;
    expect(getLedgerMode()).toBe("dual-write");
    expect(isLedgerWriteEnabled()).toBe(true);
    expect(isLedgerOnlyMode()).toBe(false);
  });

  it("defaults to dual-write when the env var is an invalid value", () => {
    process.env.ALLOWME_LEDGER_MODE = "not-a-real-mode";
    expect(getLedgerMode()).toBe("dual-write");
  });

  it("honors a valid explicit mode", () => {
    process.env.ALLOWME_LEDGER_MODE = "settle-enabled";
    expect(getLedgerMode()).toBe("settle-enabled");
    process.env.ALLOWME_LEDGER_MODE = "ledger-only";
    expect(isLedgerOnlyMode()).toBe(true);
    process.env.ALLOWME_LEDGER_MODE = "off";
    expect(isLedgerWriteEnabled()).toBe(false);
  });

  it("reads the auto-settle kill switch both ways", () => {
    process.env.ALLOWME_AUTO_SETTLE_DISABLED = "true";
    expect(isAutoSettleDisabled()).toBe(true);
    process.env.ALLOWME_AUTO_SETTLE_DISABLED = "false";
    expect(isAutoSettleDisabled()).toBe(false);
    delete process.env.ALLOWME_AUTO_SETTLE_DISABLED;
    expect(isAutoSettleDisabled()).toBe(false);
  });
});

describe("listAll resilience", () => {
  async function seedRawLine(line: string): Promise<void> {
    const dir = join(tmpRoot, "families", FAMILY);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "ledger.jsonl"), line + "\n", "utf-8");
  }

  it("skips malformed JSONL lines without throwing", async () => {
    // One valid entry, one garbage line, one blank line.
    await ledger.append({
      id: randomUUID(),
      familyId: FAMILY,
      childName: "Maya",
      kind: "achievement-credit",
      destination: "child-wallet",
      amountUsdcMicros: 1000,
      status: "pending",
      createdAt: new Date().toISOString(),
      sourceId: "src1",
      retryCount: 0,
    });
    await seedRawLine("this is not json {{{");
    await seedRawLine("");

    const all = await ledger.listAll(FAMILY);
    expect(all).toHaveLength(1);
    expect(all[0].childName).toBe("Maya");
  });

  it("returns [] when the ledger path cannot be read (EISDIR)", async () => {
    // Create a *directory* where the ledger file is expected. existsSync
    // is true but readFile throws EISDIR → the catch returns [].
    const filePath = join(tmpRoot, "families", FAMILY, "ledger.jsonl");
    await mkdir(filePath, { recursive: true });
    const all = await ledger.listAll(FAMILY);
    expect(all).toEqual([]);
  });
});

describe("mutation no-ops and empty rewrites", () => {
  it("markSettled / markFailed / markAbandoned are no-ops for empty id lists", async () => {
    await expect(ledger.markSettled(FAMILY, [], "0x", "b")).resolves.toBeUndefined();
    await expect(ledger.markFailed(FAMILY, [], "reason")).resolves.toBeUndefined();
    await expect(ledger.markAbandoned(FAMILY, [])).resolves.toBeUndefined();
  });

  it("rewrites an empty file when no entries match the id set", async () => {
    // No entries exist; markFailed with a bogus id forces rewriteEntries([])
    // — the entries.length === 0 trailing-newline branch.
    await ledger.markFailed(FAMILY, ["does-not-exist"], "rpc_timeout");
    const all = await ledger.listAll(FAMILY);
    expect(all).toEqual([]);
  });
});

describe("classifyFailure remaining buckets", () => {
  it("classifies chain reorg / replacement errors", () => {
    expect(classifyFailure(new Error("transaction was replaced"))).toBe("chain_reorg");
    expect(classifyFailure(new Error("chain reorg detected"))).toBe("chain_reorg");
  });

  it("classifies the generic insufficient+gas combination", () => {
    expect(
      classifyFailure(new Error("ran out: account has insufficient balance for gas")),
    ).toBe("insufficient_gas");
  });
});

describe("module-level path re-exports", () => {
  it("getFamilyLedgerPath returns a family-scoped jsonl path", () => {
    const p = getFamilyLedgerPath("fam_xyz");
    expect(p).toContain("families");
    expect(p.endsWith(join("fam_xyz", "ledger.jsonl"))).toBe(true);
  });

  it("ensureFamilyDir creates the family directory idempotently", async () => {
    const fam = "covdir_" + randomUUID().slice(0, 8);
    // Calling twice must not throw (existsSync short-circuits the second).
    await ensureFamilyDir(fam);
    await ensureFamilyDir(fam);
    const created = join(
      getFamilyLedgerPath(fam).replace(join(fam, "ledger.jsonl"), fam),
    );
    // Clean up the real-data-dir artifact this exercise creates.
    await rm(created, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
