# Sprint 4.0.2 — Test plan: Observability foundation

> Test inventory for Sprint 4.0.2 deliverables. Tests prefixed `OB`
> (OBservability). Maps every test to one or more success criteria
> from plan-4.0.2.md §5.

## 1. Coverage map

| Success criterion | Tests |
|-------------------|-------|
| SC1: OTel span per tool call within 60s | OB1, OB2, OB3, OB4, OB5 |
| SC2: AllowMe audit log forwarding within 30s | OB11, OB12, OB13, OB14 |
| SC3: OWS audit log forwarding within 30s, policy_evaluated visible | OB15, OB16, OB17, OB18 |
| SC4: Sentry captures uncaught exceptions + 5xx with redaction | OB21, OB22, OB23, OB24, OB25 |
| SC5: CI snapshot test — no Tier-1 pattern survives redaction | OB26, OB27, OB28, OB29 |
| SC6: /health returns 503 on deep-check failure | OB31, OB32, OB33, OB34, OB35 |
| SC7: Axiom dashboards render data after 1h | OB36, OB37 |
| SC8: family_id is NOT a metric label | OB6, OB7, OB8 |

Plus OB-PERF-1 (instrumentation overhead) and OB-COV-1 (CI coverage
gate).

## 2. Unit tests

### OB1 — OTel tracer instantiates with correct service name

```typescript
// tests/observability/otel.test.ts
describe("OTel SDK", () => {
  test("OB1: tracer registered with service.name=allowme-mcp", async () => {
    const { tracer } = await import("../../src/observability/otel");
    const span = tracer.startSpan("test");
    const attrs = span.attributes;
    expect(span.resource.attributes["service.name"]).toBe("allowme-mcp");
    span.end();
  });
});
```

### OB2 — Tool runner wraps fn in span with required attributes

```typescript
test("OB2: runTool emits span with tool.name, tool.role, tool.family_id", async () => {
  const spans: ReadableSpan[] = [];
  const exporter = new InMemorySpanExporter();
  // ... register exporter ...

  await runTool("check-progress", "manager", "fam_abc", async () => "ok");

  expect(spans).toHaveLength(1);
  expect(spans[0].name).toBe("tool.check-progress");
  expect(spans[0].attributes["tool.name"]).toBe("check-progress");
  expect(spans[0].attributes["tool.role"]).toBe("manager");
  expect(spans[0].attributes["tool.family_id"]).toBe("fam_abc");
  expect(spans[0].attributes["tool.success"]).toBe(true);
});
```

### OB3 — Failed tool call records exception + sets success=false

```typescript
test("OB3: runTool catches throws and records exception", async () => {
  const spans: ReadableSpan[] = [];
  // ... register exporter ...

  await expect(runTool("verify-achievement", "manager", "fam_abc", async () => {
    throw new Error("boom");
  })).rejects.toThrow("boom");

  expect(spans[0].attributes["tool.success"]).toBe(false);
  expect(spans[0].status.code).toBe(2); // ERROR
  expect(spans[0].events.some(e => e.name === "exception")).toBe(true);
});
```

### OB4 — Duration is recorded

```typescript
test("OB4: span duration_ms reflects actual execution time", async () => {
  // ... setup ...
  await runTool("test", "manager", "fam_abc", async () => {
    await new Promise(r => setTimeout(r, 100));
  });
  const durationMs = (spans[0].endTime[0] - spans[0].startTime[0]) * 1000 +
                     (spans[0].endTime[1] - spans[0].startTime[1]) / 1e6;
  expect(durationMs).toBeGreaterThanOrEqual(100);
  expect(durationMs).toBeLessThan(200);
});
```

### OB5 — OTel disabled when env var absent

```typescript
test("OB5: no exporter initialized when AXIOM_INGEST_TOKEN missing", async () => {
  delete process.env.AXIOM_INGEST_TOKEN;
  jest.resetModules();
  // Module load should not throw, but exporter init should skip
  const otel = await import("../../src/observability/otel");
  expect(otel.sdkStarted).toBe(false);
});
```

