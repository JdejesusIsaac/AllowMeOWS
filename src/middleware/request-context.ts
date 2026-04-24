import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context propagated through async boundaries via AsyncLocalStorage.
 *
 * The HTTP transport (app/server.ts) populates this for each incoming MCP
 * request so that tool handlers — invoked deep inside the MCP SDK — can read
 * auth headers and URL query params via `getRequestContext()`. Stdio mode
 * leaves this empty; callers still have access to `_callerId`/`_callerRole`
 * via tool args.
 */
export interface RequestContext {
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` with the given request context as the current async-local store.
 * Any async work started inside `fn` (including MCP SDK internals) will see
 * the same context via `getRequestContext()`.
 */
export async function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => T | Promise<T>
): Promise<T> {
  return storage.run(ctx, async () => await fn());
}

/**
 * Return the current request context if one is active, else undefined.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
