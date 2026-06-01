import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { resolveMasterKey, getDataDir } from "./master-key.js";
import { createApiKey } from "@open-wallet-standard/core";
import { FamilyKeyManager } from "./family-keys.js";
import { POLICY_IDS, WALLET_NAMES } from "../constants.js";
import { getFamilyVaultPath, StateManager } from "../engine/state.js";

const FAMILY_API_TOKENS_FILE = "family-api-tokens.json";

// OWS API tokens always begin with this literal prefix per Spec 01 §API Key
// Format. Anything that doesn't start with this is treated as a passphrase
// (owner-mode) by the OWS SDK — see Spec 03 §Access Model. Centralised here
// so callers (WalletDistributor constructor guard, redaction regex, etc.)
// share one source of truth.
export const OWS_TOKEN_PREFIX = "ows_key_";

/**
 * Regex that matches a full OWS API token: `ows_key_` + 64 hex chars.
 * Used by redaction (Sprint 4.1 W9) and the CI grep gate.
 */
export const OWS_TOKEN_REGEX = /ows_key_[a-f0-9]{64}/gi;

interface EncryptedFamilyApiToken {
  encryptedToken: string; // hex
  iv: string; // hex
  tag: string; // hex
  apiKeyId: string;       // OWS-assigned UUID for the key file
  createdAt: string;      // ISO datetime
}

type FamilyApiTokensStore = Record<string, EncryptedFamilyApiToken>;

/**
 * Sprint 4.1 — persists per-family OWS API tokens (`ows_key_…`).
 *
 * The token is a bearer credential. Storage envelope is AES-256-GCM under
 * the master key, mirroring `FamilyKeyManager`. File mode is 0o600. The
 * raw token is never returned by any method other than `getToken` and is
 * never logged: `console.error` uses an `ows_key_***` placeholder.
 *
 * One token per family. Repeated `saveToken` calls overwrite in place
 * (no append, no orphan rows). `forgetToken` returns the `apiKeyId` so
 * the caller can hand it to OWS `revokeApiKey` if it wants to.
 */
