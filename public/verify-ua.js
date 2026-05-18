/**
 * Sprint 3.6 — User-agent sniffing for the verify-page install walkthrough (C8 / UA1).
 *
 * Exported as ES modules so Vitest exercises the exact browser bundle.
 */

/**
 * Recognize in-app OAuth / WebViews that bundle their own UA token.
 * @param {string} userAgent
 * @returns {"claude" | "chatgpt" | null}
 */
export function detectInAppClient(userAgent) {
  const ua = String(userAgent || "");

  // ChatGPT iOS/Android in-app browsers ship a `ChatGPT/<version>` fragment.
  if (/\bChatGPT\//i.test(ua)) {
    return "chatgpt";
  }

  return null;
}

/**
 * Primary install-tab default for MCP connector setup.
 * Today every supported surface still defaults to **Claude**; ChatGPT installs
 * get an inline hint when {@link detectInAppClient} returns `"chatgpt"`.
 *
 * @param {string} userAgent
 * @returns {"claude" | "chatgpt" | "other"}
 */
export function defaultInstallTab(userAgent) {
  void userAgent;
  return "claude";
}
