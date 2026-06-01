/**
 * Sprint 4.0.3 W1 — LedgerEntry engine module.
 *
 * The ledger is the unit of "money owed but not yet on-chain". It
 * decouples earning recognition (verify-achievement → ledger write) from
 * on-chain settlement (settle-balance → on-chain transfer). See
 * sprint-4.0.3/research.md §3 and plan.md §4 W1.
 *
 * Persistence: one JSONL file per family at
 * `data/families/<id>/ledger.jsonl`. Append-only on `append`; rewrite
 * on `markSettled` / `markFailed` / `markAbandoned`. JSONL chosen to
 * match Sprint 4.0.2's audit-log format and to make the Sprint 4.4
 * Postgres migration a straight COPY.
 *
 * The savings split is applied at earn time (research §3.1 / plan D2).
 * The split percentage stored in the entry is the value at write time
 * and is never recomputed at settlement — a parent who edits
 * savingsPercent next week does not retroactively reshape last week's
 * pending entries.
 */

import { readFile, writeFile, mkdir, appendFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "../constants.js";
import {
  LedgerEntrySchema,
  type LedgerEntry,
  type LedgerEntryInput,
  type LedgerEntryDestination,
  type AchievementRecord,
} from "../schemas.js";

// === Feature-flag plumbing (W0) ===
//
// `ALLOWME_LEDGER_MODE` controls Phase A/B/C semantics across the
// codebase. Default `dual-write` is safe for any deploy that hasn't
// run the Phase A migration yet — verify-achievement keeps its
// pre-4.0.3 behavior unchanged and the new ledger entries are written
// alongside.

export type LedgerMode = "off" | "dual-write" | "settle-enabled" | "ledger-only";

const VALID_MODES: ReadonlySet<LedgerMode> = new Set([
  "off",
  "dual-write",
  "settle-enabled",
  "ledger-only",
]);

/**
 * Read `ALLOWME_LEDGER_MODE` from env at call time. Reading per-call
 * (not at module load) means tests can `process.env.ALLOWME_LEDGER_MODE =
 * "ledger-only"` between cases without restarting the process.
 */
export function getLedgerMode(): LedgerMode {
  const raw = process.env.ALLOWME_LEDGER_MODE;
  if (raw && VALID_MODES.has(raw as LedgerMode)) {
    return raw as LedgerMode;
  }
  return "dual-write";
}

/**
 * True when the ledger is in any mode that writes entries on
 * verify-achievement. Phase A (`dual-write`), Phase B (`settle-enabled`),
 * and Phase C (`ledger-only`) all write; only the `off` kill switch
 * skips.
 */
export function isLedgerWriteEnabled(): boolean {
  return getLedgerMode() !== "off";
}

/**
 * True when on-chain settlement is decoupled — distribute-allowance,
 * release-savings, settle-session-payout become ledger-only (W3-W5).
 * False during Phase A/B when legacy code paths still broadcast.
 */
export function isLedgerOnlyMode(): boolean {
  return getLedgerMode() === "ledger-only";
}

/**
 * `ALLOWME_AUTO_SETTLE_DISABLED=true` is the W7 emergency kill switch
 * for the Sunday auto-settle job, no deploy required.
 */
export function isAutoSettleDisabled(): boolean {
  return process.env.ALLOWME_AUTO_SETTLE_DISABLED === "true";
}

// === Path resolution (mirrors state.ts conventions) ===

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..", "..");
const dataDir = join(projectRoot, DATA_DIR);

function getFamilyLedgerPath(familyId: string): string {
  return join(dataDir, "families", familyId, "ledger.jsonl");
}

async function ensureFamilyDir(familyId: string): Promise<void> {
  const dir = join(dataDir, "families", familyId);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
}

// === Split helpers (W1) ===

/**
 * Split a USDC-micros total into (childMicros, savingsMicros) per the
 * configured savingsPercent. Floor rounding on savings; the child gets
 * the remainder so totals are exact (LS2).
 *
 *   splitAchievement(1_000_001, 20)
 *     → { childMicros: 800_001, savingsMicros: 200_000 }
 *
 * 0% → all to child. 100% → all to savings. Negative input throws.
 */
export function splitAchievement(
  totalMicros: number,
  savingsPercent: number,
): { childMicros: number; savingsMicros: number } {
  if (totalMicros < 0) {
    throw new Error(`splitAchievement: totalMicros must be non-negative (got ${totalMicros})`);
  }
  if (savingsPercent < 0 || savingsPercent > 100) {
    throw new Error(`splitAchievement: savingsPercent must be in [0, 100] (got ${savingsPercent})`);
  }
  const savingsMicros = Math.floor(totalMicros * (savingsPercent / 100));
  const childMicros = totalMicros - savingsMicros;
  return { childMicros, savingsMicros };
}

/**
 * Build the LedgerEntry tuple for an Achievement. Returns 1 entry if
 * one side rounds to 0 (e.g. 0% or 100% savings, or a 1-micro
 * achievement at 20%); 2 entries otherwise.
 *
 * The `sourceId` is the Achievement's id — used by `findBySourceId` for
 * idempotent dual-write retries and the W9 migration.
 *
 * `familyIdHint` is required because Achievement records don't carry
 * familyId today (they live in a family-scoped file). Callers pass
 * `caller.familyId`.
 */
export function buildLedgerEntriesForAchievement(
  achievement: AchievementRecord,
  savingsPercent: number,
  familyIdHint: string,
): LedgerEntry[] {
  const { childMicros, savingsMicros } = splitAchievement(
    achievement.amount,
    savingsPercent,
  );
  const now = new Date().toISOString();
  const entries: LedgerEntry[] = [];
  if (childMicros > 0) {
    entries.push({
      id: randomUUID(),
      familyId: familyIdHint,
      childName: achievement.childName,
      kind: "achievement-credit",
      destination: "child-wallet",
      amountUsdcMicros: childMicros,
      status: "pending",
      createdAt: now,
      sourceId: achievement.id,
      retryCount: 0,
    });
  }
  if (savingsMicros > 0) {
    entries.push({
      id: randomUUID(),
      familyId: familyIdHint,
      childName: achievement.childName,
      kind: "savings-deposit",
      destination: "savings-vault",
      amountUsdcMicros: savingsMicros,
      status: "pending",
      createdAt: now,
      sourceId: achievement.id,
      retryCount: 0,
    });
  }
  return entries;
}

// === LedgerStore interface ===

export interface LedgerStore {
  append(entry: LedgerEntryInput): Promise<LedgerEntry>;
  listAll(familyId: string, childName?: string): Promise<LedgerEntry[]>;
  listPending(familyId: string, childName?: string): Promise<LedgerEntry[]>;
  listFailed(familyId: string, childName?: string): Promise<LedgerEntry[]>;
  listSettled(familyId: string, childName?: string): Promise<LedgerEntry[]>;
  listAbandoned(familyId: string, childName?: string): Promise<LedgerEntry[]>;
  /**
   * Returns entries with status in (pending, failed). Settle-balance
   * picks both up — failed entries retry alongside fresh pending ones
   * (W8). Abandoned entries are NOT returned here.
   */
  listPendingOrFailed(familyId: string, childName?: string): Promise<LedgerEntry[]>;
  markSettled(familyId: string, ids: string[], txHash: string, batchId: string): Promise<void>;
  markFailed(familyId: string, ids: string[], reason: string): Promise<void>;
  markAbandoned(familyId: string, ids: string[]): Promise<void>;
  findBySourceId(familyId: string, sourceId: string): Promise<LedgerEntry[]>;
  summarizePending(
    familyId: string,
    childName?: string,
  ): Promise<{ totalMicros: number; byKind: Record<string, number>; byDestination: Record<LedgerEntryDestination, number> }>;
}

// === FilesystemLedger ===

export class FilesystemLedger implements LedgerStore {
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? dataDir;
  }

  private familyLedgerPath(familyId: string): string {
    return join(this.rootDir, "families", familyId, "ledger.jsonl");
  }

  private async ensureFamilyDirLocal(familyId: string): Promise<void> {
    const dir = join(this.rootDir, "families", familyId);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Append a single entry. Defaults are applied via Zod parse so callers
   * can omit `retryCount` and pre-default fields and still get a
   * fully-formed entry written.
   */
  async append(entry: LedgerEntryInput): Promise<LedgerEntry> {
    const parsed = LedgerEntrySchema.parse(entry);
    await this.ensureFamilyDirLocal(parsed.familyId);
    const path = this.familyLedgerPath(parsed.familyId);
    const line = JSON.stringify(parsed) + "\n";
    await appendFile(path, line, "utf-8");
    return parsed;
  }

  async listAll(familyId: string, childName?: string): Promise<LedgerEntry[]> {
    const path = this.familyLedgerPath(familyId);
    if (!existsSync(path)) return [];
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch {
      return [];
    }
    const out: LedgerEntry[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = LedgerEntrySchema.parse(JSON.parse(line));
        if (childName && parsed.childName.toLowerCase() !== childName.toLowerCase()) {
          continue;
        }
        out.push(parsed);
      } catch {
        // Skip malformed lines. The bench / production reader should
        // never see them; preserving forward progress is preferable to
        // throwing on a corrupted file.
      }
    }
    return out;
  }

  private async filterByStatus(
    familyId: string,
    statuses: ReadonlySet<LedgerEntry["status"]>,
    childName?: string,
  ): Promise<LedgerEntry[]> {
    const all = await this.listAll(familyId, childName);
    return all.filter((e) => statuses.has(e.status));
  }

  async listPending(familyId: string, childName?: string): Promise<LedgerEntry[]> {
    return this.filterByStatus(familyId, new Set(["pending"]), childName);
  }

  async listFailed(familyId: string, childName?: string): Promise<LedgerEntry[]> {
    return this.filterByStatus(familyId, new Set(["failed"]), childName);
  }

  async listSettled(familyId: string, childName?: string): Promise<LedgerEntry[]> {
    return this.filterByStatus(familyId, new Set(["settled"]), childName);
  }

  async listAbandoned(familyId: string, childName?: string): Promise<LedgerEntry[]> {
    return this.filterByStatus(familyId, new Set(["abandoned"]), childName);
  }

  async listPendingOrFailed(familyId: string, childName?: string): Promise<LedgerEntry[]> {
    return this.filterByStatus(familyId, new Set(["pending", "failed"]), childName);
  }

  async findBySourceId(familyId: string, sourceId: string): Promise<LedgerEntry[]> {
    const all = await this.listAll(familyId);
    return all.filter((e) => e.sourceId === sourceId);
  }

  /**
   * Mutate-and-rewrite the family ledger. JSONL is append-only on
   * happy paths; state transitions (settled / failed / abandoned)
   * require a full-file rewrite. At per-family scale (~2.6k entries by
   * year-end, plan D1) this is acceptable until Sprint 4.4 moves the
   * ledger to Postgres.
   */
  private async rewriteEntries(familyId: string, entries: LedgerEntry[]): Promise<void> {
    await this.ensureFamilyDirLocal(familyId);
    const path = this.familyLedgerPath(familyId);
    const body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
    const tmpPath = path + `.tmp.${randomUUID().slice(0, 8)}`;
    await writeFile(tmpPath, body, "utf-8");
    await rename(tmpPath, path);
  }

  async markSettled(
    familyId: string,
    ids: string[],
    txHash: string,
    batchId: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const all = await this.listAll(familyId);
    const now = new Date().toISOString();
    for (const e of all) {
      if (idSet.has(e.id)) {
        e.status = "settled";
        e.settledAt = now;
        e.txHash = txHash;
        e.settlementBatchId = batchId;
      }
    }
    await this.rewriteEntries(familyId, all);
  }

  async markFailed(familyId: string, ids: string[], reason: string): Promise<void> {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const all = await this.listAll(familyId);
    for (const e of all) {
      if (idSet.has(e.id)) {
        e.status = "failed";
        e.failureReason = reason;
        // retryCount is schema-guaranteed (default 0), so no nullish guard.
        e.retryCount = e.retryCount + 1;
      }
    }
    await this.rewriteEntries(familyId, all);
  }

  async markAbandoned(familyId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const all = await this.listAll(familyId);
    for (const e of all) {
      if (idSet.has(e.id)) {
        e.status = "abandoned";
      }
    }
    await this.rewriteEntries(familyId, all);
  }

  async summarizePending(
    familyId: string,
    childName?: string,
  ): Promise<{
    totalMicros: number;
    byKind: Record<string, number>;
    byDestination: Record<LedgerEntryDestination, number>;
  }> {
    const pending = await this.listPending(familyId, childName);
    const byKind: Record<string, number> = {};
    const byDestination: Record<LedgerEntryDestination, number> = {
      "child-wallet": 0,
      "savings-vault": 0,
    };
    let totalMicros = 0;
    for (const e of pending) {
      totalMicros += e.amountUsdcMicros;
      byKind[e.kind] = (byKind[e.kind] ?? 0) + e.amountUsdcMicros;
      byDestination[e.destination] += e.amountUsdcMicros;
    }
    return { totalMicros, byKind, byDestination };
  }
}

