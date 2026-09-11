# Historical implementation design: scanner P0 performance fix

## Scope

This document reconstructs the design boundary for the implementation recorded by this child task. It is a historical record, not a proposal to implement the later span-based architecture in the same task.

## Implemented P0 changes

1. The BRACKET key-pattern recognizer was constrained to identifier-shaped keys, added a left boundary, and capped the key length. This prevents long base64/token-like runs from causing quadratic no-match backtracking while retaining array/object access shapes such as `arr[0]`, `obj["key"]`, and `data[i]`.
2. PII regexes received digit/character boundaries. The historical investigation found that the dominant `scanPii` cost was the greedy EMAIL local-part pattern rather than the numeric candidates; the EMAIL pattern was bounded with a lookbehind as part of the P0 fix.
3. JSON masking behavior and the binary-payload exemption remained unchanged. Data URIs and long pure base64 values under the intended `data` key must continue to pass through without text masking.

The recorded BRACKET pattern was `/(?<![A-Za-z0-9_.-])([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*\[\s*["']?([^"'\]]+)["']?\s*\]/g`. The recorded PII change added lookbehind boundaries, including `(?<![A-Za-z0-9._%+-])` before the EMAIL local part. These exact patterns are historical evidence and require revalidation before the task can be completed.

Recorded measurements were `scanContextKey` 2526 ms → 32.4 ms, `scanPii` 1062 ms → 5.9 ms, and `maskJsonBody` 4272 ms → 79.2 ms on the unavailable real fixture; the recorded full-suite result was 359 passing tests.

## Deliberate exclusions

- Object-level JSON scan consolidation was not implemented after follow-up measurement showed limited local benefit and meaningful sibling-context compatibility risk.
- ID-card scanning was not changed from global coverage; narrowing it to windows would be a policy change.
- `applyMasks` interval/span replacement was not included in this child. It remains a separate performance task for finding-heavy synthetic workloads.
- The externally reviewed structured-unit/span pipeline is tracked separately and is not part of the P0 result.

## Compatibility contracts

- Preserve global PHONE/ID_CARD/BANK_CARD behavior and anchored EMAIL/secret/context-key behavior.
- Preserve sibling/path context association without inserting synthetic context into forwarded JSON.
- Preserve block-original-body behavior and mask-summary/replacement-count semantics.
- Preserve binary image/base64 exemptions.

## Evidence boundary

The 79.2 ms, 32.4 ms, 5.9 ms, and 359-test figures are historical task evidence. The missing real fixture and the separate zero-finding follow-up mean these figures are not newly verified by this artifact repair and do not prove production latency resolution.
