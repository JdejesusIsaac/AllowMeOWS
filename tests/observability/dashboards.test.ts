/**
 * Sprint 4.0.2 W6 — dashboards + saved queries tests (contract C13).
 *
 * Coverage:
 *   - OB36: dashboard JSON files exist, parse, and have the expected
 *           panel structure.
 *   - OB37: saved queries reference real span attributes (tool.name,
 *           tool.duration_ms, tool.success).
 *
 * Live-data render (MV4, MV5) is operator-gated and verified post-
 * deploy; this test suite covers the version-controlled file shape.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const DASHBOARDS_DIR = join(REPO_ROOT, "observability", "dashboards");
const QUERIES_DIR = join(REPO_ROOT, "observability", "queries");

interface Dashboard {
  name: string;
  panels: Array<{ id: string; title: string; type: string }>;
  refresh?: number;
  version?: string;
}

interface Query {
  name: string;
  dataset: string;
  aql: string;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

describe("OB36 — dashboards are version-controlled and valid JSON", () => {
  it("overview.json exists, parses, has 3 panels, refresh=60", () => {
    const path = join(DASHBOARDS_DIR, "overview.json");
    expect(existsSync(path)).toBe(true);
    const d = loadJson<Dashboard>(path);
    expect(d.name).toBe("overview");
    expect(d.panels).toHaveLength(3);
    expect(d.refresh).toBe(60);
    const panelIds = d.panels.map((p) => p.id);
    expect(panelIds).toContain("tool_calls_24h");
    expect(panelIds).toContain("tool_p95_24h");
    expect(panelIds).toContain("error_rate_24h");
  });

  it("policy_engagement.json exists, parses, includes policy_evaluated panel", () => {
    const path = join(DASHBOARDS_DIR, "policy_engagement.json");
    expect(existsSync(path)).toBe(true);
    const d = loadJson<Dashboard>(path);
    expect(d.name).toBe("policy_engagement");
    expect(d.panels.length).toBeGreaterThanOrEqual(1);
    const titles = d.panels.map((p) => p.title.toLowerCase());
    expect(titles.some((t) => t.includes("policy_evaluated"))).toBe(true);
  });
});

describe("OB37 — saved queries reference known span attributes", () => {
  it("tool_calls_24h targets tool.name + 24h window", () => {
    const q = loadJson<Query>(join(QUERIES_DIR, "tool_calls_24h.json"));
    expect(q.name).toBe("tool_calls_24h");
    expect(q.dataset).toBe("mcp-events");
    expect(q.aql).toMatch(/tool\.name/);
    expect(q.aql.toLowerCase()).toMatch(/24h|24\s*hours/);
  });

  it("tool_p95_24h references tool.duration_ms and a percentile", () => {
    const q = loadJson<Query>(join(QUERIES_DIR, "tool_p95_24h.json"));
    expect(q.aql).toMatch(/duration_ms/);
    expect(q.aql.toLowerCase()).toMatch(/percentile|p95/);
  });

  it("error_rate_24h references tool.success", () => {
    const q = loadJson<Query>(join(QUERIES_DIR, "error_rate_24h.json"));
    expect(q.aql).toMatch(/tool\.success/);
  });
});
