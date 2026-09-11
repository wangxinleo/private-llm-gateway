# Implement span-based scanner pipeline architecture

## Goal

Reduce finding-heavy scanner latency by removing repeated whole-string masking and duplicated temporary-context work while preserving the gateway's existing privacy coverage and forwarding contracts.

## Requirements

1. Add stage-level measurements for parse, JSON unit extraction, global scans, anchor discovery, compatible-window scans, overlap resolution, masking, stringify, and audit handoff. Metrics and logs must not contain raw matched values.
2. Introduce source/provenance-aware scan units for eligible JSON string values. Terminal key, full path, sibling context, parent identity, and binary-payload exemption state must remain available as metadata.
3. Return source-unit-relative spans from detectors and map contextual findings only to the associated real value.
4. Replace finding-by-finding full-string replacement with deterministic overlap resolution and one ordered masking pass per source value.
5. Merge overlapping or adjacent windows only when detector profiles are identical and semantic boundaries/provenance are preserved.
6. Preserve the current policy contracts: PHONE/ID_CARD/BANK_CARD global; EMAIL window-scoped; secrets/context-key/high-risk scans anchor-window scoped; sensitive filenames block first; content blocks return the original body; binary image/base64 exemptions remain unchanged.
7. Keep process-wide caching, Hyperscan/native regex replacement, ID-card scope changes, and broad policy changes out of this task until the corrected pipeline is measured.

## Acceptance Criteria

- [ ] Phase timings and counters are recorded by `@wangxin` in a dated file under this task's `research/` directory for representative tool-call-heavy and zero-finding payloads; each report includes runtime, payload identity, and skipped-fixture status.
- [ ] Span masking has parity tests for overlap precedence, replacement counts, repeated matches, and values containing JSON-escaped characters.
- [ ] Structured scan units preserve sibling/path context without forwarding synthetic context text.
- [ ] Window merging cannot cross unrelated semantic fields and preserves detector coverage.
- [ ] Global PII, anchored contextual scanning, block-original-body behavior, and binary-payload exemptions pass parity tests.
- [ ] On the same runtime and 1.2 MB/40,000-finding benchmark, five timed runs after warm-up have a median at least 50% below the recorded 5.58 s baseline and coefficient of variation at most 10%; existing tests are not deleted or weakened.
- [ ] `npm test`, `npx tsc --noEmit`, and `npm run build` pass; benchmark results include environment and payload identity.
- [ ] No production-resolution claim is made from local benchmarks alone; deployed-build/body evidence remains a separate investigation requirement.

## Constraints

- Work only after this task has reviewed `design.md` and `implement.md` and is explicitly started by Trellis.
- Use TDD for behavior changes: add a failing regression before production edits.
- Do not store raw secrets in cache entries, metrics, ordinary logs, or task artifacts.
