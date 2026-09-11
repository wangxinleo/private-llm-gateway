# Follow-up Diagnosis: `查因.md` Payload

Date: 2026-08-13

## Scope

This follow-up checks whether the current `查因.md` request still reproduces the historical scanner regression and whether synchronous audit persistence is part of the recorded request duration.

## Benchmark

Command:

```text
env NODE_ENV=production DEBUG=false npx vitest run benchmarks/diagnose-current.test.ts --no-file-parallelism --reporter=verbose --silent=false
```

The benchmark used the JSON body extracted from `查因.md` and measured the existing scanner functions without changing production code.

| Measurement | Result |
|---|---:|
| Body size | 223,889 bytes |
| `input` items | 47 |
| `JSON.parse` | 0.197 ms |
| Flat `runPipeline` | 2.733 ms |
| `maskJsonBody` | 18.955 ms |
| Findings | 0 |
| Final action | `allow` |

The benchmark reported `scanCalls: 6970`. That counter spans five `maskJsonBody` calls: one warm-up, three timed iterations, and one final result call. Therefore the current payload invokes the nested scan callback 1,394 times per `maskJsonBody` call. Each callback runs `runPipeline`, yet the complete JSON-mask operation remains below 20 ms for this 224 KB sample.

## Route timing boundary

`src/app/api/[[...path]]/route.ts` computes `durationMs` immediately after the scan result and before calling `logAudit`. `logAudit` then performs synchronous `insertAudit` work and broadcasts the audit event. Consequently, SQLite audit insertion is not included in the duration stored in the audit record or reported in the CSV duration field. The recorded value is pre-audit request time, not scanner-only time. Audit persistence can still consume request-thread time after the measurement and can affect contention, but it does not explain the recorded duration directly.

`initializeConfigs` is guarded by a module-level `configsInitialized` flag, so the configuration database load is a one-time path per process rather than a per-request reload. Each new worker or process initializes its own copy.

## Conclusion

The current payload does not reproduce the historical 14–18 second scanner regression. The previously fixed BRACKET and PII/EMAIL backtracking issues remain resolved on this sample, and the measured `maskJsonBody` cost is approximately 19 ms. No additional production scanner change is justified from this sample alone.

This is a local follow-up diagnosis, not proof that production latency is resolved. If production still reports 844–1469 ms for similar requests, the next investigation must capture phase timings in the deployed process and confirm the deployed commit/build and exact request body. The most likely remaining classes are runtime contention/GC, a different deployed build, or request characteristics not present in the local `查因.md` sample. The missing `audit-log-2026-08-13.csv` and the sample's `Content-Length` mismatch prevent an exact production replay.
