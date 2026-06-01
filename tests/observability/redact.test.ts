/**
 * Sprint 4.0.2 — Tier-1 redactor tests (contract C8, C9, C11).
 *
 * Test taxonomy:
 *   - OB23, OB24, OB26, OB27, OB28 — Tier-1 patterns never survive
 *     `redactSensitive` across the three required input shapes (flat
 *     string / nested object / env-style string).
 *   - OB29 — Tier-2 content (child names, family names, wallet
 *     addresses, tx amounts) passes through unchanged. Privacy-policy
 *     verification per `docs/PRIVACY.md`.
 *   - Coverage rows — every branch of `redactString`, `walk`,
 *     `redactTokens`, and `redactSensitive` is exercised so OB-COV-1
 *     (100% branches / functions / lines on `src/observability/redact.ts`)
 *     stays green.
 *
 * C11 makes this file the load-bearing coverage gate for the sprint.
 * If you remove an assertion that touched a branch, coverage drops
 * below 100% and CI fails — by design.
 */

import { describe, expect, it } from "vitest";
import {
  OWS_TOKEN_REGEX,
  redactObject,
  redactSensitive,
  redactString,
  redactTokens,
} from "../../src/observability/redact.js";

// Tier-1 fixtures. Each value is a real-shaped token; the regexes in
// redact.ts must match without any escape gymnastics.
const FIX = {
  owsKey: "ows_key_a1b2c3d4e5f6789012345678901234567890abcdef0123456789abcdef012345",
  setupCode: "SETUP-ABCD-1234",
  privateKey: "0x" + "ab".repeat(32), // 64 hex chars
  passphraseEq: "OWS_PASSPHRASE=my-secret-passphrase",
  passphraseColon: "OWS_PASSPHRASE: hunter2",
};

// Tier-1 regex bank used for the "never survives" assertions. Each
// pattern is the OUTPUT regex (matching the raw secret form) — if a
// match remains in the output, the redactor failed.
const TIER1_OUTPUT_REGEXES: RegExp[] = [
  /ows_key_[a-zA-Z0-9_-]{8,}/,
  /SETUP-[A-Z0-9]{4}-[A-Z0-9]{4}/,
  /0x[a-fA-F0-9]{64}/,
  // OWS_PASSPHRASE survival check — match the env-style assignment ONLY
  // when the value is NOT our redaction marker. The negative lookahead
  // `(?!\[REDACTED\])` prevents the helper from flagging its own
  // redaction sentinel as a leak.
  /OWS_PASSPHRASE\s*[=:]\s*(?!\[REDACTED\])\S/i,
];

function expectNoTier1Survives(out: string): void {
  for (const re of TIER1_OUTPUT_REGEXES) {
    expect(out).not.toMatch(re);
  }
}

describe("redactString — Tier-1 patterns (OB23, OB24, OB26, OB28)", () => {
  it("OB23: ows_key_ token is replaced with [REDACTED_OWS_KEY]", () => {
    const input = `Auth failed with token ${FIX.owsKey}`;
    const out = redactString(input);
    expect(out).toBe("Auth failed with token [REDACTED_OWS_KEY]");
    expectNoTier1Survives(out);
  });

  it("OB24: SETUP-XXXX-XXXX is replaced with [REDACTED_SETUP_CODE]", () => {
    const input = `Validation failed for code ${FIX.setupCode}`;
    const out = redactString(input);
    expect(out).toContain("[REDACTED_SETUP_CODE]");
    expect(out).not.toContain(FIX.setupCode);
    expectNoTier1Survives(out);
  });

  it("OB26 (snapshot): ows_key_ token redaction is exact", () => {
    const input = "Token: ows_key_a1b2c3d4e5f6g7h8i9j0k1l2";
    expect(redactString(input)).toBe("Token: [REDACTED_OWS_KEY]");
  });

  it("OB28: OWS_PASSPHRASE=value is replaced with OWS_PASSPHRASE=[REDACTED]", () => {
    const input = `Failed to start: ${FIX.passphraseEq} invalid`;
    const out = redactString(input);
    expect(out).toContain("OWS_PASSPHRASE=[REDACTED]");
    expect(out).not.toContain("my-secret-passphrase");
    expectNoTier1Survives(out);
  });

  it("OB28b: OWS_PASSPHRASE: value (colon syntax) also redacted", () => {
    const input = `Config: ${FIX.passphraseColon}`;
    const out = redactString(input);
    expect(out).toContain("OWS_PASSPHRASE=[REDACTED]");
    expect(out).not.toContain("hunter2");
    expectNoTier1Survives(out);
  });

  it("Tier-1: private-key hex (0x + 64 hex) is replaced", () => {
    const input = `Recovered key: ${FIX.privateKey} oops`;
    const out = redactString(input);
    expect(out).toContain("[REDACTED_PRIVATE_KEY]");
    expect(out).not.toContain(FIX.privateKey);
    expectNoTier1Survives(out);
  });

  it("multi-pattern: all four Tier-1 patterns in one string are all redacted", () => {
    const input = [
      `key=${FIX.owsKey}`,
      `code=${FIX.setupCode}`,
      `pk=${FIX.privateKey}`,
      FIX.passphraseEq,
    ].join(" ");
    const out = redactString(input);
    expectNoTier1Survives(out);
    expect(out).toContain("[REDACTED_OWS_KEY]");
    expect(out).toContain("[REDACTED_SETUP_CODE]");
    expect(out).toContain("[REDACTED_PRIVATE_KEY]");
    expect(out).toContain("OWS_PASSPHRASE=[REDACTED]");
  });

  it("no-match: a Tier-2-only string is returned unchanged (Tier-2 preservation branch)", () => {
    const input = "Verified achievement for Maya: reading 30min";
    expect(redactString(input)).toBe(input);
  });
});

