// Sprint 3.0 v4 — W3.4 wallet normalization tests (WN1-WN3).
import { describe, it, expect } from "vitest";
import {
  normalizeWallet,
  tryNormalizeWallet,
  InvalidWalletAddressError,
} from "../src/auth/wallet.js";

// Vitalik's known-valid EIP-55 checksum address.
const EIP55 = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const LOWER = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";

describe("normalizeWallet (W3.4)", () => {
  it("WN1: lowercases a mixed-case EIP-55 checksum address", () => {
    expect(normalizeWallet(EIP55)).toBe(LOWER);
  });

  it("WN2: idempotent — already-lowercase addresses pass through unchanged", () => {
    expect(normalizeWallet(LOWER)).toBe(LOWER);
  });

  it("WN3: rejects invalid addresses — throws InvalidWalletAddressError", () => {
    expect(() => normalizeWallet("not-an-address")).toThrow(InvalidWalletAddressError);
    expect(() => normalizeWallet("0x123")).toThrow(InvalidWalletAddressError);
    expect(() => normalizeWallet("")).toThrow(InvalidWalletAddressError);
  });

  it("tryNormalizeWallet returns null on invalid input (non-throwing variant)", () => {
    expect(tryNormalizeWallet("not-an-address")).toBeNull();
    expect(tryNormalizeWallet(null)).toBeNull();
    expect(tryNormalizeWallet(undefined)).toBeNull();
    expect(tryNormalizeWallet(42)).toBeNull();
    expect(tryNormalizeWallet(EIP55)).toBe(LOWER);
  });
});