// === Failure classifier (W8) ===
//
// Maps caught errors from `WalletDistributor.transferUSDC` to a stable
// failure-reason string. Stable strings allow the retry counter to
// detect "same failure category" across attempts (LS43, LS47-LS50).

/**
 * Classify a thrown error into a stable failure-reason. Order matters:
 * the OWS `POLICY_DENIED` check runs first because gas/timeout strings
 * occasionally appear in policy-denied stack traces.
 */
export function classifyFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // OWS policy engine rejection (Sprint 4.0.1 surface). The OWS error
  // text contains `POLICY_DENIED` or `policy_denied` plus a reason
  // tag. We surface the reason for the audit trail.
  if (lower.includes("policy_denied") || lower.includes("policy denied")) {
    if (lower.includes("recipient") || lower.includes("authoriz") || lower.includes("allowlist")) {
      return "policy_denied: recipient_not_authorized";
    }
    return "policy_denied";
  }

  // Gas-related: viem surfaces this as "insufficient funds for gas" or
  // "execution reverted: insufficient" — match generously.
  if (
    lower.includes("insufficient funds for gas") ||
    lower.includes("insufficient gas") ||
    (lower.includes("insufficient") && lower.includes("gas"))
  ) {
    return "insufficient_gas";
  }

  // Timeout class — viem / node fetch / our own waitForTransactionReceipt.
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("etimedout")
  ) {
    return "rpc_timeout";
  }

  // Chain reorg or replacement (rare but worth a stable bucket).
  if (lower.includes("reorg") || lower.includes("replaced")) {
    return "chain_reorg";
  }

  // Unknown — preserve the raw message so operators can investigate.
  // Truncated to keep audit-log lines bounded.
  return message.length > 200 ? message.slice(0, 200) + "…" : message;
}

// === Convenience re-export for path inspection in tests ===

export { getFamilyLedgerPath, ensureFamilyDir };