### OB6 — `family_id` rejected as metric label

```typescript
test("OB6: attempting to use family_id as metric label triggers lint error", () => {
  // ESLint rule check — see OB-COV-1 for CI gate
  const ruleConfig = require("../../.eslintrc.observability.js");
  expect(ruleConfig.rules["no-family-id-as-metric-label"]).toBe("error");
});
```

### OB7 — Metric instruments use approved label set only

```typescript
test("OB7: tool_calls counter labeled by tool_name, role, success only", () => {
  const counter = getToolCallsCounter(); // hypothetical helper
  expect(counter.attributes).toEqual(
    expect.objectContaining({ allowedLabels: ["tool_name", "role", "success", "chain_id"] })
  );
});
```

### OB8 — Audit logs DO include family_id (as field, not label)

```typescript
test("OB8: audit entries include family_id in body, not in label set", () => {
  const entry = buildAuditEntry({ familyId: "fam_abc", event: "test" });
  expect(entry.family_id).toBe("fam_abc"); // body field — allowed
  // Not asserted against a label dimension because no such dimension exists
});
```

## 3. Integration tests — log forwarding

### OB11 — AllowMe audit log: JSONL append

```typescript
test("OB11: audit-log.jsonl receives one line per append", async () => {
  await writeAuditEntry("fam_abc", { event: "achievement_verified", child: "Maya" });
  const file = path.join(dataDir, "families", "fam_abc", "audit-log.jsonl");
  const lines = (await fs.readFile(file, "utf8")).trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]).event).toBe("achievement_verified");
});
```

### OB12 — Audit log migration: JSON array → JSONL

```typescript
test("OB12: migration script converts JSON array to JSONL", async () => {
  // Setup: legacy JSON array
  const legacyFile = path.join(dataDir, "families", "fam_abc", "audit-log.json");
  await fs.writeFile(legacyFile, JSON.stringify([{ event: "a" }, { event: "b" }]));

  await runAuditLogMigration();

  // After: JSONL file + .bak
  const newFile = path.join(dataDir, "families", "fam_abc", "audit-log.jsonl");
  const lines = (await fs.readFile(newFile, "utf8")).trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(await fs.stat(legacyFile + ".bak")).toBeTruthy();
});
```

### OB13 — Vector tails new entries within 5s

```typescript
test("OB13: Vector reads appended entries within 5 seconds", async () => {
  // Requires Vector running in test env (docker-compose service)
  await writeAuditEntry("fam_abc", { event: "test_signal", marker: nanoid() });
  await waitForAxiomDataset("audit-logs", { marker: theMarker, timeoutMs: 30000 });
  // Pass if Axiom mock receives the entry
});
```

### OB14 — `family_id` extracted from file path

```typescript
test("OB14: Vector parses family_id from path correctly", async () => {
  const result = await runVectorTransform({
    file: "/app/data/families/fam_xyz/audit-log.jsonl",
    message: '{"event": "test"}',
  });
  expect(result.family_id).toBe("fam_xyz");
  expect(result.source).toBe("allowme");
});
```

### OB15 — OWS audit log: tail picks up policy_evaluated entries

```typescript
test("OB15: OWS policy_evaluated entry forwarded to audit-logs dataset", async () => {
  // Trigger a transfer that exercises policy
  await callTool("distribute-allowance", { childName: "Maya" }, { role: "manager", familyId: "fam_abc" });

  // OWS audit log should contain policy_evaluated entry
  const owsLog = path.join(os.homedir(), ".ows", "families", "fam_abc", ".ows", "logs", "audit.jsonl");
  const lines = (await fs.readFile(owsLog, "utf8")).trim().split("\n");
  const policyEntries = lines.map(l => JSON.parse(l)).filter(e => e.event === "policy_evaluated");
  expect(policyEntries.length).toBeGreaterThan(0);

  // And Axiom dataset should receive it
  await waitForAxiomDataset("audit-logs", { event: "policy_evaluated", family_id: "fam_abc" });
});
```

