// Sprint 3.0 v4 — W4.2 NonceStore tests (NO1-NO3).
import { describe, it, expect } from "vitest";
import { NonceStore, DEFAULT_NONCE_TTL_MS } from "../src/auth/nonce-store.js";

function makeFakeClock(initial = 0) {
  let t = initial;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

describe("NonceStore (W4.2)", () => {
  it("NO1: issue() returns a 32-char hex nonce and persists in the store", () => {
    const clock = makeFakeClock();
    const store = new NonceStore(DEFAULT_NONCE_TTL_MS, clock);

    const nonce = store.issue();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(store.has(nonce)).toBe(true);
  });

  it("NO2: consume() is single-use — second consume returns false (replay defense)", () => {
    const clock = makeFakeClock();
    const store = new NonceStore(DEFAULT_NONCE_TTL_MS, clock);

    const nonce = store.issue();
    expect(store.consume(nonce)).toBe(true);
    expect(store.consume(nonce)).toBe(false);
    expect(store.has(nonce)).toBe(false);
  });

  it("NO3: TTL eviction — nonce becomes invalid after TTL expires", () => {
    const clock = makeFakeClock();
    const store = new NonceStore(DEFAULT_NONCE_TTL_MS, clock);

    const nonce = store.issue();
    clock.advance(DEFAULT_NONCE_TTL_MS + 1);
    expect(store.has(nonce)).toBe(false);
    expect(store.consume(nonce)).toBe(false);
  });
});
