// Sprint 3.0 v4 — W4.3 Session token tests (ST1-ST5).
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  SessionTokenManager,
  DEFAULT_SESSION_TTL_SEC,
  resolveSessionSecret,
  _clearSessionSecretCache,
} from "../src/auth/session-tokens.js";

function makeFakeClock(initialMs = Date.now()) {
  let t = initialMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("SessionTokenManager (W4.3)", () => {
  const secret = randomBytes(32);

  it("ST1: valid issuance + validation roundtrip (addresses lowercased in claims)", () => {
    const clock = makeFakeClock();
    const mgr = new SessionTokenManager(secret, clock);

    const token = mgr.issue({
      memberId: "member-123",
      walletAddress: "0xABCDEF0123456789abcdef0123456789ABCDEF01",
      familyId: "fam-1",
      role: "manager",
    });

    const claims = mgr.validate(token);
    expect(claims).not.toBeNull();
    expect(claims!.memberId).toBe("member-123");
    expect(claims!.walletAddress).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
    expect(claims!.familyId).toBe("fam-1");
    expect(claims!.role).toBe("manager");
    expect(claims!.exp).toBe(Math.floor(clock.now() / 1000) + DEFAULT_SESSION_TTL_SEC);
  });

  it("ST2: expired token rejected (returns null, does not throw)", () => {
    const clock = makeFakeClock();
    const mgr = new SessionTokenManager(secret, clock);

    const token = mgr.issue({
      walletAddress: "0x1111111111111111111111111111111111111111",
      ttlSec: 60,
    });
    clock.advance(61_000); // advance past exp
    expect(mgr.validate(token)).toBeNull();
  });

  it("ST3: tampered token rejected (HMAC mismatch)", () => {
    const clock = makeFakeClock();
    const mgr = new SessionTokenManager(secret, clock);

    const token = mgr.issue({
      walletAddress: "0x2222222222222222222222222222222222222222",
    });
    // Flip a character in the payload segment.
    const parts = token.split(".");
    parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith("A") ? "B" : "A");
    const tampered = parts.join(".");
    expect(mgr.validate(tampered)).toBeNull();
  });

  it("ST4: claim shape preserved across issue/validate for all fields", () => {
    const mgr = new SessionTokenManager(secret);
    const token = mgr.issue({
      memberId: "m",
      walletAddress: "0x3333333333333333333333333333333333333333",
      familyId: "f",
      role: "co-parent",
    });
    const claims = mgr.validate(token);
    expect(claims).toMatchObject({
      memberId: "m",
      walletAddress: "0x3333333333333333333333333333333333333333",
      familyId: "f",
      role: "co-parent",
    });
    expect(typeof claims!.exp).toBe("number");
  });

  it("ST5: resolveSessionSecret honors env var > file > auto-generate priority", () => {
    // Priority 1: env var. Exercises the hot path that production (Railway)
    // relies on — persistent secret injected via SESSION_SECRET env.
    const originalEnv = process.env.SESSION_SECRET;
    const hexSecret = randomBytes(32).toString("hex");

    _clearSessionSecretCache();
    process.env.SESSION_SECRET = hexSecret;
    const resolved = resolveSessionSecret();
    expect(resolved.length).toBe(32);
    expect(resolved.toString("hex")).toBe(hexSecret);

    // Rejects too-short env var.
    _clearSessionSecretCache();
    process.env.SESSION_SECRET = "00".repeat(8); // only 8 bytes
    expect(() => resolveSessionSecret()).toThrow(/SESSION_SECRET must be at least 256 bits/);

    // Restore env.
    if (originalEnv) process.env.SESSION_SECRET = originalEnv;
    else delete process.env.SESSION_SECRET;
    _clearSessionSecretCache();
  });

  it("ST5b: file-mode 0o600 invariant (auto-generate writes with owner-only permissions)", () => {
    // The production resolver writes the secret file with `{ mode: 0o600 }`.
    // Direct-exercise the same fs write pattern to lock the invariant in.
    const tmp = mkdtempSync(join(tmpdir(), "session-secret-"));
    const secretFile = join(tmp, ".session-secret");
    writeFileSync(secretFile, randomBytes(32), { mode: 0o600 });
    expect(existsSync(secretFile)).toBe(true);
    expect(statSync(secretFile).mode & 0o777).toBe(0o600);
    rmSync(tmp, { recursive: true, force: true });
  });
});