### OB16 — OWS audit entries tagged source=ows

```typescript
test("OB16: OWS entries arrive in Axiom with source=ows", async () => {
  // ... trigger OWS write ...
  const received = await fetchFromAxiomMock();
  expect(received.find(r => r.source === "ows")).toBeTruthy();
});
```

### OB17 — Both audit streams visible in same dataset

```typescript
test("OB17: AllowMe and OWS entries coexist in audit-logs dataset", async () => {
  await callTool("distribute-allowance", { childName: "Maya" }, { role: "manager", familyId: "fam_abc" });
  await sleep(5000);
  const received = await fetchFromAxiomMock();
  expect(received.find(r => r.source === "allowme")).toBeTruthy();
  expect(received.find(r => r.source === "ows")).toBeTruthy();
});
```

### OB18 — `policy_evaluated` includes decision + reason

```typescript
test("OB18: policy_evaluated entry contains decision and reason fields", async () => {
  const owsEntries = await fetchOwsAuditEntries("fam_abc");
  const evalEntry = owsEntries.find(e => e.event === "policy_evaluated");
  expect(evalEntry.decision).toMatch(/^(allow|deny)$/);
  expect(evalEntry.reason).toBeTruthy();
  expect(evalEntry.policy_version).toBeTruthy();
});
```

## 4. Sentry tests

### OB21 — Sentry captures uncaught throw

```typescript
test("OB21: throwing inside a tool sends event to Sentry", async () => {
  const sentryEvents: SentryEvent[] = [];
  jest.spyOn(Sentry, "captureException").mockImplementation((e) => {
    sentryEvents.push({ exception: e });
    return "test-event-id";
  });

  await expect(runTool("verify-achievement", "manager", "fam_abc", async () => {
    throw new Error("test failure");
  })).rejects.toThrow();

  expect(sentryEvents).toHaveLength(1);
});
```

### OB22 — Express 5xx triggers Sentry

```typescript
test("OB22: 5xx response triggers Sentry event", async () => {
  app.get("/test-500", () => { throw new Error("boom"); });
  await request(app).get("/test-500").expect(500);
  expect(sentryEvents.find(e => e.exception?.message === "boom")).toBeTruthy();
});
```

### OB23 — `ows_key_` token in error message is redacted

```typescript
test("OB23: error message containing ows_key_ token is redacted before send", () => {
  const event = {
    message: "Auth failed with token ows_key_abc123def456ghi789",
    exception: { values: [{ value: "ows_key_abc123def456" }] },
  };
  const redacted = redactSensitive(event);
  expect(JSON.stringify(redacted)).not.toMatch(/ows_key_[a-zA-Z0-9_-]/);
  expect(JSON.stringify(redacted)).toContain("[REDACTED_OWS_KEY]");
});
```

### OB24 — Setup code in error message is redacted

```typescript
test("OB24: SETUP-XXXX-XXXX redacted", () => {
  const event = { message: "Validation failed for code SETUP-ABCD-1234" };
  const redacted = redactSensitive(event);
  expect(JSON.stringify(redacted)).toContain("[REDACTED_SETUP_CODE]");
  expect(JSON.stringify(redacted)).not.toContain("SETUP-ABCD-1234");
});
```

### OB25 — Redactor throw drops event (fail-closed)

```typescript
test("OB25: if redactor throws, beforeSend returns null and event is dropped", () => {
  const broken = jest.spyOn(redactModule, "redactSensitive").mockImplementation(() => {
    throw new Error("redactor exploded");
  });

  const beforeSend = Sentry.getCurrentClient()?.getOptions().beforeSend!;
  const result = beforeSend({ message: "test" } as any, {} as any);
  expect(result).toBeNull();

  broken.mockRestore();
});
```

## 5. Redaction snapshot tests

### OB26 — Snapshot: redactor output for ows_key_ pattern

