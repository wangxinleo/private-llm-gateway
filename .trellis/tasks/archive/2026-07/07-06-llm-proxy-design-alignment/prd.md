# Align LLM privacy proxy design

## Goal

Align the gateway around its real product role: a dedicated LLM API privacy proxy. The current phase should fix design mismatches that materially affect LLM request compatibility, privacy masking correctness, or predictable scanner configuration, while avoiding general-purpose gateway scope.

## User Value

LLM users can send prompts, code snippets, logs, and provider JSON payloads through the gateway with sensitive values masked instead of exposed or over-blocked. Common OpenAI-compatible and Anthropic-compatible JSON/SSE flows should work without hidden setup steps such as visiting the admin config page first.

## Confirmed Facts

- The gateway is almost exclusively for LLM traffic; non-LLM gateway completeness can be deprioritized.
- Current architecture is modular:
  - `src/app/api/[[...path]]/route.ts` handles proxy orchestration.
  - `src/scanner/` implements privacy scanning and masking.
  - `src/proxy/` forwards upstream requests and handles SSE streaming.
  - `src/audit/` stores metadata and findings in SQLite.
- Build and tests passed before this task was created: `npm run build`; `npm test`.
- Query strings are currently dropped: `src/app/api/[[...path]]/route.ts:19-21` returns only pathname, and `src/proxy/forwarder.ts:8` forwards `${UPSTREAM_URL}${path}`.
- Runtime DB-backed config is initialized only by admin config GET: `src/app/api/admin/config/route.ts:11-17`; proxy requests can otherwise use default in-memory config.
- JSON masking scans string values without key/path context: `src/scanner/json-mask.ts:16-18`; contextual secret detection in `src/scanner/context-key.ts:75-115` relies on key/value-like patterns.
- README wording says high-risk secrets should be blocked, while code blocks only `SENSITIVE_FILENAME`: `src/types.ts:109-115`; secret scanners mostly emit `action: "mask"`.
- Multipart support uses `request.formData()` in `src/scanner/multipart.ts:12-31`; this is acceptable for the current LLM-focused phase unless a target LLM file workflow requires more.
- Large admin frontend components are maintainability issues but not core LLM proxy correctness issues.

## Decisions

- D1: High-risk secrets in LLM prompts, code snippets, logs, JSON, and text payloads default to **mask-and-forward**, not block.
- D2: Current MVP compatibility targets OpenAI-compatible and Anthropic-compatible JSON request flows plus SSE responses: chat completions, responses, messages, and streaming.
- D3: Existing multipart behavior remains supported at its current metadata-scan level; streaming multipart refactor and large-file optimization are out of scope for this phase.
- D4: General-purpose gateway capability may have future value, but this phase treats it as architecture optionality rather than product scope.

## Current-Phase Priorities

1. **P0 — LLM request compatibility:** preserve query strings when forwarding.
2. **P0 — Runtime correctness:** initialize DB-backed scanner/runtime config on the proxy path before scan, bypass, or threshold decisions.
3. **P0 — Privacy detection quality:** make JSON scanner key/path-aware so LLM payload fields such as `api_key`, `authorization`, `password`, `secret`, and token-like fields are detected reliably.
4. **P0 — Policy consistency:** document and test default mask-and-forward behavior for LLM JSON/text payloads, while keeping sensitive filenames as hard-block.
5. **P1 — Maintain architecture boundaries:** keep the route handler as orchestration only where practical, without broad refactors.
6. **Defer:** full transparent reverse proxy behavior, streaming multipart redesign, retries/caching/circuit breaking, WebSocket/gRPC support, broad admin UI refactors, and enterprise auth redesign.

## Requirements

- R1: Treat the product as an LLM-focused privacy proxy, not a universal reverse proxy.
  - Prioritize OpenAI/Anthropic-style JSON chat/completions/responses/messages requests and SSE streaming.
  - Keep generic HTTP behavior only where it is cheap, already working, or needed for LLM provider compatibility.
- R2: Preserve query strings when forwarding LLM requests.
  - Required because LLM-compatible APIs may use query parameters for provider options, debugging, streaming variants, or admin-like routes.
- R3: Ensure scanner/runtime config is initialized before proxy scanning decisions.
  - Proxy behavior must not depend on first visiting the admin config page.
  - DB-backed config should load predictably while preserving current defaults as fallback.
- R4: Make JSON secret/context scanning fit LLM request bodies.
  - JSON string values should be scanned with key/path context while replacements remain limited to the original JSON string values.
- R5: Use mask-and-forward as the default high-risk secret policy for LLM requests.
  - High-risk secrets in JSON/text LLM payloads should be replaced with privacy mask tags and forwarded with existing disambiguation notice behavior.
  - Blocking remains appropriate for sensitive filenames, unsupported/unsafe upload cases, or categories explicitly configured for hard block later.
  - Code, tests, and README/docs must describe the same policy.
- R6: Keep non-LLM general-proxy improvements out of MVP unless they are low-cost and reduce LLM risk.

## Out of Scope for This Phase

- Full general-purpose HTTP reverse proxy correctness beyond LLM API needs.
- Streaming multipart parser or large upload optimization unless required for a target LLM endpoint.
- Retry, cache, circuit-breaker, WebSocket, gRPC, cookie, redirect, or range-request completeness.
- Large admin frontend component refactors.
- Multi-tenant enterprise auth redesign unless deployment requirements change.

## Acceptance Criteria

- [ ] Forwarded requests preserve query strings; regression tests cover at least one LLM-style API path with query parameters.
- [ ] Proxy scanning initializes DB-backed runtime config before using size thresholds, path prefixes, and scanner exclusions; tests cover proxy behavior without first calling admin config GET.
- [ ] JSON scanning detects contextual secrets using field key/path context; tests cover nested JSON fields such as `api_key`, `authorization`, or `secret`.
- [ ] Secret action policy is documented and tested as default mask-and-forward for LLM JSON/text payloads, with block reserved for sensitive filenames and explicitly hard-blocked cases.
- [ ] Existing validation passes: `npm test` and `npm run build`.
