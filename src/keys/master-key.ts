import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "../constants.js";

// Resolve data directory from this file's location (src/keys/master-key.ts → ../../data)
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..", "..");
const dataDir = join(projectRoot, DATA_DIR);
const MASTER_KEY_FILE = join(dataDir, ".master-key");

let cachedKey: Buffer | null = null;

/**
 * Resolves the master encryption key from three sources in priority order:
 * 1. MASTER_KEY env var (hex string, ≥ 32 bytes)
 * 2. data/.master-key file (persisted from previous run)
 * 3. Auto-generate random 32 bytes, write to data/.master-key
 *
 * Always succeeds unless data/ is not writable and no env var is set.
 * Cached in memory after first resolution (singleton).
 */
export function resolveMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  // Priority 1: MASTER_KEY env var (production / Railway)
  if (process.env.MASTER_KEY) {
    const key = Buffer.from(process.env.MASTER_KEY, "hex");
    if (key.length < 32) {
      throw new Error(
        "MASTER_KEY must be at least 256 bits (64 hex chars). Got " +
          key.length * 8 +
          " bits."
      );
    }
    console.error("[keys] Master key loaded from MASTER_KEY env var");
    cachedKey = key;
    return key;
  }

  // Priority 2: data/.master-key file (persisted from previous run)
  if (existsSync(MASTER_KEY_FILE)) {
    const key = readFileSync(MASTER_KEY_FILE);
    if (key.length >= 32) {
      console.error("[keys] Master key loaded from data/.master-key");
      cachedKey = key;
      return key;
    }
    // File exists but is too short — regenerate
    console.error("[keys] Existing data/.master-key is too short, regenerating");
  }

  // Priority 3: auto-generate (first run)
  try {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    const key = randomBytes(32);
    writeFileSync(MASTER_KEY_FILE, key, { mode: 0o600 });
    console.error("[keys] Master key auto-generated at data/.master-key");
    console.error(
      "[keys] Note: Set MASTER_KEY env var for ephemeral deployments (Railway, Docker)"
    );
    cachedKey = key;
    return key;
  } catch (err) {
    throw new Error(
      "Cannot auto-generate master key: data/ directory not writable. " +
        "Set MASTER_KEY env var instead. " +
        (err instanceof Error ? err.message : String(err))
    );
  }
}

/**
 * Returns the resolved data directory path.
 * Used by FamilyKeyManager for storing family-keys.json in the same location.
 */
export function getDataDir(): string {
  return dataDir;
}

/**
 * Clear the cached master key (for testing only).
 */
export function _clearMasterKeyCache(): void {
  cachedKey = null;
}