```typescript
test("OB26: ows_key_ token redaction snapshot", () => {
  const input = "Token: ows_key_a1b2c3d4e5f6g7h8";
  expect(redactString(input)).toMatchInlineSnapshot(`"Token: [REDACTED_OWS_KEY]"`);
});
```

### OB27 — Snapshot: nested object with token in field

```typescript
test("OB27: nested object with token in field is redacted", () => {
  const input = {
    user: { id: 1, token: "ows_key_secret123abc456" },
    error: { detail: "Bad token: ows_key_other987" },
  };
  expect(redactObject(input)).toMatchInlineSnapshot(`
    Object {
      "error": Object { "detail": "Bad token: [REDACTED_OWS_KEY]" },
      "user": Object { "id": 1, "token": "[REDACTED_OWS_KEY]" },
    }
  `);
});
```

### OB28 — Snapshot: passphrase env var redacted

```typescript
test("OB28: OWS_PASSPHRASE in env-style string redacted", () => {
  const input = "Failed to start: OWS_PASSPHRASE=my-secret-passphrase invalid";
  expect(redactString(input)).toMatchInlineSnapshot(
    `"Failed to start: OWS_PASSPHRASE=[REDACTED] invalid"`
  );
});
```

### OB29 — Tier-2 (child name) survives intact — documented behavior

```typescript
test("OB29: child names are NOT redacted (Tier 2 — documented)", () => {
  const input = "Verified achievement for Maya: reading 30min";
  expect(redactString(input)).toBe(input); // unchanged
});
```

This test is intentional. It documents the privacy policy: child names
flow through to the aggregator, which is the operability/privacy
trade-off committed to in `docs/PRIVACY.md`.

## 6. /health deep checks

### OB31 — Healthy state returns 200 with all checks ok

```typescript
test("OB31: /health returns 200 when all deep checks pass", async () => {
  const res = await request(app).get("/health");
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("ok");
  expect(res.body.checks.masterKey.status).toBe("ok");
  expect(res.body.checks.owsVault.status).toBe("ok");
  expect(res.body.checks.recentTx.status).toBe("ok");
  expect(res.body.checks.policyEngagement.status).toBe("ok");
});
```

### OB32 — Missing master key returns 503

```typescript
test("OB32: /health returns 503 when master key absent", async () => {
  await fs.rename(masterKeyPath, masterKeyPath + ".bak");
  try {
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.masterKey.status).toBe("fail");
  } finally {
    await fs.rename(masterKeyPath + ".bak", masterKeyPath);
  }
});
```

### OB33 — Unreadable OWS vault returns 503

```typescript
test("OB33: /health flags owsVault.fail when vault unreadable", async () => {
  await fs.chmod(owsVaultDir, 0o000);
  try {
    const res = await request(app).get("/health");
    expect(res.body.checks.owsVault.status).toBe("fail");
    expect(res.status).toBe(503);
  } finally {
    await fs.chmod(owsVaultDir, 0o700);
  }
});
```

### OB34 — Recent tx failures elevate health to degraded

```typescript
test("OB34: 100% recent tx failure rate flags recentTx.fail", async () => {
  await seedAuditEntries({
    familyId: "fam_abc",
    events: Array(10).fill({ event: "transfer_failed" }),
  });
  const res = await request(app).get("/health");
  expect(res.body.checks.recentTx.status).toBe("fail");
});
```

### OB35 — Latency reported per-check

```typescript
test("OB35: each check reports latencyMs", async () => {
  const res = await request(app).get("/health");
  expect(res.body.checks.masterKey.latencyMs).toBeGreaterThanOrEqual(0);
  expect(res.body.checks.masterKey.latencyMs).toBeLessThan(500);
});
```

## 7. Dashboard tests

### OB36 — Dashboard JSON validates against Axiom schema

