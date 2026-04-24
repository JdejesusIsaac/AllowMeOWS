import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { getDataDir } from "../engine/state.js";

const SETUP_CODES_FILENAME = "setup-codes.json";

/**
 * Setup codes are short bearer credentials users embed in their MCP
 * connector URL via `?setup=SETUP-XXXX-XXXX`. They bridge the identity gap
 * until Sprint 3.0 session tokens ship.
 *
 * Format: `SETUP-XXXX-XXXX` where each group is 4 base32-like chars. Avoid
 * 0/O/1/I to cut down on user-transcription errors. ~37 bits of entropy.
 *
 * Storage: `data/setup-codes.json` at the server root. Not family-scoped —
 * the code maps to a memberId, and the memberId maps to a familyId via
 * MemberIndex. Codes are multi-use (not single-use) because the MCP URL
 * embeds the code for every request. Revoked on Member removal or role change.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no 0/O/1/I
const GROUP_LEN = 4;
export const SETUP_CODE_PATTERN = /^SETUP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const DEFAULT_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

export interface SetupCodeEntry {
  memberId: string;
  createdAt: string; // ISO datetime
  expiresAt: string; // ISO datetime
  revokedAt?: string; // ISO datetime (set when manually revoked)
}

export interface ResolvedSetupCode {
  memberId: string;
  expiresAt: string;
}

function generateRawCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 2; g++) {
    const buf = randomBytes(GROUP_LEN);
    let chars = "";
    for (let i = 0; i < GROUP_LEN; i++) {
      chars += ALPHABET[buf[i] % ALPHABET.length];
    }
    groups.push(chars);
  }
  return `SETUP-${groups[0]}-${groups[1]}`;
}

/**
 * Truncate a setup code for logging. Keeps the prefix and last group so
 * operators can correlate without exposing the full secret in logs.
 */
export function redactSetupCode(code: string): string {
  if (!SETUP_CODE_PATTERN.test(code)) return "SETUP-****-****";
  const parts = code.split("-");
  return `${parts[0]}-****-${parts[2]}`;
}

export class SetupCodeStore {
  private filePath: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? getDataDir();
    this.filePath = join(dir, SETUP_CODES_FILENAME);
  }

  /**
   * Issue a fresh setup code for a member. The plaintext code is returned
   * ONCE here and should be shown to the user immediately. The store holds
   * only the code string itself (no hash) — it's a short-lived bearer token.
   */
  async issue(memberId: string, expiryMs: number = DEFAULT_EXPIRY_MS): Promise<string> {
    const store = await this.load();
    // Retry up to 5 times if we randomly collide — cardinality is huge so this
    // is extremely unlikely, but be safe.
    let code: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateRawCode();
      if (!(candidate in store)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new Error("Failed to generate a unique setup code after 5 attempts");
    }

    const now = new Date();
    store[code] = {
      memberId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiryMs).toISOString(),
    };
    await this.save(store);
    return code;
  }

  /**
   * Resolve a code string to its owning member. Returns null if the code is
   * malformed, unknown, expired, or revoked.
   */
  async resolve(code: string): Promise<ResolvedSetupCode | null> {
    if (!SETUP_CODE_PATTERN.test(code)) return null;
    const store = await this.load();
    const entry = store[code];
    if (!entry) return null;
    if (entry.revokedAt) return null;
    const now = Date.now();
    if (new Date(entry.expiresAt).getTime() <= now) return null;
    return { memberId: entry.memberId, expiresAt: entry.expiresAt };
  }

  /**
   * Revoke all active codes for a member (e.g. when a Member is removed or
   * their role changes). Idempotent.
   */
  async revokeForMember(memberId: string): Promise<number> {
    const store = await this.load();
    const now = new Date().toISOString();
    let revoked = 0;
    for (const [code, entry] of Object.entries(store)) {
      if (entry.memberId === memberId && !entry.revokedAt) {
        store[code] = { ...entry, revokedAt: now };
        revoked++;
      }
    }
    if (revoked > 0) await this.save(store);
    return revoked;
  }

  /**
   * Explicitly revoke a single code by its string value.
   */
  async revoke(code: string): Promise<void> {
    const store = await this.load();
    const entry = store[code];
    if (!entry || entry.revokedAt) return;
    store[code] = { ...entry, revokedAt: new Date().toISOString() };
    await this.save(store);
  }

  /**
   * List codes, optionally filtered by memberId. For admin / debug use.
   * Does NOT include the raw code values in the returned entries.
   */
  async list(memberId?: string): Promise<Array<SetupCodeEntry & { code: string }>> {
    const store = await this.load();
    const out: Array<SetupCodeEntry & { code: string }> = [];
    for (const [code, entry] of Object.entries(store)) {
      if (memberId && entry.memberId !== memberId) continue;
      out.push({ code, ...entry });
    }
    return out;
  }

  private async load(): Promise<Record<string, SetupCodeEntry>> {
    if (!existsSync(this.filePath)) return {};
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as Record<string, SetupCodeEntry>;
    } catch (err) {
      console.error(
        `[setup-codes] Warning: failed to read ${this.filePath} — ${
          err instanceof Error ? err.message : String(err)
        }. Returning empty store.`
      );
      return {};
    }
  }

  private async save(store: Record<string, SetupCodeEntry>): Promise<void> {
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tmp = this.filePath + `.tmp.${randomUUID().slice(0, 8)}`;
    await writeFile(tmp, JSON.stringify(store, null, 2), { encoding: "utf-8", mode: 0o600 });
    await rename(tmp, this.filePath);
  }
}
