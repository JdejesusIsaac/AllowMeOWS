/**
 * Invite-Member Copy Contract — SC1.
 *
 * Snapshot-style copy test (not behaviour-shaped). Locks the load-bearing
 * language in the `invite-member` MCP response so silent reverts of the
 * "browser, not connector dialog" framing trip the test suite.
 *
 * The full sprint contract: A laymen parent reading this response in their
 * Claude session never tries to paste the verify URL into Claude's
 * connector install dialog, because the response copy unambiguously frames
 * the URL as a browser destination, not as an MCP connector URL.
 *
 * SC2 (the parallel SMS-draft assertion) is out of scope — no
 * `message-compose` tool exists in this codebase.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inviteMemberHandler } from "../src/tools/invite-member.js";
import { createTestFamily, makeChild } from "./helpers/family.js";

const testDataDir = join(process.cwd(), "data");

describe("SC: invite-member copy contract", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    // Deterministic verify URL so the SC1 regex has a stable base.
    process.env.ALLOWANCE_AGENT_URL = "https://allowme.dev";
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    delete process.env.ALLOWANCE_AGENT_URL;
  });

  it("SC1: response includes browser-tap instruction, anti-paste warning, verify URL, and fallback framing", async () => {
    const family = await createTestFamily({
      familyName: "Garcia",
      children: [
        makeChild("Elina", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const res = await inviteMemberHandler(
      {
        name: "Elina",
        role: "learner",
        childName: "Elina",
        ...family.asManager(),
      },
      family.managerContext
    );

    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.success).toBe(true);
    const message: string = parsed.message;

    // Browser-tap instruction is present and names specific browsers.
    expect(message).toMatch(/tap it on their phone in a browser/i);
    expect(message).toMatch(/safari|chrome/i);

    // Anti-paste warning — the single most load-bearing line in the response.
    expect(message).toMatch(/do NOT paste THIS link into Claude\/ChatGPT directly/);
    expect(message).toMatch(/this link is for their browser only/i);

    // Verify URL is present and shaped as a real verify-page URL.
    expect(message).toMatch(/https:\/\/[^\s]+\/verify\?invite=/);

    // Fallback is present but explicitly framed as the harder path.
    expect(message).toMatch(/fallback/i);
    expect(message).toMatch(/much smoother/i);
  });
});
