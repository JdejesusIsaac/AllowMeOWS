/**
 * Sprint 4.0.2 — OTel SDK + runTool span wrapper tests
 * (contract C1, C2, C12).
 *
 * Coverage:
 *   - OB1: tracer registered with service.name=allowme-mcp.
 *   - OB2: runTool emits a span with required attributes
 *          (tool.name, tool.role, tool.family_id, tool.success).
 *   - OB3: failed tool call records exception + status=ERROR + re-throws.
 *   - OB4: duration is recorded (span end > span start).
 *   - OB5: no exporter initialized when AXIOM_INGEST_TOKEN missing.
 *   - OB6/OB7/OB8: cardinality discipline — family_id NEVER in
 *                  metric label set; allowed labels are exactly
 *                  {tool_name, role, success, chain_id}.
 *
 * Tests use the in-memory span exporter so we can assert on what the
 * OTel SDK saw without needing a live OTLP endpoint.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import {
  ALLOWED_METRIC_LABELS,
  OTEL_SERVICE_NAME,
  isStarted,
  startOtel,
  _resetOtelForTests,
} from "../../src/observability/otel.js";
import { runTool } from "../../src/middleware/tool-runner.js";

// In-memory exporter used by OB2/OB3/OB4 — wired into a local
// TracerProvider so we don't depend on `startOtel()` (which requires
// AXIOM_INGEST_TOKEN). This is the standard OTel testing pattern.
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  resource: new Resource({ [ATTR_SERVICE_NAME]: OTEL_SERVICE_NAME }),
});
// The installed SDK uses the .addSpanProcessor() API (rather than the
// constructor-option style of newer releases). Register once at module
// load so every test in this file shares the in-memory exporter.
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
provider.register();

beforeEach(() => {
  exporter.reset();
});

afterEach(() => {
  exporter.reset();
});

describe("OTel SDK init lifecycle (OB5)", () => {
  beforeEach(() => {
    _resetOtelForTests();
  });

  it("OB5: SDK is NOT started when AXIOM_INGEST_TOKEN is absent", () => {
    const result = startOtel({ env: {} as NodeJS.ProcessEnv });
    expect(result).toBe(false);
    expect(isStarted()).toBe(false);
  });

  it("OB5b: SDK starts when AXIOM_INGEST_TOKEN is present", () => {
    const result = startOtel({
      env: { AXIOM_INGEST_TOKEN: "test-token" } as NodeJS.ProcessEnv,
      endpoint: "http://localhost:4318/v1/traces",
    });
    expect(result).toBe(true);
    expect(isStarted()).toBe(true);
  });

  it("OB5c: startOtel is idempotent — second call is a no-op", () => {
    startOtel({
      env: { AXIOM_INGEST_TOKEN: "test-token" } as NodeJS.ProcessEnv,
      endpoint: "http://localhost:4318/v1/traces",
    });
    const result = startOtel({
      env: { AXIOM_INGEST_TOKEN: "test-token-2" } as NodeJS.ProcessEnv,
    });
    expect(result).toBe(true); // already started
    expect(isStarted()).toBe(true);
  });
});

describe("runTool — span attributes (OB1, OB2, OB4)", () => {
  it("OB1: spans are emitted on the AllowMe tracer with the canonical name", async () => {
    await runTool(
      { name: "check-progress", role: "manager", familyId: "fam_abc" },
      async () => "ok",
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("tool.check-progress");
    expect(spans[0].instrumentationLibrary.name).toBe("allowme-mcp-tools");
  });

  it("OB2: required attributes are set — name, role, family_id, success", async () => {
    await runTool(
      { name: "check-progress", role: "manager", familyId: "fam_abc" },
      async () => "ok",
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0].attributes;
    expect(attrs["tool.name"]).toBe("check-progress");
    expect(attrs["tool.role"]).toBe("manager");
    expect(attrs["tool.family_id"]).toBe("fam_abc");
    expect(attrs["tool.success"]).toBe(true);
  });

  it("OB4: span has a non-zero duration when the handler awaits", async () => {
    await runTool(
      { name: "delayed-tool", role: "manager", familyId: "fam_abc" },
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "ok";
      },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    // hrtime tuple math: [seconds, nanoseconds] difference.
    const durationMs =
      (span.endTime[0] - span.startTime[0]) * 1000 +
      (span.endTime[1] - span.startTime[1]) / 1e6;
    expect(durationMs).toBeGreaterThanOrEqual(5); // ≥5ms tolerance for CI jitter
    expect(durationMs).toBeLessThan(500); // sanity upper bound
  });
});

describe("runTool — failure path (OB3)", () => {
  it("OB3: throwing handler records exception + ERROR status + re-throws", async () => {
    const original = new Error("boom");
    await expect(
      runTool(
        { name: "verify-achievement", role: "manager", familyId: "fam_abc" },
        async () => {
          throw original;
        },
      ),
    ).rejects.toThrow("boom");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.attributes["tool.success"]).toBe(false);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toContain("boom");
    // Exception event is recorded with the conventional name.
    expect(span.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("OB3b: non-Error throws (string) still emit a wrapped exception event", async () => {
    await expect(
      runTool(
        { name: "weird-thrower", role: "manager", familyId: "fam_abc" },
        async () => {
          // eslint-disable-next-line no-throw-literal
          throw "string-error";
        },
      ),
    ).rejects.toBe("string-error");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes["tool.success"]).toBe(false);
  });
});

describe("Cardinality discipline (OB6, OB7, OB8 — contract C12)", () => {
  it("OB6/OB7: ALLOWED_METRIC_LABELS does NOT include family_id", () => {
    expect(ALLOWED_METRIC_LABELS).not.toContain("family_id");
    expect(ALLOWED_METRIC_LABELS).not.toContain("family.id");
  });

  it("OB7: ALLOWED_METRIC_LABELS is exactly the four approved labels", () => {
    // Frozen, intentional set — additions require a contract amendment.
    expect([...ALLOWED_METRIC_LABELS].sort()).toEqual([
      "chain_id",
      "role",
      "success",
      "tool_name",
    ]);
  });

  it("OB7b: ALLOWED_METRIC_LABELS is immutable (frozen)", () => {
    expect(Object.isFrozen(ALLOWED_METRIC_LABELS)).toBe(true);
  });

  it("OB8: family_id is recorded as a SPAN attribute, NOT a metric label", async () => {
    await runTool(
      { name: "check-progress", role: "manager", familyId: "fam_unique_xyz" },
      async () => "ok",
    );
    const spans = exporter.getFinishedSpans();
    // The family_id MUST appear in span attributes…
    expect(spans[0].attributes["tool.family_id"]).toBe("fam_unique_xyz");
    // …and MUST NOT be in the cardinality whitelist.
    expect(ALLOWED_METRIC_LABELS).not.toContain("family_id");
    expect(ALLOWED_METRIC_LABELS).not.toContain("tool.family_id");
  });
});
