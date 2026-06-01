/**
 * Sprint 4.0.2 W1 — `runTool` MCP-tool span wrapper (contract C1, C2).
 *
 * Every MCP tool call passes through this wrapper. The wrapper:
 *
 *   1. Opens a span named `tool.<name>` on the AllowMe tracer.
 *   2. Sets four required attributes — `tool.name`, `tool.role`,
 *      `tool.family_id`, `tool.success`. `family_id` is recorded as a
 *      TRACE ATTRIBUTE only; contract C12 (cardinality discipline)
 *      forbids it as a metric label. See `otel.ts` `ALLOWED_METRIC_LABELS`.
 *   3. Runs the wrapped handler.
 *   4. On success: marks `tool.success=true`, sets `status.code=OK`,
 *      ends the span, returns the result.
 *   5. On throw: marks `tool.success=false`, sets `status.code=ERROR`,
 *      records the exception event, ends the span, RE-THROWS the
 *      original error so the caller's error path is preserved.
 *
 * Critically, when the OTel SDK has not been started (test runs, local
 * dev without `AXIOM_INGEST_TOKEN`), `trace.getTracer()` returns the
 * API-level no-op tracer. The wrapper still executes — it just produces
 * no spans. This means there is no need to branch at call sites.
 */

import { SpanStatusCode, type Span } from "@opentelemetry/api";
import { getTracer } from "../observability/otel.js";

export type Role = "manager" | "co-parent" | "family" | "advisor" | "learner";

export interface RunToolContext {
  name: string;
  role: Role | string;
  familyId: string;
}

/**
 * Wrap an async tool handler in a span. The handler receives the
 * created span so it can add custom attributes if needed (e.g.
 * `tx.amount`, `tx.chain_id` for transfer tools — research §3.1).
 */
export async function runTool<T>(
  context: RunToolContext,
  handler: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(`tool.${context.name}`, async (span) => {
    span.setAttribute("tool.name", context.name);
    span.setAttribute("tool.role", context.role);
    // `family_id` is recorded as a SPAN/TRACE ATTRIBUTE, NEVER a metric
    // label. Cardinality discipline per contract C12.
    span.setAttribute("tool.family_id", context.familyId);

    try {
      const result = await handler(span);
      span.setAttribute("tool.success", true);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setAttribute("tool.success", false);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Convenience signature for callers that don't need the span — most
 * tool handlers don't add custom attributes, so the four standard
 * attributes are sufficient. This overload accepts a zero-argument
 * handler.
 */
export async function runToolSimple<T>(
  context: RunToolContext,
  handler: () => Promise<T>,
): Promise<T> {
  return runTool(context, async (_span) => handler());
}
