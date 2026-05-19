/**
 * Sprint 3.6 — QR1: QR code in invite-member response.
 *
 * The Manager-side `invite-member` response must include an `inviteQrCode`
 * field so the parent's Claude/ChatGPT session can render a scannable QR
 * inline. The kid points their phone camera at it; iOS/Android camera apps
 * recognise the QR and offer to open the verify URL natively in a browser.
 * Zero URL pasting required for the parent → kid handoff.
 *
 * Contract C2 (Sprint 3.6) allows either form:
 *   - inline `data:image/png;base64,...` (preferred, self-contained)
 *   - hosted `https://.../qr/...` URL (fallback if Claude's renderer doesn't
 *     display inline base64 reliably)
 *
 * Written BEFORE the implementation lands (Step 3 of progress.md). Expected
 * to be RED on this commit, GREEN once the qrcode integration ships.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inviteMemberHandler } from "../src/tools/invite-member.js";
import { createTestFamily, makeChild } from "./helpers/family.js";

const testDataDir = join(process.cwd(), "data");

describe("QR: invite-member QR code", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    // Deterministic verify URL so the QR encodes a stable input.
    process.env.ALLOWANCE_AGENT_URL = "https://allowme.dev";
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    delete process.env.ALLOWANCE_AGENT_URL;
  });

  it("QR1: response includes a valid QR code (inline base64 PNG or hosted-URL fallback)", async () => {
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

    const body = JSON.parse(res.content[0]!.text);

    // 1. inviteQrCode field is present and a string
    expect(body.inviteQrCode).toBeDefined();
    expect(typeof body.inviteQrCode).toBe("string");

    // 2. Either inline base64 form OR hosted-URL fallback form
    const qrValue: string = body.inviteQrCode;
    const isBase64 = qrValue.startsWith("data:image/png;base64,");
    const isHostedUrl = qrValue.startsWith("https://") && qrValue.includes("/qr/");
    expect(isBase64 || isHostedUrl).toBe(true);

    // 3. If base64 form, decode and verify it's a valid PNG (header check)
    if (isBase64) {
      const base64Data = qrValue.replace(/^data:image\/png;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      // PNG header: 89 50 4E 47 0D 0A 1A 0A
      expect(buffer.slice(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }

    // 4. The verify URL must still be present — QR is a supplement, not
    //    a replacement. The link is the canonical handoff artifact; the QR
    //    is the camera-scannable representation of the same URL.
    expect(body.verifyUrl).toMatch(/^https:\/\/[^\s]+\/verify\?invite=/);

    // 5. The response copy must reference the QR option so the parent
    //    understands what the inline image is for.
    expect(body.message).toMatch(/scan.*QR|QR.*scan/i);

    // 6. Message must embed the QR as renderable markdown (not only a JSON field).
    const message: string = body.message;
    const dataUrlEmbed = /!\[[^\]]*\]\(data:image\/png;base64,/.test(message);
    const hostedUrlEmbed = /!\[[^\]]*\]\(https:\/\/[^\s)]+\.png\)/.test(message);
    expect(dataUrlEmbed || hostedUrlEmbed).toBe(true);
    if (isBase64) {
      expect(message).toContain(qrValue);
    }
  });
});
