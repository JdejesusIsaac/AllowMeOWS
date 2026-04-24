import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { join } from "node:path";
import { resolveMasterKey } from "../keys/master-key.js";
import { getFamilyDir } from "../engine/state.js";

const TOKEN_FILENAME = "fitbit-tokens.json";
const ALGORITHM = "aes-256-gcm";

export interface FitbitTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO datetime
  scope: string;
  childName: string;
  connectedAt: string;
}

interface EncryptedEntry {
  iv: string;
  tag: string;
  data: string;
  childName: string; // stored in plaintext for lookup
}

function deriveKey(masterKey: Buffer): Buffer {
  return scryptSync(masterKey, "allowance-fitbit-salt", 32);
}

function encrypt(plaintext: string, masterKey: Buffer): { iv: string; tag: string; data: string } {
  const key = deriveKey(masterKey);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("hex"), tag: tag.toString("hex"), data: encrypted };
}

function decrypt(encrypted: { iv: string; tag: string; data: string }, masterKey: Buffer): string {
  const key = deriveKey(masterKey);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, "hex"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));
  let decrypted = decipher.update(encrypted.data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export class FitbitTokenStore {
  private masterKey: Buffer;
  private familyId: string;
  private tokenFile: string;

  constructor(familyId: string, masterKey?: Buffer) {
    this.familyId = familyId;
    this.tokenFile = join(getFamilyDir(familyId), TOKEN_FILENAME);
    this.masterKey = masterKey ?? resolveMasterKey();
  }

  async saveTokens(tokens: FitbitTokens): Promise<void> {
    const entries = await this.loadAllEntries();
    const plaintext = JSON.stringify(tokens);
    const encrypted = encrypt(plaintext, this.masterKey);
    const entry: EncryptedEntry = { ...encrypted, childName: tokens.childName };

    // Replace existing entry for this child, or add new
    const idx = entries.findIndex((e) => e.childName.toLowerCase() === tokens.childName.toLowerCase());
    if (idx >= 0) {
      entries[idx] = entry;
    } else {
      entries.push(entry);
    }

    await mkdir(getFamilyDir(this.familyId), { recursive: true, mode: 0o700 });
    await writeFile(this.tokenFile, JSON.stringify(entries, null, 2));
  }

  async getTokens(childName: string): Promise<FitbitTokens | null> {
    const entries = await this.loadAllEntries();
    const entry = entries.find((e) => e.childName.toLowerCase() === childName.toLowerCase());
    if (!entry) return null;

    try {
      const plaintext = decrypt({ iv: entry.iv, tag: entry.tag, data: entry.data }, this.masterKey);
      return JSON.parse(plaintext) as FitbitTokens;
    } catch {
      return null;
    }
  }

  async hasTokens(childName: string): Promise<boolean> {
    const tokens = await this.getTokens(childName);
    return tokens !== null;
  }

  private async loadAllEntries(): Promise<EncryptedEntry[]> {
    try {
      const raw = await readFile(this.tokenFile, "utf8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
}
