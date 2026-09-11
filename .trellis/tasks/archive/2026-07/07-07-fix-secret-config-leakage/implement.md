# Implementation Plan

## Scope

Implement Stage A only: critical contextual configuration leakage fix for `apiKey` + `baseUrl` / `bashUrl` and related case/separator variants.

## Pre-implementation

1. Load backend scanner specs with `trellis-before-dev` before editing code.
2. Re-read `prd.md`, `design.md`, `rule-expansion-backlog.md`, and `research/secret-scanning-approach.md`.
3. Confirm task is started with `task.py start` before modifying production code.

## Ordered Checklist

1. Add failing regression tests first:
   - JSON `apiKey` + `baseUrl` masks both values.
   - JSON mixed-case variants such as `APIKEY` + `BASEURL` mask both values.
   - JSON separator variants such as `api-key` / `base_url` mask both values.
   - JSON `bashUrl` endpoint typo masks endpoint value when paired with secret config.
   - Nested JSON path such as `providers.openai.apiKey` + `providers.openai.baseUrl` remains valid JSON and masks only string values.
   - Raw config text containing endpoint keys and API-key keys masks through `runPipeline`.
   - Negative arbitrary prose URL case is allowed unchanged.
   - Existing contextual identity-pair behavior remains covered.
2. Refactor contextual matching around parsed key/value candidates with normalized keys.
3. Implement key normalization: lowercase and strip separators (`_`, `-`, `.`, whitespace) so case/separator variants converge.
4. Classify normalized keys into `secret`, `endpoint`, and existing `identity` groups.
5. Split value validation:
   - token-like secret validator;
   - endpoint-like URL/host validator.
6. Add co-occurrence calibration so API-key-like and base-url/endpoint-like keys in the same payload/window mask both values.
7. Preserve existing exclusion application and finding category/mask tag behavior.
8. Run focused tests.
9. Run full test suite.
10. Review diff for over-broad URL masking and ensure only synthetic test secrets/endpoints are present.

## Validation Commands

```bash
npm test -- --run src/__tests__/context-key.test.ts src/__tests__/json-mask.test.ts src/__tests__/pipeline.test.ts
npm test
```

## Risk / Rollback Points

- `src/scanner/context-key.ts`: false positives from over-broad endpoint keys. Keep endpoint keys explicit and contextual.
- `src/config.ts`: widening allowed characters could increase matches for already-sensitive keys. Prefer local endpoint validator if possible; if config changes are needed, preserve length and key-name gates.
- JSON masking: ensure findings use original values, not synthetic `key=value` strings.
- Tests: use synthetic non-real credentials/endpoints only.

## Definition of Done

- Stage A acceptance criteria in `prd.md` are satisfied.
- Focused scanner tests pass.
- Full test suite passes or unrelated failures are documented.
- Broader rule catalog remains documented as future work and is not accidentally partially implemented.
