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

    // Sprint 3.7 — founder bio paragraph closes the brand-trust gap from
    // the design-lead critique. Asserts mission + credentials + motivation
    // are all present without locking in marketing-speak phrasing.
    expect(whyContent).toMatch(/Juan Isaac|built by/i);
    expect(whyContent).toMatch(
      /security researcher|Coinbase Developer Platform Ambassador|CDP Ambassador/i,
    );
    expect(whyContent).toMatch(
      /AI literacy|charter-school|NYC|Yonkers|families/i,
    );
    expect(whyContent).toMatch(/AllowMe LLC|pilot/i);
  });
});
