# Design: Fix secret configuration leakage

## Boundary

The immediate fix belongs in the scanner layer:

- Primary: `src/scanner/context-key.ts`
- Supporting config if still needed: `src/config.ts`
- Existing JSON masking path: `src/scanner/json-mask.ts`
- Tests: `src/__tests__/context-key.test.ts`, `src/__tests__/json-mask.test.ts`, and/or `src/__tests__/pipeline.test.ts`

No proxy routing, audit schema, dashboard UI, or upstream forwarding changes are intended for Stage A.

## Data Flow

1. Request body reaches route/proxy scanning.
2. For JSON bodies, `maskJsonBody` parses JSON and scans each string value as synthetic context text (`key=value` and full path variants).
3. For raw text/config snippets, `runPipeline` scans the entire text through `scanContextKey`.
4. `scanContextKey` emits `CONTEXTUAL_SECRET` mask findings for original values.
5. Existing mask application replaces the original matched values with the contextual mask tag before forwarding.

## Research-backed Technical Approach

Research summary is saved in `research/secret-scanning-approach.md` and broader backlog in `research/supplemental-secret-rule-catalog.md`. The implementation should follow mature scanner patterns from GitHub Secret Scanning, Gitleaks, detect-secrets, Trivy, Semgrep, GitGuardian, and OWASP:

- structured context rather than one giant regex;
- key/keyword prefilters;
- value validators by candidate type;
- allowlist/exclusion support;
- tests as local dry-run review;
- no live secret verification in this proxy.

## Detector Model

Replace ad-hoc contextual matching with a small structured detector over key/value candidates.

### Candidate extraction

Extract key/value candidates from raw text and synthetic JSON context. Existing patterns already cover common `key=value`, JSON-like `key: value`, dictionary access, XML-like tags, and dot access. The refactor should make this output explicit enough to classify key groups and apply co-occurrence rules.

### Key normalization

Normalize keys before classification:

- lowercase;
- remove `_`, `-`, `.`, and whitespace separators;
- preserve enough path context to support full-path JSON synthetic context when useful;
- treat camelCase naturally after lowercasing (`apiKey` -> `apikey`, `baseUrl` -> `baseurl`).

Examples:

- `apiKey`, `api_key`, `api-key`, `APIKEY` -> `apikey`
- `baseUrl`, `base_url`, `base-url`, `BASEURL` -> `baseurl`
- `providers.openai.apiKey` should make the terminal key and path available for classification.

### Key groups

- `secret`: API keys, tokens, passwords, credentials, private keys, client secrets, access keys, authorization fields.
- `endpoint`: base URLs, API URLs, endpoints, hosts, servers, proxy URLs, service URLs, typo `bashUrl`.
- `identity`: existing pair-trigger identifiers such as usernames, accounts, tenants, projects, clients, sessions, cookies.

### Value validators

Use different validators by key group:

- Token-like secret values:
  - preserve existing length bounds;
  - reject plain words and all-digit values;
  - allow current token charset;
  - remain compatible with existing contextual secret tests.
- Endpoint-like values:
  - allow URL/host characters (`:`, `/`, `?`, `&`, `%`, `#`, `-`, `_`, `.`, `=`, `+`, `@`, `~`);
  - prefer URL/host/path shape checks over entropy because endpoints are not high-entropy;
  - do not match arbitrary prose URLs without endpoint key context.

### Co-occurrence calibration

- Secret-key candidates mask directly when the token-like value validator passes.
- Endpoint-key candidates mask when the endpoint-like validator passes and the key is endpoint-like.
- If secret and endpoint candidates co-occur in the same JSON object/config payload/raw text scan window, mask both as high-confidence configuration leakage.
- Identity candidates only mask when paired with a secret candidate, preserving existing behavior.

## Compatibility

- Keep finding category as `CONTEXTUAL_SECRET` to avoid expanding audit schemas and mask-tag contracts.
- Keep existing `scanner_exclusions` behavior.
- Keep strong secret scanning (`src/scanner/secrets.ts`) separate from contextual config scanning.
- Keep block category behavior unchanged; this is a mask fix, not a new block rule.
- Existing PII and filename handling must remain unchanged.

## Non-goals / Safety Choices

- Do not implement live verification. Tools such as TruffleHog and detect-secrets can verify secrets through external requests, but this gateway must not call leaked endpoints or test user credentials.
- Do not add broad high-entropy scanning for all strings in this fix. It can be added later, gated by sensitive keys.
- Do not mask every URL globally; endpoint masking must remain context-aware.
- Do not implement the full provider/cloud/config rule catalog in Stage A.

## Follow-up Rule Expansion Backlog

See `rule-expansion-backlog.md` and `research/supplemental-secret-rule-catalog.md` for staged expansion:

1. Stage B — LLM gateway provider pack.
2. Stage C — cloud/developer/config-file credentials.
3. Stage D — sensitive-key-gated entropy/base64 decoding and strict/balanced mode.

## Rollback

Rollback is local to scanner behavior:

- revert `src/scanner/context-key.ts` changes;
- revert any `src/config.ts` character policy change if made;
- revert related tests.

No storage migration or route rollback is expected.
