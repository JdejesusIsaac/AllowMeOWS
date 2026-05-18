/**
 * Sprint 3.6 — Unicode / markdown helpers for kid-facing "rich cards"
 * returned in MCP JSON `summary` fields.
 */
import { USDC } from "../constants.js";

const FILLED = "▓";
const EMPTY = "░";

/**
 * Renders a bounded-width bar: `[▓▓▓░░░░░░░]` style.
 */
export function renderProgressBar(
  current: number,
  total: number,
  width = 10,
): string {
  const safeTotal = total > 0 ? total : 1;
  const clamped = Math.max(0, Math.min(current, safeTotal));
  const filled = Math.round((clamped / safeTotal) * width);
  const empty = width - filled;
  return `[${FILLED.repeat(filled)}${EMPTY.repeat(empty)}]`;
}

/** USDC micro-units → `$1.23` */
export function formatUsdFromMicro(micro: number): string {
  return `$${(micro / 10 ** USDC.DECIMALS).toFixed(2)}`;
}
