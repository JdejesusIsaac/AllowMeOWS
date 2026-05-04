/**
 * Sprint 3.0 v4 — W1.2 Nonce store.
 *
 * In-memory `Map<nonce, issuedAtMs>` with lazy TTL eviction. Single-process
 * Railway deployment is the current scale target; multi-instance scaling
 * (Sprint 4.0+) swaps this for Redis with `SET NX EX` semantics.
 *
 * Replay-attack defense. `issue` returns a cryptographically-random 16-byte
 * hex nonce. `consume` is single-use — a second `consume(sameNonce)` returns
 * `false`. `has` is read-only (used by verify-flow debugging and HE1 test).
 *
 * TTL: 5 minutes. Bounds clock-skew + replay surface.
 */

import { randomBytes } from "node:crypto";

export const DEFAULT_NONCE_TTL_MS = 5 * 60 * 1000;

interface ClockLike {
  now(): number;
}

const REAL_CLOCK: ClockLike = { now: () => Date.now() };

export class NonceStore {
  private readonly issued = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = DEFAULT_NONCE_TTL_MS,
    private readonly clock: ClockLike = REAL_CLOCK
  ) {}

  /** Generate a fresh nonce, persist it with the current timestamp, and return it. */
  issue(): string {
    this.evictExpired();
    const nonce = randomBytes(16).toString("hex");
    this.issued.set(nonce, this.clock.now());
    return nonce;
  }

  /** True if the nonce is currently valid (issued, not consumed, not expired). */
  has(nonce: string): boolean {
    const issuedAt = this.issued.get(nonce);
    if (issuedAt === undefined) return false;
    if (this.clock.now() - issuedAt > this.ttlMs) {
      this.issued.delete(nonce);
      return false;
    }
    return true;
  }

  /**
   * Consume the nonce. Returns `true` exactly once for a valid nonce;
   * subsequent calls return `false` (single-use replay defense). Expired
   * nonces also return `false` and are evicted.
   */
  consume(nonce: string): boolean {
    const issuedAt = this.issued.get(nonce);
    if (issuedAt === undefined) return false;
    this.issued.delete(nonce);
    if (this.clock.now() - issuedAt > this.ttlMs) return false;
    return true;
  }

  /** Test-only: current store size, post-eviction. */
  size(): number {
    this.evictExpired();
    return this.issued.size;
  }

  private evictExpired(): void {
    const cutoff = this.clock.now() - this.ttlMs;
    for (const [nonce, issuedAt] of this.issued) {
      if (issuedAt < cutoff) this.issued.delete(nonce);
    }
  }
}

// Module-level singleton used by the HTTP handlers. Tests construct their
// own instance with a fake clock to assert TTL eviction deterministically.
export const nonceStore = new NonceStore();
