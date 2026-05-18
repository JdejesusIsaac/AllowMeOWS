/**
 * Sprint 3.6 UA1 — Verify-page UA parser (`public/verify-ua.js`), contract C8.
 */
import { describe, it, expect } from "vitest";
import {
  defaultInstallTab,
  detectInAppClient,
} from "../public/verify-ua.js";

describe("UA: client detection for verify-page install tabs", () => {
  it("UA1: parser returns the correct default tab across the 4 detection cases", () => {
    const iosSafari =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(defaultInstallTab(iosSafari)).toBe("claude");
    expect(detectInAppClient(iosSafari)).toBeNull();

    const androidChrome =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(defaultInstallTab(androidChrome)).toBe("claude");
    expect(detectInAppClient(androidChrome)).toBeNull();

    const desktopChrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(defaultInstallTab(desktopChrome)).toBe("claude");
    expect(detectInAppClient(desktopChrome)).toBeNull();

    const chatgptWebView =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 ChatGPT/1.2024.0";
    expect(detectInAppClient(chatgptWebView)).toBe("chatgpt");
    expect(defaultInstallTab(chatgptWebView)).toBe("claude");
  });
});