export class FamilyApiTokenManager {
  private dataDir: string;
  private filePath: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? getDataDir();
    this.filePath = join(this.dataDir, FAMILY_API_TOKENS_FILE);
  }

  /**
   * Persist (or overwrite) the OWS API token for a family.
   *
   * Throws if `token` doesn't start with `ows_key_` — refuses to store
   * anything that isn't an OWS API key, so a caller mistake (passing a
   * passphrase) fails fast at the storage layer rather than at signing
   * time.
   */
  saveToken(familyId: string, token: string, apiKeyId: string): void {
    if (!token.startsWith(OWS_TOKEN_PREFIX)) {
      throw new Error(
        `FamilyApiTokenManager.saveToken: expected an OWS API token ` +
          `(starts with "${OWS_TOKEN_PREFIX}"). Refusing to store anything else.`
      );
    }
    const masterKey = resolveMasterKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(token, "utf-8")),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const store = this.loadStore();
    store[familyId] = {
      encryptedToken: encrypted.toString("hex"),
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      apiKeyId,
      createdAt: new Date().toISOString(),
    };
    this.saveStore(store);

    console.error(
      `[keys] Saved OWS API token for family "${familyId}" (apiKeyId=${apiKeyId}, ` +
        `token=${OWS_TOKEN_PREFIX}***)`
    );
  }

  /**
   * Retrieve and decrypt the OWS API token for a family. Returns `null`
   * (not throw) when:
   *   - no row exists for `familyId`
   *   - the row decrypts incorrectly (e.g. master key has rotated since
   *     the row was written — the documented "master key changed"
   *     recovery path; lazy-mint will regenerate)
   *   - the store file is corrupt (handled in `loadStore`)
   *
   * The null-on-failure shape lets callers fall back to lazy-mint without
   * a try/catch around every read.
   */
  getToken(familyId: string): string | null {
    const store = this.loadStore();
    const entry = store[familyId];
    if (!entry) return null;

    const masterKey = resolveMasterKey();
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        masterKey,
        Buffer.from(entry.iv, "hex")
      );
      decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(entry.encryptedToken, "hex")),
        decipher.final(),
      ]);
      return decrypted.toString("utf-8");
    } catch {
      console.error(
        `[keys] Warning: failed to decrypt OWS API token for family "${familyId}". ` +
          `Master key may have changed. Lazy-mint will regenerate.`
      );
      return null;
    }
  }

  hasToken(familyId: string): boolean {
    const store = this.loadStore();
    return familyId in store;
  }

  /**
   * Remove the token row for a family. Returns the OWS-side `apiKeyId`
   * (so the caller can pipe it into `revokeApiKey`) or `null` if no
   * row existed.
   */
  forgetToken(familyId: string): string | null {
    const store = this.loadStore();
    const entry = store[familyId];
    if (!entry) return null;
    delete store[familyId];
    this.saveStore(store);
    return entry.apiKeyId;
  }

  private loadStore(): FamilyApiTokensStore {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        return JSON.parse(raw) as FamilyApiTokensStore;
      }
    } catch {
      console.error(
        "[keys] Warning: family-api-tokens.json corrupted, treating as empty"
      );
    }
    return {};
  }

  // Sprint 4.1 W5 — concurrency guard for the lazy-mint path. Multiple
  // tool handlers can race to call `lazyMintTokenForLegacyFamily` for the
  // same family (e.g., two `distribute-allowance` requests in flight). We
  // serialize per familyId so only one `createApiKey` runs; the other
  // resolves to the same persisted token. Promises live only in-process,
  // which is sufficient for the single-instance Railway deployment.
  // Multi-instance coordination is out of scope (matches Sprint 3.0.6
  // policy-cache scope).
  private static lazyMintLocks = new Map<string, Promise<string>>();

  // Internal — exposed only to the `lazyMintTokenForLegacyFamily` helper
  // below. Kept as static so the lock map is shared across all
  // FamilyApiTokenManager instances within a process.
  static _getLazyMintLock(familyId: string): Promise<string> | undefined {
    return FamilyApiTokenManager.lazyMintLocks.get(familyId);
  }

  static _setLazyMintLock(familyId: string, p: Promise<string>): void {
    FamilyApiTokenManager.lazyMintLocks.set(familyId, p);
  }

  static _clearLazyMintLock(familyId: string): void {
    FamilyApiTokenManager.lazyMintLocks.delete(familyId);
  }

  private saveStore(store: FamilyApiTokensStore): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    // Atomic write: tmp + rename. Prevents the half-written-file failure
    // mode (R7) that would otherwise force a lazy-mint regeneration on
    // next read.
    const tmpPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmpPath, JSON.stringify(store, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    try {
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      // Best-effort cleanup of the tmp file if rename failed.
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}

/**
 * Sprint 4.1 W5 — Lazy-mint an `ows_key_…` token for a pre-4.1 family
 * that doesn't have one persisted yet.
 *
 * Idempotent: returns the cached token on subsequent calls; scrypt runs
 * at most once per family lifetime (modulo a tiny race window, see the
 * `lazyMintLocks` comment in `FamilyApiTokenManager`).
 *
 * Throws if the family has no encryption key — that signals
 * `configure-policy` was never completed for this family, and we can't
 * conjure a token without the per-family passphrase.
 *
 * Caller responsibility: catch and surface a user-actionable error
 * (e.g., "re-run configure-policy") if this throws. The three callsites
 * in W6 do exactly that.
 */
export async function lazyMintTokenForLegacyFamily(
  familyId: string,
  dataDir?: string
): Promise<string> {
  const apiTokens = new FamilyApiTokenManager(dataDir);
  const cached = apiTokens.getToken(familyId);
  if (cached) return cached;

  // Serialize concurrent mints for the same family. The second concurrent
  // call awaits the first, returns the same token, scrypt fires once.
  const inflight = FamilyApiTokenManager._getLazyMintLock(familyId);
  if (inflight) return inflight;

  const mint = (async () => {
    // Double-check inside the lock — another caller may have written the
    // token to disk between our `getToken` call above and our acquiring
    // the lock. (Two callers can both observe `cached === null` before
    // either of them sets the lock map.)
    const cachedInLock = apiTokens.getToken(familyId);
    if (cachedInLock) return cachedInLock;

    const familyKeys = new FamilyKeyManager(dataDir);
    if (!familyKeys.hasFamilyKey(familyId)) {
      throw new Error(
        `Family "${familyId}" has no encryption key — configure-policy ` +
          `was never completed (or the master key has rotated). ` +
          `Re-run configure-policy to bootstrap the family wallet.`
      );
    }
    const passphrase = familyKeys.getFamilyKey(familyId);

    const walletNames = await listFamilyWalletNames(familyId);

    // Reuse the same policy bundle that `WalletSetup.initializeFamily`
    // attaches to its bootstrap-time manager token (POLICY_IDS
    // .ALLOWANCE_FULL_ACCESS). The policy is registered per-family at
    // bootstrap; this lazy-mint flow is for pre-4.1 families whose
    // policy is already on disk.
    const result = createApiKey(
      "allowance-agent-manager-v2",
      walletNames,
      [POLICY_IDS.ALLOWANCE_FULL_ACCESS],
      passphrase,
      undefined,
      getFamilyVaultPath(familyId)
    );
    apiTokens.saveToken(familyId, result.token, result.id);
    return result.token;
  })();

  FamilyApiTokenManager._setLazyMintLock(familyId, mint);
  try {
    return await mint;
  } finally {
    FamilyApiTokenManager._clearLazyMintLock(familyId);
  }
}

/**
 * Resolve the set of OWS wallet names for a family. Mirrors the bootstrap
 * inventory: treasury, savings-vault, gift-fund, and every OWS-managed
 * child wallet (children without an external `walletAddress`).
 *
 * Children with an external `walletAddress` (BYO wallet) are NOT included
 * — there's no OWS-side wallet for them.
 */
async function listFamilyWalletNames(familyId: string): Promise<string[]> {
  const state = new StateManager();
  const config = await state.loadFamilyConfig(familyId);
  if (!config) {
    throw new Error(
      `Family "${familyId}" config not loaded — cannot enumerate wallets`
    );
  }
  const names: string[] = [
    WALLET_NAMES.TREASURY,
    WALLET_NAMES.SAVINGS_VAULT,
    WALLET_NAMES.GIFT_FUND,
  ];
  for (const child of config.children) {
    if (!child.walletAddress) {
      names.push(WALLET_NAMES.childWallet(child.name));
    }
  }
  return names;
}
