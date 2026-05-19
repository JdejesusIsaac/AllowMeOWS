import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inviteMemberHandler } from "../src/tools/invite-member.js";
import { createTestFamily, makeChild } from "./helpers/family.js";

const testDataDir = join(process.cwd(), "data");

/**
 * D3b: Invite Delivery Response Tests (ID1-ID5)
 *
 * Exercises `inviteMemberHandler` directly (no duplicated response builder).
 */
describe("D3b: Invite Delivery Response", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    delete process.env.ALLOWANCE_AGENT_URL;
  });

  it("ID1: invite-member with ALLOWANCE_AGENT_URL set — response includes serverUrl and joinMessage", async () => {
    process.env.ALLOWANCE_AGENT_URL = "https://allowanceagent.app";

    const family = await createTestFamily({
      familyName: "Garcia",
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 15,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const res = await inviteMemberHandler(
      { name: "Maya", role: "learner", childName: "Maya", ...family.asManager() },
      family.managerContext,
    );
    const response = JSON.parse(res.content[0]!.text);

    expect(response.success).toBe(true);
    expect(response.serverUrl).toBe("https://allowanceagent.app");
    expect(response.joinMessage).toBeDefined();
    expect(typeof response.joinMessage).toBe("string");
    expect(response.inviteCode).toBeDefined();
  });

  it("ID2: invite-member without ALLOWANCE_AGENT_URL — response has inviteCode but omits serverUrl and joinMessage", async () => {
    delete process.env.ALLOWANCE_AGENT_URL;

    const family = await createTestFamily({
      familyName: "Garcia",
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 15,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const res = await inviteMemberHandler(
      { name: "Maya", role: "learner", childName: "Maya", ...family.asManager() },
      family.managerContext,
    );
    const response = JSON.parse(res.content[0]!.text);

    expect(response.success).toBe(true);
    expect(response.inviteCode).toBeDefined();
    expect(response.serverUrl).toBeUndefined();
    expect(response.joinMessage).toBeUndefined();
    expect(response.verifyUrl).toMatch(/^https:\/\/allowme\.dev\/verify\?invite=/);
  });

  it("ID3: joinMessage points at verify URL with browser framing and no duplicate family suffix", async () => {
    process.env.ALLOWANCE_AGENT_URL = "https://allowanceagent.app";

    const family = await createTestFamily({
      familyName: "The Asencio Family",
      children: [
        makeChild("Elina", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const res = await inviteMemberHandler(
      { name: "Elina", role: "learner", childName: "Elina", ...family.asManager() },
      family.managerContext,
    );
    const response = JSON.parse(res.content[0]!.text);
    const joinMessage = response.joinMessage as string;
    const verifyUrl = response.verifyUrl as string;

    expect(joinMessage).toContain(verifyUrl);
    expect(joinMessage).toMatch(/\/verify\?invite=/);
    expect(joinMessage).toMatch(/safari|chrome/i);
    expect(joinMessage).toMatch(/NOT in Claude\/ChatGPT/i);
    expect(joinMessage).not.toMatch(/family family/i);
    expect(joinMessage).not.toContain("Connect your Claude to:");
  });

  it("ID4: learner invite message ends with delivery prompt", async () => {
    process.env.ALLOWANCE_AGENT_URL = "https://allowanceagent.app";

    const family = await createTestFamily({
      familyName: "Garcia",
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 15,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const res = await inviteMemberHandler(
      { name: "Maya", role: "learner", childName: "Maya", ...family.asManager() },
      family.managerContext,
    );
    const response = JSON.parse(res.content[0]!.text);

    expect(response.message).toContain("Want me to draft a text message to send them?");
  });

  it("ID5: Learner invite requires childName — error when missing", async () => {
    const family = await createTestFamily({
      familyName: "Garcia",
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 15,
          categories: [{ name: "education", pct: 100 }],
        }),
      ],
    });

    const res = await inviteMemberHandler(
      { name: "Maya", role: "learner", ...family.asManager() },
      family.managerContext,
    );
    const response = JSON.parse(res.content[0]!.text);

    expect(response.success).toBe(false);
    expect(response.error).toBe("childName required for learner role");
  });
});
