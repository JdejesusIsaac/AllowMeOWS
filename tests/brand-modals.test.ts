/**
 * Sprint 3.6 MODAL1 — Brand modal Markdown must stay accurate (contract C3 / critical-path).
 *
 * Served at `/copy/security.md` and `/copy/why.md` via `express.static(public)`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicCopy = join(here, "..", "public", "copy");

describe("MODAL: brand narrative modals", () => {
  it("MODAL1: security.md and why.md contain load-bearing phrases", () => {
    const securityContent = readFileSync(join(publicCopy, "security.md"), "utf-8");
    expect(securityContent.length).toBeGreaterThan(100);

    expect(securityContent).toMatch(/encrypted/i);
    expect(securityContent).toMatch(/allowlist|authorized destination/i);
    expect(securityContent).toMatch(/audit/i);

    expect(securityContent).not.toMatch(/non-custodial/i);
    expect(securityContent).not.toMatch(/trustless/i);

    expect(securityContent).toMatch(/Sprint 4|Coinbase Smart Wallet|self-custodial/i);

    const whyContent = readFileSync(join(publicCopy, "why.md"), "utf-8");
    expect(whyContent).toMatch(/financial literacy|underserved|families/i);
    expect(whyContent.length).toBeGreaterThan(200);
    expect(whyContent.length).toBeLessThan(3000);
  });
});
