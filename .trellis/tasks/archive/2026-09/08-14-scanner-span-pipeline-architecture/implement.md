# Implementation plan: span-based scanner pipeline

## Phase 0: evidence and guardrails

1. Read this task's PRD/design and the scanner specs before editing source.
2. Add or extend benchmarks for the 224 KB zero-finding replay, 1.2 MB tool-call-heavy body, overlapping anchors, repeated tool schemas, binary payloads, and the 40,000-finding masking case.
3. Add stage timings and privacy-safe counters. Record runtime, payload identity, and whether a fixture was skipped.

## Phase 1: test-first masking

1. Add failing tests for repeated findings, overlapping ranges, deterministic precedence, replacement counts, and values containing escaped Unicode/quotes.
2. Add a span-based value transformer that performs one ordered pass and does not call `replaceAll` across the whole value for each finding.
3. Compare action, findings, masked value, summary, and replacement count with the existing implementation on parity fixtures.
4. Keep block results tied to the immutable original body.

## Phase 2: structured JSON units

1. Add failing tests for nested objects, arrays, sibling key/value association, terminal key versus full path context, and binary data URI/long pure-base64 exemptions.
2. Enumerate eligible values once while retaining provenance metadata.
3. Run global and scoped detector profiles without masking temporary context projections.
4. Map context findings to the associated source unit and resolve overlaps once.
5. Serialize JSON once after all value transformations.

## Phase 3: compatible window merging and routing

1. Add tests proving that identical-profile overlapping windows merge while different profiles and unrelated semantic fields remain isolated.
2. Add conservative keyword/prefix prefilters only for rule families with complete non-lossy required keywords; rules without safe prefilters remain unconditional.
3. Re-run parity and performance suites and inspect findings by category without exposing raw values.

## Quality gate

- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npx vitest run benchmarks/apply-masks-scaling.test.ts benchmarks/scan-latency-real.test.ts --no-file-parallelism --reporter=verbose --silent=false`
- `git diff --check`

The real-payload benchmark must be recorded as skipped when `真实请求.md` is unavailable. Do not substitute a local zero-finding replay for a production claim.

## Deferred work

Do not add a process-wide cache, Hyperscan, ID-card scope changes, or broad regex-engine replacement until the corrected pipeline is measured and reviewed. If a later cache is proposed, first define policy-version invalidation, HMAC-key rotation, byte-bounded memory, TTL, and plaintext exclusion.

## Rollback points

Keep each phase independently revertible. If span mapping changes any existing privacy contract, revert the transformer/structured-unit phase while retaining instrumentation and regression tests. Never delete failing tests to make the gate pass.
