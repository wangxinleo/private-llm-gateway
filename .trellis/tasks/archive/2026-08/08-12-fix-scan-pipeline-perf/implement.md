# Historical implementation record and revalidation plan

## Historical implementation record

- Recorded implementation commit: `6cd2bcc9aae00b3b9371abe99c88391d6e0effd5` (`fix(scanner): 修复正则灾难回溯,1.18MB 大请求扫描 18.5s→79ms`). The full identity was confirmed during the current reconciliation.
- Recorded benchmark table: `scanContextKey` 2526 ms → 32.4 ms; `scanPii` 1062 ms → 5.9 ms; `maskJsonBody` 4272 ms → 79.2 ms.
- Recorded regression coverage: BRACKET base64/ANSI/Markdown no-match stress, EMAIL backtracking stress, PII boundary cases, and JSON bracket-key semantics.
- Recorded test result: 359 tests passed. This is not rerun evidence from the artifact-repair session.

## Current revalidation evidence (2026-08-17)

| Check | Current result |
|---|---|
| `npm test` | Passed: 30 files passed and 1 skipped; 358 tests passed and 1 skipped. |
| `npx tsc --noEmit` | Passed. |
| `npm run build` | Passed. |
| `benchmarks/apply-masks-scaling.test.ts` | Passed, while the 40,000-finding baseline remained about 5591.4 ms. This does not resolve the excluded P3 span/`applyMasks` work. |
| `benchmarks/scan-latency-real.test.ts` | Skipped because `真实请求.md` is absent; no current real-payload latency result is available. |

The historical 79.2 ms and 359-test figures remain historical only; the current run produced the separate counts above. The prior five-way review was inconclusive and is not treated as a passing review. Production latency remains unproven.

This child remains limited to the P0 regex/PII boundary work. P1 duplicate JSON scanning, P2 ID-card scope narrowing, and P3 span/`applyMasks` work are excluded; the architecture child remains separate.

## Revalidation checklist

1. Confirm the recorded commit and inspect its diff against the child PRD/design.
2. Run focused context-key and PII regression tests, including the no-match stress cases.
3. Run the full test suite and record the actual count and skipped tests.
4. Run the apply-masks scaling benchmark; do not treat the existing 40k-finding baseline as resolved by the P0 fix.
5. Run `npx tsc --noEmit` and `npm run build`.
6. Run the real-payload benchmark only when `真实请求.md` is deliberately supplied. If absent, record the expected skip and do not claim a real-payload latency result.
7. Check that forwarded JSON contains only original fields and masked original values, and that binary payload exemptions remain byte-for-byte unchanged.

## Rollback and containment

- If focused tests, the full suite, type-check, build, or benchmark expose a regression, stop the lifecycle transition and leave the acceptance items unchecked.
- Do not overwrite the recorded historical result. Preserve the failing output in the task research directory and open a targeted follow-up change rather than editing the evidence to make it pass.
- If a local source change is required during revalidation, keep it isolated from this artifact repair and revert only that unverified source change before reporting the task state.
- Do not archive the child during artifact reconciliation. Record the verified commit link, but leave lifecycle fields unchanged; the separately authorized archive command owns the transition.

## Completion gate

The child is prepared for a separately authorized lifecycle archive because the available quality evidence, unresolved acceptance limitation, and verified commit are now recorded truthfully. This reconciliation does not run that command: `task.json.status` remains `in_progress`, `completedAt` remains `null`, and the unchecked real-payload item is not waived. The new architecture work belongs to the separate planning child.

## Regression rule

Any future scanner performance change must add a failing regression or benchmark assertion before changing production code, then retain the relevant semantic parity tests for global PII, contextual windows, nested JSON, block behavior, and binary payloads.