describe("redactObject / redactSensitive — nested-object Tier-1 redaction (OB27)", () => {
  it("OB27: nested object with token at depth >= 2 is redacted (snapshot)", () => {
    const input = {
      user: { id: 1, token: FIX.owsKey },
      error: { detail: `Bad token: ${FIX.owsKey}` },
    };
    const out = redactObject(input);
    expect(out).toEqual({
      user: { id: 1, token: "[REDACTED_OWS_KEY]" },
      error: { detail: "Bad token: [REDACTED_OWS_KEY]" },
    });
    expectNoTier1Survives(JSON.stringify(out));
  });

  it("OB27b: array containing Tier-1 strings is redacted element-by-element", () => {
    const input = [`one ${FIX.owsKey}`, `two ${FIX.setupCode}`, "three"];
    const out = redactObject(input);
    expect(out).toEqual([
      "one [REDACTED_OWS_KEY]",
      "two [REDACTED_SETUP_CODE]",
      "three",
    ]);
  });

  it("redactSensitive is an alias for redactObject (contract-name surface)", () => {
    const input = { exception: { message: `boom ${FIX.owsKey}` } };
    expect(redactSensitive(input)).toEqual(redactObject(input));
  });

  it("non-string primitives pass through walk() unchanged", () => {
    // Covers the final return-as-is branch in walk(): number, boolean,
    // null, undefined are all neither string nor array nor non-null object.
    const input = {
      n: 42,
      b: true,
      z: null,
      u: undefined,
      f: 3.14,
    };
    const out = redactObject(input) as typeof input;
    expect(out.n).toBe(42);
    expect(out.b).toBe(true);
    expect(out.z).toBeNull();
    expect(out.u).toBeUndefined();
    expect(out.f).toBe(3.14);
  });

  it("Sentry-shaped event payload is recursively redacted (C7 prep)", () => {
    // Mirrors the shape Sentry's `beforeSend` will see — a sanitized
    // version of what a thrown Error containing a token would emit.
    const event = {
      message: `Auth failed with token ${FIX.owsKey}`,
      exception: {
        values: [
          {
            type: "Error",
            value: `Bad token: ${FIX.owsKey}`,
            stacktrace: {
              frames: [{ filename: "x.ts", lineno: 1, vars: { tok: FIX.owsKey } }],
            },
          },
        ],
      },
      breadcrumbs: [
        { message: `request body: ${FIX.passphraseEq}`, category: "http" },
      ],
      extra: { user_token: FIX.owsKey, setup_code: FIX.setupCode },
    };
    const out = redactSensitive(event);
    expectNoTier1Survives(JSON.stringify(out));
  });
});

describe("Tier-2 deliberately preserved (OB29 + C9)", () => {
  it("OB29: child names are NOT redacted (documented privacy policy)", () => {
    const input = "Verified achievement for Maya: reading 30min";
    expect(redactString(input)).toBe(input);
  });

  it("Tier-2: wallet addresses (0x + 40 hex) survive byte-for-byte", () => {
    // 40-hex (Ethereum address) is shorter than 64-hex (private key),
    // so the private-key pattern must NOT match this. Intentional —
    // wallet addresses are public and not Tier-1.
    const input = "Transfer to 0x" + "ab".repeat(20) + " confirmed";
    expect(redactString(input)).toBe(input);
  });

  it("Tier-2: family name + amount survive byte-for-byte", () => {
    const input = "Family Doe distributed $5.00 to Maya";
    expect(redactString(input)).toBe(input);
  });

  it("Tier-2 nested object: child name in a deeply-nested field survives", () => {
    const input = {
      family: { id: "fam_abc", name: "Doe" },
      children: [{ name: "Maya", amount: 500 }],
    };
    expect(redactObject(input)).toEqual(input);
  });
});

describe("redactTokens — legacy audit-walk surface (AM45 regression)", () => {
  it("OWS_TOKEN_REGEX matches the canonical 64-hex form", () => {
    expect(OWS_TOKEN_REGEX.test(FIX.owsKey)).toBe(true);
  });

  it("string with token is replaced with ows_key_*** (back-compat shape)", () => {
    const out = redactTokens(`token=${FIX.owsKey} go`) as string;
    expect(out).toBe("token=ows_key_*** go");
    expect(out).not.toMatch(OWS_TOKEN_REGEX);
  });

  it("array containing token strings is walked", () => {
    const out = redactTokens([`a ${FIX.owsKey}`, "b", { x: FIX.owsKey }]);
    expect(JSON.stringify(out)).not.toMatch(OWS_TOKEN_REGEX);
    expect(JSON.stringify(out)).toContain("ows_key_***");
  });

  it("object containing token in a leaf is redacted", () => {
    const out = redactTokens({
      action: "wallet-created",
      details: { token: FIX.owsKey, nested: { extra: FIX.owsKey } },
    });
    expect(JSON.stringify(out)).not.toMatch(OWS_TOKEN_REGEX);
  });

  it("non-string primitives pass through unchanged", () => {
    expect(redactTokens(42)).toBe(42);
    expect(redactTokens(true)).toBe(true);
    expect(redactTokens(null)).toBeNull();
    expect(redactTokens(undefined)).toBeUndefined();
  });

  it("redactTokens does NOT remove other Tier-1 patterns (deliberate scope)", () => {
    // The audit-walk redactor is single-pattern by design (Sprint 4.0.1
    // W9). `redactSensitive` is the Tier-1 entry point.
    const out = redactTokens(`code=${FIX.setupCode}`) as string;
    expect(out).toContain(FIX.setupCode); // unchanged — only ows_key handled
  });
});
