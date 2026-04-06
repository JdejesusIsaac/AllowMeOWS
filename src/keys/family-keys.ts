import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveMasterKey, getDataDir } from "./master-key.js";

const FAMILY_KEYS_FILE = "family-keys.json";

interface EncryptedFamilyKey {
  encryptedKey: string; // hex
  iv: string; // hex
  tag: string; // hex
  createdAt: string; // ISO datetime
}

type FamilyKeysStore = Record<string, EncryptedFamilyKey>;

/**
 * Manages per-family encryption keys.
 *
 * Each family gets a unique 256-bit key, encrypted at rest with the master key
 * (AES-256-GCM). Plaintext keys are never written to disk.
 */
export class FamilyKeyManager {
  private dataDir: string;
  private filePath: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? getDataDir();
    this.filePath = join(this.dataDir, FAMILY_KEYS_FILE);
  }

  /**
   * Generate a new random 256-bit key for a family, encrypt it with the
   * master key, store it in family-keys.json, and return the plaintext key
   * (hex string) for immediate use during wallet setup.
   */
  generateFamilyKey(familyId: string): string {
    const masterKey = resolveMasterKey();
    const familyKey = randomBytes(32);

    // Encrypt the family key with the master key
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(familyKey),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    // Store encrypted entry
    const store = this.loadStore();
    store[familyId] = {
      encryptedKey: encrypted.toString("hex"),
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      createdAt: new Date().toISOString(),
    };
    this.saveStore(store);

    console.error(`[keys] Generated family key for "${familyId}"`);
    return familyKey.toString("hex");
  }

  /**
   * Retrieve and decrypt a family's encryption key.
   * Returns the plaintext key as a hex string.
   * Throws if the family key doesn't exist.
   */
  getFamilyKey(familyId: string): string {
    const store = this.loadStore();
    const entry = store[familyId];

    if (!entry) {
      throw new Error(
        `Family wallet not initialized. No key found for family "${familyId}". Run configure-policy first.`
      );
    }

    const masterKey = resolveMasterKey();

    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        masterKey,
        Buffer.from(entry.iv, "hex")
      );
      decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(entry.encryptedKey, "hex")),
        decipher.final(),
      ]);
      return decrypted.toString("hex");
    } catch (err) {
      throw new Error(
        "Failed to decrypt family key. Master key may have changed. " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  /**
   * Check if a family key exists in storage.
   */
  hasFamilyKey(familyId: string): boolean {
    const store = this.loadStore();
    return familyId in store;
  }

  /**
   * Get or generate a family key.
   * If the family already has a key, return it.
   * Otherwise generate a new one.
   */
  getOrGenerateFamilyKey(familyId: string): string {
    if (this.hasFamilyKey(familyId)) {
      return this.getFamilyKey(familyId);
    }
    return this.generateFamilyKey(familyId);
  }

  private loadStore(): FamilyKeysStore {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        return JSON.parse(raw) as FamilyKeysStore;
      }
    } catch {
      // Corrupted file — start fresh
      console.error("[keys] Warning: family-keys.json corrupted, starting fresh");
    }
    return {};
  }

  private saveStore(store: FamilyKeysStore): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(store, null, 2), { encoding: "utf-8", mode: 0o600 });
  }
}