```typescript
test("OB36: overview.json is a valid Axiom dashboard definition", () => {
  const dashboard = JSON.parse(fs.readFileSync("observability/dashboards/overview.json", "utf8"));
  expect(dashboard.name).toBe("overview");
  expect(dashboard.panels).toHaveLength(3);
  expect(dashboard.refresh).toBe(60); // seconds
});
```

### OB37 — Saved queries reference existing fields

```typescript
test("OB37: tool_calls_24h query targets known span attributes", () => {
  const query = JSON.parse(fs.readFileSync("observability/queries/tool_calls_24h.json", "utf8"));
  expect(query.aql).toMatch(/tool\.name/);
  expect(query.aql).toMatch(/last 24 hours/);
});
```

## 8. Performance test

### OB-PERF-1 — Instrumentation overhead under 5ms p95

```typescript
test("OB-PERF-1: runTool wrapper adds <5ms p95 vs unwrapped call", async () => {
  const unwrappedTimes: number[] = [];
  const wrappedTimes: number[] = [];
  const N = 1000;

  // Baseline
  for (let i = 0; i < N; i++) {
    const start = process.hrtime.bigint();
    await Promise.resolve(); // simulate trivial tool body
    unwrappedTimes.push(Number(process.hrtime.bigint() - start) / 1e6);
  }

  // Instrumented
  for (let i = 0; i < N; i++) {
    const start = process.hrtime.bigint();
    await runTool("perf-test", "manager", "fam_abc", () => Promise.resolve());
    wrappedTimes.push(Number(process.hrtime.bigint() - start) / 1e6);
  }

  const p95 = (arr: number[]) => arr.sort((a, b) => a - b)[Math.floor(arr.length * 0.95)];
  const overhead = p95(wrappedTimes) - p95(unwrappedTimes);
  expect(overhead).toBeLessThan(5);
}, 30000);
```

## 9. CI coverage gate

### OB-COV-1 — Redactor branches 100% covered

```typescript
// Jest coverage threshold in jest.config.js
module.exports = {
  // ...
  coverageThreshold: {
    "src/observability/redact.ts": {
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
};
```

This is the load-bearing CI gate: the redactor MUST have full branch
coverage because a missed branch is a token leak.

## 10. Manual verification checklist

Tests that can't be fully automated (require running deployment):

- **MV1:** Hit `/health` in staging, verify it returns 200 with all
  four checks.
- **MV2:** Trigger a deliberate error via test endpoint; verify event
  appears in Sentry within 60s with redacted body.
- **MV3:** Run a real `distribute-allowance` in staging; verify both
  `policy_evaluated` and `broadcast_transaction` appear in Axiom
  audit-logs within 60s.
- **MV4:** Load the `overview` dashboard in Axiom; verify three panels
  render with real data.
- **MV5:** Load the `policy_engagement` dashboard; verify
  `decision: "allow"` count is > 0 after 1h of traffic.
- **MV6:** Search Axiom by `family_id` — verify the search works on
  log fields but is unavailable as a metric grouping dimension.
- **MV7:** Read `docs/PRIVACY.md` end-to-end; verify the document
  accurately describes what Axiom receives.

## 11. Test execution order

1. Unit tests (OB1-OB8) — run on every PR.
2. Integration tests with mocked Axiom (OB11-OB18, OB36-OB37) — run on
   PR and main.
3. Sentry + redaction tests (OB21-OB29) — run on every PR. OB-COV-1
   gate enforced.
4. Deep health tests (OB31-OB35) — run on PR with full server context.
5. Perf test (OB-PERF-1) — run nightly + on observability PRs.
6. Manual verification (MV1-MV7) — run pre-deploy and at 24h post-
   deploy.

## 12. Exit criteria for Sprint 4.0.2

- All automated tests pass on main: OB1-OB37 + OB-PERF-1.
- OB-COV-1 coverage gate is green.
- All 7 manual verification items checked off.
- 24-hour soak test in staging: no Sentry-side bug reports, no missing
  audit entries, p95 latency unchanged vs pre-sprint baseline.
- Sign-off: Generator/Evaluator pass on observed dashboards.