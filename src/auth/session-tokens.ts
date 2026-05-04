/**
 * Sprint 3.0 v4 — W1.3 Session tokens.
 *
 * Short-lived HMAC-SHA256 JWTs issued by the verify page after successful
 * SIWE. Used to authenticate subsequent calls to `/api/configure-family`,
 * `/api/redeem-invite`, and `/api/rotate-setup-code` without forcing a
 * second wallet popup mid-flow.
 *
 * Claims: `{ memberId?, walletAddress, familyId?, role?, exp }`. The
 * walletAddress is always lowercase. memberId/familyId/role are populated
 * only when the SIWE-verified wallet is already bound to a Member.
 *
 * Signing key: `data/.session-secret`, auto-generated on first boot with
 * mode 0o600. Mirrors the `data/.master-key` pattern in `src/keys/master-key.ts`.
 *
 * Token format: `base64url(header) + "." + base64url(payload) + "." +
 * base64url(HMAC-SHA256(header + "." + payload, secret))`. Plain custom JWT,
 * no external library — payload shape is tiny and we own both sides.
 *
 * Lifetime: 10 minutes (see `DEFAULT_SESSION_TTL_SEC`).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RoleType } from "../schemas.js";
import { DATA_DIR } from "../constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..", "..");
const dataDir = join(projectRoot, DATA_DIR);
const SESSION_SECRET_FILE = join(dataDir, ".session-secret");

export const DEFAULT_SESSION_TTL_SEC = 10 * 60;

export interface SessionClaims {
  memberId?: string;
  walletAddress: string; // lowercase
  familyId?: string;
  role?: RoleType;
  /** UNIX epoch seconds — token expires when `clock.now()/1000 > exp`. */
  exp: number;
}

export type SessionInput = Omit<SessionClaims, "exp"> & { ttlSec?: number };

interface ClockLike {
  now(): number;
}

const REAL_CLOCK: ClockLike = { now: () => Date.now() };

let cachedSecret: Buffer | null = null;

/** Resolve the session-secret bytes. Env var > file > auto-generate. */
export function resolveSessionSecret(): Buffer {
  if (cachedSecret) return cachedSecret;

  if (process.env.SESSION_SECRET) {
    const key = Buffer.from(process.env.SESSION_SECRET, "hex");
    if (key.length < 32) {
      throw new Error(
        "SESSION_SECRET must be at least 256 bits (64 hex chars). Got " +
          key.length * 8 +
          " bits."
      );
    }
    console.error("[auth] Session secret loaded from SESSION_SECRET env var");
    cachedSecret = key;
    return key;
  }

  if (existsSync(SESSION_SECRET_FILE)) {
    const key = readFileSync(SESSION_SECRET_FILE);
    if (key.length >= 32) {
      console.error("[auth] Session secret loaded from data/.session-secret");
      cachedSecret = key;
      return key;
    }
    console.error("[auth] Existing data/.session-secret is too short, regenerating");
  }

  try {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const key = randomBytes(32);
    writeFileSync(SESSION_SECRET_FILE, key, { mode: 0o600 });
    console.error("[auth] Session secret auto-generated at data/.session-secret");
    console.error(
      "[auth] Note: Set SESSION_SECRET env var for ephemeral deployments (Railway, Docker)"
    );
    cachedSecret = key;
    return key;
  } catch (err) {
    throw new Error(
      "Cannot auto-generate session secret: data/ directory not writable. " +
        "Set SESSION_SECRET env var instead. " +
        (err instanceof Error ? err.message : String(err))
    );
  }
}

/** Test-only: clear the cached session secret. */
export function _clearSessionSecretCache(): void {
  cachedSecret = null;
}

export class SessionTokenManager {
  constructor(
    private readonly secret: Buffer = resolveSessionSecret(),
    private readonly clock: ClockLike = REAL_CLOCK
  ) {}

  /** Issue a signed token for the given claims. Adds `exp` automatically. */
  issue(input: SessionInput): string {
    const ttlSec = input.ttlSec ?? DEFAULT_SESSION_TTL_SEC;
    const nowSec = Math.floor(this.clock.now() / 1000);
    const claims: SessionClaims = {
      memberId: input.memberId,
      walletAddress: input.walletAddress.toLowerCase(),
      familyId: input.familyId,
      role: input.role,
      exp: nowSec + ttlSec,
    };
    const header = { alg: "HS256", typ: "JWT" };
    const headerB64 = b64url(JSON.stringify(header));
    const payloadB64 = b64url(JSON.stringify(claims));
    const signingInput = `${headerB64}.${payloadB64}`;
    const sig = createHmac("sha256", this.secret).update(signingInput).digest();
    return `${signingInput}.${b64urlBuf(sig)}`;
  }

  /** Validate a token. Returns the claims on success, null on any failure. */
  validate(token: string): SessionClaims | null {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;

    const expected = createHmac("sha256", this.secret).update(signingInput).digest();
    let received: Buffer;
    try {
      received = Buffer.from(sigB64, "base64url");
    } catch {
      return null;
    }
    if (received.length !== expected.length) return null;
    if (!timingSafeEqual(received, expected)) return null;

    let claims: SessionClaims;
    try {
      claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (!claims || typeof claims.exp !== "number") return null;
    const nowSec = Math.floor(this.clock.now() / 1000);
    if (nowSec > claims.exp) return null;
    if (typeof claims.walletAddress !== "string") return null;
    return claims;
  }
}

function b64url(str: string): string {
  return b64urlBuf(Buffer.from(str, "utf8"));
}

function b64urlBuf(buf: Buffer): string {
  return buf.toString("base64url");
}

// Module-level singleton for HTTP handlers. Tests construct their own
// instance with a fake clock + injected secret.
export const sessionTokens = new SessionTokenManager();
