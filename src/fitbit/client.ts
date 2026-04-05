import { FitbitTokenStore, type FitbitTokens } from "./token-store.js";

const FITBIT_AUTH_URL = "https://www.fitbit.com/oauth2/authorize";
const FITBIT_TOKEN_URL = "https://api.fitbit.com/oauth2/token";
const FITBIT_API_BASE = "https://api.fitbit.com";

export interface FitbitActivityData {
  steps: number;
  activeMinutes: number;
  distance: number; // km
  calories: number;
  date: string;
}

export class FitbitClient {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private tokenStore: FitbitTokenStore;

  constructor() {
    const clientId = process.env.FITBIT_CLIENT_ID;
    const clientSecret = process.env.FITBIT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET env vars required");
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;

    const baseUrl = process.env.ALLOWANCE_AGENT_URL || "http://localhost:3000";
    this.redirectUri = `${baseUrl}/fitbit/callback`;
    this.tokenStore = new FitbitTokenStore();
  }

  /**
   * Generate the OAuth authorization URL for a child.
   * Parent taps this link → Fitbit consent screen → callback.
   */
  getAuthUrl(childName: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      scope: "activity",
      state: childName, // pass child name through OAuth state param
    });
    return `${FITBIT_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access + refresh tokens.
   * Called from the OAuth callback endpoint.
   */
  async exchangeCode(code: string, childName: string): Promise<FitbitTokens> {
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");

    const response = await fetch(FITBIT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.redirectUri,
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Fitbit token exchange failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    };

    const tokens: FitbitTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      scope: data.scope,
      childName,
      connectedAt: new Date().toISOString(),
    };

    await this.tokenStore.saveTokens(tokens);
    return tokens;
  }

  /**
   * Refresh an expired access token using the refresh token.
   */
  async refreshAccessToken(childName: string): Promise<FitbitTokens> {
    const existing = await this.tokenStore.getTokens(childName);
    if (!existing) {
      throw new Error(`No Fitbit tokens stored for child "${childName}"`);
    }

    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");

    const response = await fetch(FITBIT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: existing.refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Fitbit token refresh failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    };

    const tokens: FitbitTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      scope: data.scope,
      childName,
      connectedAt: existing.connectedAt,
    };

    await this.tokenStore.saveTokens(tokens);
    return tokens;
  }

  /**
   * Get a valid access token for a child, auto-refreshing if expired.
   */
  async getValidToken(childName: string): Promise<string> {
    let tokens = await this.tokenStore.getTokens(childName);
    if (!tokens) {
      throw new Error(`No Fitbit tokens for child "${childName}". Use connect-fitbit to link their Fitbit account.`);
    }

    // Auto-refresh if expired
    if (new Date(tokens.expiresAt) <= new Date()) {
      tokens = await this.refreshAccessToken(childName);
    }

    return tokens.accessToken;
  }

  /**
   * Query Fitbit Activity API for a specific date.
   * Returns steps, active minutes, distance, and calories.
   */
  async getActivity(childName: string, date?: string): Promise<FitbitActivityData> {
    const accessToken = await this.getValidToken(childName);
    const targetDate = date || new Date().toISOString().split("T")[0]; // today

    const response = await fetch(
      `${FITBIT_API_BASE}/1/user/-/activities/date/${targetDate}.json`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Fitbit API error: ${response.status}`);
    }

    const data = await response.json() as {
      summary: {
        steps: number;
        veryActiveMinutes: number;
        fairlyActiveMinutes: number;
        lightlyActiveMinutes: number;
        distances: Array<{ activity: string; distance: number }>;
        caloriesOut: number;
      };
    };

    const totalActiveMinutes =
      data.summary.veryActiveMinutes +
      data.summary.fairlyActiveMinutes;

    const totalDistance =
      data.summary.distances?.find((d) => d.activity === "total")?.distance || 0;

    return {
      steps: data.summary.steps,
      activeMinutes: totalActiveMinutes,
      distance: totalDistance,
      calories: data.summary.caloriesOut,
      date: targetDate,
    };
  }

  /**
   * Convert Fitbit activity data to an achievement score (0-100).
   * 10,000 steps = 100, linear scale.
   */
  activityToScore(activity: FitbitActivityData): number {
    const stepScore = Math.min(100, Math.round((activity.steps / 10000) * 100));
    return stepScore;
  }

  /**
   * Check if Fitbit is configured (env vars present).
   */
  static isConfigured(): boolean {
    return !!(process.env.FITBIT_CLIENT_ID && process.env.FITBIT_CLIENT_SECRET);
  }

  /**
   * Check if a child has connected Fitbit tokens.
   */
  async isChildConnected(childName: string): Promise<boolean> {
    return this.tokenStore.hasTokens(childName);
  }
}
