# Design: provenance-aware span-based scanner pipeline

## Boundary

This task follows the completed P0 regex/PII fix. It targets the measured finding-heavy masking and repeated-context costs; it does not replace the rule set, widen scanning policy, or claim that production latency has been resolved.

## Data flow

```text
request metadata / filename policy
        -> if filename policy blocks: return immutable original body
        -> parse JSON once
        -> eligible string scan units with path and provenance
        -> global PII projection + scoped anchor projections
        -> detector spans relative to a source unit
        -> dedupe and overlap precedence
        -> if content policy blocks: return immutable original body
        -> one ordered mask pass per source value
        -> JSON serialization
```

## Scan units and provenance

Each eligible string value should carry a stable unit identity, decoded value, JSON path, terminal key, parent/sibling metadata, and binary-exemption decision. Synthetic `key=value` or `path=value` text may remain a detector projection for compatibility, but it must never be the masking source and every contextual match must map back to the associated real value.

Decoded-value offsets must not be applied directly to raw escaped JSON. The first implementation should transform decoded values and serialize once; a raw-body transformer requires an explicit decoded-to-source offset map and its own escaping tests.

## Detector profiles

- Global profile: PHONE, ID_CARD, and BANK_CARD across eligible text, preserving current global coverage.
- Scoped profile: EMAIL, secrets, context-key, and high-risk asset rules only inside applicable anchor windows.
- Window ranges are expanded by the configured radius, sorted, and merged only when the detector profile is identical. Provenance and separators must prevent matches from crossing unrelated fields.

## Finding resolution, block, and masking

Findings contain category, action, source unit, decoded start/end, mask tag, and rule identity where available. Resolve duplicates by source unit/range/category, then apply explicit precedence for overlapping ranges. Evaluate block decisions before any value is mutated; a blocked request returns the immutable original body. For non-blocked requests, preserve all audit categories while emitting one replacement for a resolved range. Build the final value in source order so transformation is linear in value size plus finding count rather than one full-text traversal per finding.

## Observability and privacy

Record phase duration, input bytes, unit count, raw/merged window count, detector invocations, raw/resolved finding counts, replacement count, and cache eligibility. Never emit raw matched values in ordinary logs or metrics. Debug mode must summarize by category rather than log one line per finding.

## Rollout and rollback

1. Land instrumentation and parity fixtures without changing behavior.
2. Land span masking behind a narrowly scoped internal switch or equivalent testable seam.
3. Compare old/new findings, actions, masked bodies, summaries, and latency on the same corpus.
4. Roll back to the existing value-based masking path if any contract differs or a benchmark regresses.

Request-local memoization, process LRU caching, and Hyperscan are deferred until this pipeline is profiled. Any later cache must include rule/config/parser/normalization/redaction/exemption identity and store spans/categories rather than plaintext.
