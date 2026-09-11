# Implementation Plan

## Checklist

1. Load implementation guidelines with `trellis-before-dev` before editing code.
2. Preserve query strings (P0 LLM compatibility):
   - Update proxy path extraction or forwarder contract to include `url.search`.
   - Add/adjust tests for an LLM-style path with query parameters.
3. Initialize runtime config on proxy path (P0 runtime correctness):
   - Import and call `initializeConfigs()` before scanner/bypass decisions in the proxy route.
   - Add a regression test showing proxy scanning uses DB-backed/default scanner exclusions without requiring admin config GET first.
4. Add JSON key/path-aware scanning (P0 privacy detection quality):
   - Extend `maskJsonBody()` recursion to pass key/path context into string scans.
   - Keep replacements limited to original string values.
   - Add tests for nested JSON fields such as `api_key`, `authorization`, and/or `secret`.
5. Align secret policy docs/tests (P0 policy consistency):
   - Keep default high-risk secrets as mask-and-forward.
   - Keep sensitive filenames blocked.
   - Update README wording to reflect LLM-focused mask-and-forward policy.
   - Add/adjust tests if current tests do not explicitly lock this policy.
6. Run validation:
   - `npm test`
   - `npm run build`
7. Review git diff for targeted scope only; do not include broad frontend refactors or multipart streaming redesign.

## Validation Commands

```bash
npm test
npm run build
```

## Risky Files / Rollback Points

- `src/app/api/[[...path]]/route.ts`: route orchestration; rollback if forwarding or body handling regresses.
- `src/proxy/forwarder.ts`: upstream URL construction; rollback if query handling breaks existing paths.
- `src/scanner/json-mask.ts`: recursive scan/mask behavior; rollback if JSON output shape changes unexpectedly.
- `src/config-loader.ts` or imports into route: rollback if DB initialization creates test isolation issues.
- `README.md`: documentation must stay aligned with code policy.

## Non-Goals During Implementation

- Do not build a full transparent reverse proxy.
- Do not rewrite multipart parsing into a streaming parser.
- Do not refactor large frontend admin components.
- Do not introduce new dependencies unless absolutely necessary.

## Deferred Work

- Full general-purpose gateway feature completeness.
- Streaming multipart redesign or large-file optimization.
- Retry/cache/circuit-breaker/WebSocket/gRPC support.
- Broad admin UI refactors or enterprise auth redesign.
