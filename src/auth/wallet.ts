/**
 * Sprint 3.0 v4 — W3.4 shared helper.
 *
 * Wallet addresses are stored and compared lowercased throughout the
 * auth + member-index layers. EIP-55 checksum capitalization is a display
 * concern only; comparing two checksumless forms is sufficient since the
 * hex bytes are identical.
 *
 * Callers that surface addresses to users may re-checksum via
 * `viem.getAddress(addr)` at the UI boundary. Storage, MemberIndex keys,
 * audit-log details, and JWT claims all use the lowercase form.
 */

import { isAddress } from "viem";

export class InvalidWalletAddressError extends Error {
  constructor(value: string) {
    super(`Not a valid EVM wallet address: ${value}`);
    this.name = "InvalidWalletAddressError";
  }
}

/**
 * Normalize a wallet address to its lowercase canonical form.
 * Throws `InvalidWalletAddressError` if the input is not a valid EVM address.
 */
export function normalizeWallet(addr: string): string {
  if (typeof addr !== "string" || !isAddress(addr)) {
    throw new InvalidWalletAddressError(addr);
  }
  return addr.toLowerCase();
}

/** Non-throwing variant — returns null on invalid input. */
export function tryNormalizeWallet(addr: unknown): string | null {
  if (typeof addr !== "string" || !isAddress(addr)) return null;
  return addr.toLowerCase();
}
