/**
 * Sprint 4.1 W7 — helper for reading and asserting on the OWS-side audit
 * log at `~/.ows/families/<id>/.ows/logs/audit.jsonl`. Used by the
 * policy-engagement integration test (AM27, AM28) on Base Sepolia, and
 * available to Sprint 4.2's audit-forwarding tests.
 *
 * The OWS audit log is JSONL — one JSON object per line. Each line has
 * at minimum `{operation, api_key_id?, timestamp}`; policy entries also
 * carry `{result: "allow"|"deny", reason?}`. Broadcast entries also
 * carry `{tx_hash}`. The exact schema is OWS's responsibility; we treat
 * lines as opaque records and key on the `operation` field.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface OwsAuditEntry {
  operation: string;
  api_key_id?: string;
  result?: "allow" | "deny";
  reason?: string;
  tx_hash?: string;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Read the OWS audit log for a family vault. Returns an empty array if
 * the log file doesn't exist yet (e.g., the family was just bootstrapped
 * and no signing has occurred).
 */
export async function readOwsAuditLog(
  vaultPath: string
): Promise<OwsAuditEntry[]> {
  const logPath = join(vaultPath, "logs", "audit.jsonl");
  if (!existsSync(logPath)) return [];
  const raw = await readFile(logPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line) => JSON.parse(line) as OwsAuditEntry);
}

/**
 * Predicate helpers used by AM27 / AM28 assertions and Sprint 4.2's
 * forwarding tests.
 */
export function findPolicyEvaluatedEntries(
  log: OwsAuditEntry[]
): OwsAuditEntry[] {
  return log.filter((e) => e.operation === "policy_evaluated");
}

export function findBroadcastTransactionEntries(
  log: OwsAuditEntry[]
): OwsAuditEntry[] {
  return log.filter((e) => e.operation === "broadcast_transaction");
}

/**
 * Assert that a `policy_evaluated` entry exists with `result: "allow"`
 * and PRECEDES the first `broadcast_transaction` entry (Spec 03 §Agent
 * signing flow steps 7→8→…). Returns the matched pair.
 *
 * Throws (test-side AssertionError suitable) if the ordering invariant
 * is violated.
 */
export function assertPolicyPrecedesBroadcast(
  log: OwsAuditEntry[]
): { policy: OwsAuditEntry; broadcast: OwsAuditEntry } {
  const policy = log.find(
    (e) => e.operation === "policy_evaluated" && e.result === "allow"
  );
  if (!policy) {
    throw new Error(
      "OWS audit log has no `policy_evaluated` entry with result=allow"
    );
  }
  const broadcast = log.find((e) => e.operation === "broadcast_transaction");
  if (!broadcast) {
    throw new Error("OWS audit log has no `broadcast_transaction` entry");
  }
  if (log.indexOf(policy) > log.indexOf(broadcast)) {
    throw new Error(
      "OWS audit log invariant violated: broadcast_transaction precedes " +
        "policy_evaluated. Policy engine was not engaged before signing."
    );
  }
  return { policy, broadcast };
}
