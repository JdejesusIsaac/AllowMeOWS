/**
 * Sprint 4.0 W6 — `settle-session-payout`.
 *
 * Internal-only USDC transfer for a single completed Learning Mode
 * session. NOT exposed via stdio/HTTP MCP transports — invoked from
 * `complete-learning-session.ts` after the session record has been
 * persisted and the payout breakdown computed.
 *
 * Strategy (revised from plan): a dedicated module rather than an
 * extension to `distribute-allowance`. Same Sprint 3.0.2 allowlist
 * enforcement, same savings-split rules, same `WalletDistributor` and
 * `FamilyKeyManager` plumbing — just a separate code path so the
 * existing 389+ distribute-allowance tests stay green.
 *
 * Audit semantics: this module does NOT write the
 * `learning-session-completed` entry (that's the caller's job, because
 * the caller also owns the receipt-summary and the kid-side state
 * mutation). It DOES write `transfer-rejected-by-allowlist` if the
 * allowlist check fails. The savings-vault leg writes a SavingsEntry
 * with the standard 90-day lock, just like distribute-allowance.
 */

import { randomUUID } from "node:crypto";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
import { PolicyEngine } from "../engine/policy.js";
import { WalletDistributor } from "../wallet/distributor.js";
import { FamilyKeyManager } from "../keys/family-keys.js";
import { WALLET_NAMES } from "../constants.js";
import { checkDestinationAllowlist } from "../core/allowlist.js";
import type { CallerContext } from "../middleware/access-control.js";

export interface SettleSessionPayoutInput {
  childName: string;
  /** Total payout in 6-decimal USDC micros. May be zero. */
  amountUsdc: number;
  /** Session metadata threaded into the audit-log details on rejection. */
  sessionId: string;
}

export type SettleSessionPayoutResult =
  | {
      ok: true;
      childAmount: number;
      savingsAmount: number;
      txHash?: string;
      savingsTxHash?: string;
      savingsError?: string;
    }
  | {
      ok: false;
      rejectedReason: string;
      attemptedDestination: string;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Settle a session payout. Returns a discriminated result; the caller
 * decides how to surface success/rejection in the MCP response and how
 * to write the `learning-session-completed` audit entry.
 *
 * Zero-amount settlement is a valid success: returns `{ok: true,
 * childAmount: 0, savingsAmount: 0}` without touching the wallet.
 */
export async function settleSessionPayout(
  caller: CallerContext,
  input: SettleSessionPayoutInput
): Promise<SettleSessionPayoutResult> {
  if (input.amountUsdc < 0) {
    return { ok: false, error: "amountUsdc must be non-negative" };
  }
  if (input.amountUsdc === 0) {
    return {
      ok: true,
      childAmount: 0,
      savingsAmount: 0,
    };
  }

  const state = new StateManager();
  const familyId = caller.familyId;
  const config = await state.loadFamilyConfig(familyId);
  if (!config) {
    return { ok: false, error: "No family configured" };
  }
  const childConfig = config.children.find(
    (c) => c.name.toLowerCase() === input.childName.toLowerCase()
  );
  if (!childConfig) {
    return {
      ok: false,
      error: `Child "${input.childName}" not found in family config`,
    };
  }

  const engine = new PolicyEngine();
  const { childAmount, savingsAmount } = engine.calculateSavingsSplit(
    input.amountUsdc,
    childConfig.savingsPercent
  );

  // Allowlist check on the child-wallet leg — same rules as
  // distribute-allowance (Sprint 3.0.2 Decision 2). Internal vaults
  // (savings, gift, treasury) and OWS-managed wallets are exempt.
  if (childAmount > 0 && childConfig.walletAddress) {
    const check = checkDestinationAllowlist(
      childConfig.walletAddress,
      config.authorizedDestinations
    );
    if (!check.allowed) {
      await state.addAuditEntry(familyId, {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        action: "transfer-rejected-by-allowlist",
        actor: caller.memberId,
        details: {
          tool: "settle-session-payout",
          childName: childConfig.name,
          sessionId: input.sessionId,
          attemptedDestination: childConfig.walletAddress,
          reason: check.reason,
        },
      });
      return {
        ok: false,
        rejectedReason: check.reason ?? "destination-not-allowlisted",
        attemptedDestination: childConfig.walletAddress,
      };
    }
  }

  // Resolve the per-family encryption key, same as distribute-allowance.
  const keyManager = new FamilyKeyManager();
  let passphrase: string | undefined;
  if (keyManager.hasFamilyKey(familyId)) {
    passphrase = keyManager.getFamilyKey(familyId);
  } else if (process.env.OWS_PASSPHRASE) {
    passphrase = process.env.OWS_PASSPHRASE;
  }
  if (!passphrase) {
    return {
      ok: false,
      error: "Family wallet not initialized. Run configure-policy first.",
    };
  }
  const distributor = new WalletDistributor(passphrase, getFamilyVaultPath(familyId));

  let txHash: string | undefined;
  let savingsTxHash: string | undefined;
  let savingsError: string | undefined;

  if (childAmount > 0) {
    const childResult = await distributor.transferUSDC(
      WALLET_NAMES.TREASURY,
      childConfig.walletAddress
        ? childConfig.name
        : WALLET_NAMES.childWallet(childConfig.name),
      childAmount,
      config.chainId,
      config.usdcAddress,
      childConfig.walletAddress
    );
    txHash = childResult.txHash;
  }

  if (savingsAmount > 0) {
    try {
      const savingsResult = await distributor.transferUSDC(
        WALLET_NAMES.TREASURY,
        WALLET_NAMES.SAVINGS_VAULT,
        savingsAmount,
        config.chainId,
        config.usdcAddress
      );
      savingsTxHash = savingsResult.txHash;
      await state.addSavingsEntry(familyId, {
        id: randomUUID(),
        childName: childConfig.name,
        amount: savingsAmount,
        depositedAt: new Date().toISOString(),
        lockUntil: new Date(
          Date.now() + childConfig.savingsLockDays * 24 * 60 * 60 * 1000
        ).toISOString(),
        released: false,
        multiplierAtDeposit:
          (await state.loadStreak(familyId, childConfig.name))?.multiplier ??
          1.0,
      });
    } catch (savErr) {
      savingsError =
        savErr instanceof Error ? savErr.message : "Savings transfer failed";
    }
  }

  return {
    ok: true,
    childAmount,
    savingsAmount,
    txHash,
    savingsTxHash,
    savingsError,
  };
}
