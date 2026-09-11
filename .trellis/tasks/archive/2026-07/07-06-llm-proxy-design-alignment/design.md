# Design: Align LLM Privacy Proxy Behavior

## Scope

This task aligns implementation and documentation for the LLM-focused gateway MVP. The proxy should optimize for OpenAI-compatible / Anthropic-compatible JSON requests and SSE responses, while avoiding broad general-purpose reverse-proxy work.

## Architecture and Boundaries

### Route adapter

`src/app/api/[[...path]]/route.ts` remains the HTTP adapter and orchestration layer. Changes should be targeted:

- Preserve path + query for upstream forwarding.
- Ensure runtime scanner config is initialized before any scan or bypass decision that depends on mutable config.
- Keep multipart behavior as-is unless a small compatibility fix is required.

### Proxy forwarding

`src/proxy/forwarder.ts` should receive an upstream path that already includes query string or should accept enough information to construct the full upstream URL safely. The selected approach should preserve existing tests and avoid introducing a general URL router.

### Runtime config

`src/config-loader.ts` currently initializes DB-backed mutable config only when admin config is loaded. The proxy path should call the same initialization path lazily before scanner decisions. The initialization function is already idempotent, so the adapter can call it per request without repeated DB writes in the steady state.

### JSON scanning with context

`src/scanner/json-mask.ts` should preserve key/path context when scanning string values. The least invasive approach is to build a small context-aware scan string for each JSON string, such as `key=value` or `path=value`, while still replacing only the original value in the JSON structure.

Important constraints:

- Do not leak artificial context into the forwarded payload.
- Preserve existing masking behavior for plain strings and arrays.
- Avoid `any`, non-null assertions, or broad type assertions.
- Keep context matching compatible with `scanContextKey()` patterns in `src/scanner/context-key.ts`.

### Secret action policy

Default policy for LLM payloads is mask-and-forward. Therefore:

- Do not add high-risk secret categories to `BLOCK_CATEGORIES` by default.
- Keep `SENSITIVE_FILENAME` as a hard block.
- Update README/docs wording from “secret block” to “secret mask-and-forward” for text/JSON LLM payloads.
- Tests should confirm secret-like JSON/text values are masked and forwarded, not blocked.

## Data Flow

1. Route handler receives `/api/...` request.
2. Route extracts upstream path including query string.
3. Route initializes DB-backed runtime config through `initializeConfigs()` before scanner/bypass decisions.
4. Route extracts body for scan when needed.
5. JSON bodies are scanned recursively with key/path context for string values.
6. Findings are audited; raw matched values remain in SQLite per existing private-deployment contract.
7. Block only for sensitive filename/hard-block cases.
8. Masked body gets privacy disambiguation notice when applicable.
9. Upstream response is returned normally or streamed through SSE passthrough.

## Compatibility Notes

- Query preservation improves LLM provider compatibility and should not harm current paths.
- Lazy config initialization may create DB config rows on the first proxy request; this matches the current admin config behavior but removes the implicit “visit settings first” dependency.
- JSON context scanning may increase detections for fields that were previously missed, especially key-named secrets.
- Multipart is intentionally not redesigned in this task.

## Rollback / Risk

- Query preservation risk: malformed URL concatenation. Mitigate with focused route/forwarder tests.
- Config initialization risk: DB open/write on first proxy request. Mitigate through idempotent existing loader and tests.
- JSON context risk: over-masking values because context strings are synthetic. Mitigate with targeted tests and by only using the immediate key/path for context detection.
- Documentation risk: README must match actual policy to avoid future “fixing” back to block by mistake.


## Future Consideration: General Gateway Capability

General-purpose gateway capability can have product value if the project evolves into a broader privacy/security proxy for many upstream APIs. It is intentionally out of scope for this task because the current product fit is strongest for LLM JSON/SSE workflows, and general gateway completeness would add complexity in HTTP semantics, uploads, auth, caching, retries, protocol edge cases, and operational support. Revisit only if there is a concrete non-LLM user workflow or customer requirement.
