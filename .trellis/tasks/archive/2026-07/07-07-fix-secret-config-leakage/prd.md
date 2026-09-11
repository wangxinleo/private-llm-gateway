# Fix secret configuration leakage

## Goal

Prevent sensitive configuration payloads from being forwarded with unmasked API keys, upstream access endpoints, and nearby credential context. The immediate confirmed leak is a config object such as `apiKey` plus `baseUrl` / `bashUrl`, which exposes both credential material and the service endpoint needed to use it.

## Severity

P1 security bug. The task remains in planning until the Stage A design is reviewed, but implementation should be treated as urgent once approved.

## Background / Evidence

- User reported a severe leak: `bashUrl` / `baseUrl`, `apiKey`, and similar secret configuration fields were not blocked or filtered, causing configuration files to be forwarded with API keys and access endpoints exposed.
- `src/scanner/context-key.ts` already masks contextual secret values for a limited set of known key names (`api_key`, `apikey`, `secret`, tokens, passwords, etc.).
- The current contextual scanner does not include endpoint-oriented config keys such as `baseUrl`, `base_url`, `baseurl`, `apiBaseUrl`, `endpoint`, or the reported typo `bashUrl`.
- Current key handling is not robust enough for case/separator variants such as `APIKEY`, `ApiKey`, `api-key`, `BASEURL`, or `base_url`.
- `src/config.ts` currently restricts contextual values to `^[A-Za-z0-9._=-]+$`, which prevents normal URL values containing `:`, `/`, `?`, `&`, `%`, or `#` from matching even when their key should be sensitive.
- `src/scanner/json-mask.ts` uses synthetic `key=value` context for JSON string values and then masks only the original value, so contextual endpoint detection can preserve JSON structure if findings contain only original values.

## Research Summary

Research artifacts are stored under `research/`:

- `research/secret-scanning-approach.md` — design approach derived from mature scanners.
- `research/supplemental-secret-rule-catalog.md` — broader rule-gap catalog and staged backlog.
- `research/rule-catalog/` — raw fetched/search evidence from Gitleaks, detect-secrets, GitHub, Semgrep, Trivy, and related sources.

Sources consulted:

- GitHub Secret Scanning custom patterns and supported patterns.
- Gitleaks default rules.
- Yelp detect-secrets plugins and keyword detector.
- Semgrep Secrets generic detection and validators.
- Trivy secret scanner configuration and built-in rules.
- GitGuardian generic high-entropy detector docs.
- OWASP Secrets Management Cheat Sheet.

Key research conclusions:

- Mature scanners avoid one giant regex. They combine key/keyword prefilters, structured value extraction, value validators, optional entropy, allowlists/exclusions, and dry-run/test review.
- Multi-factor secrets are common: credentials often appear near endpoints, identities, tenants, usernames, or project IDs. The user’s requested `apiKey + baseUrl` joint calibration matches this pattern.
- Live verification is intentionally out of scope for this gateway. The proxy must not call leaked endpoints or validate user credentials.
- The current scanner likely has broader gaps beyond the confirmed leak, especially AI-provider keys, developer tokens, cloud credential pairs, auth config snippets, broader connection strings, and encoded sensitive-key values. These are documented as staged follow-up work, not automatically part of the immediate fix.

## Scope Decision

Implement **Stage A — immediate critical fix** in this task:

- Structured contextual key/value detector.
- Case-insensitive and separator-insensitive key normalization.
- Secret key group, endpoint key group, and existing identity key group.
- Endpoint + secret co-occurrence calibration.
- URL/host-safe endpoint value validation.
- Regression tests for confirmed leak patterns and negative prose URL behavior.

Do **not** expand this implementation to the full rule catalog unless the user explicitly approves a scope expansion. Stage B/C/D are captured in `rule-expansion-backlog.md`.

## Requirements

- R1: Match sensitive config key names case-insensitively and separator-insensitively, so variants such as `apiKey`, `api_key`, `api-key`, `apikey`, `APIKEY`, `ApiKey`, `baseUrl`, `base_url`, `base-url`, `baseurl`, and `BASEURL` are treated consistently.
- R2: Mask values under secret key variants including camelCase `apiKey` and existing snake/lower variants.
- R3: Mask values under access endpoint configuration key variants, including at minimum `baseUrl`, `base_url`, `baseurl`, `apiBaseUrl`, `api_base_url`, `apibaseurl`, `endpoint`, `apiEndpoint`, `api_endpoint`, `apiendpoint`, `url`, `apiUrl`, `api_url`, `apiurl`, `serverUrl`, `server_url`, `serverurl`, `host`, and the reported `bashUrl` / `bash_url` typo.
- R4: When API-key-like and base-url/endpoint-like keys appear in the same JSON object, config payload, or nearby raw text window, treat that co-occurrence as a high-confidence configuration-secret leak and mask both values.
- R5: Existing identity-like keys (`username`, `account`, `tenantId`, `projectId`, `clientId`, session/account identifiers) may be masked when they co-occur with a secret key, preserving the existing pair-trigger behavior.
- R6: Contextual URL endpoint values must be scannable when they include common URL characters (`:`, `/`, `?`, `&`, `%`, `#`, `-`, `_`, `.`, `=`, `+`, `@`, `~`).
- R7: Endpoint masking must remain contextual. Arbitrary URLs in normal prose must not be masked unless assigned to endpoint-like config keys or co-occurring with secret-like keys as part of a config leak.
- R8: Masking must preserve JSON validity and only replace sensitive string values, not inject synthetic `key=value` context into forwarded bodies.
- R9: Existing exclusions, PII scanning, strong secret scanning, filename blocking, audit metadata, and mask-tag behavior must remain compatible.
- R10: Add regression tests that fail before the fix and cover JSON objects, nested JSON paths, raw config snippets, mixed-case keys, the `bashUrl` typo, co-occurrence calibration, and negative arbitrary URL prose.
- R11: Preserve the broader rule-catalog research as follow-up guidance for provider tokens, cloud credential pairs, config-file snippets, connection strings, and encoded secrets without expanding this critical fix beyond Stage A unless approved.

## Out of Scope for Stage A

- Adding encryption or secure storage for server-side environment variables.
- Changing upstream proxy routing, audit storage schema, or dashboard UI.
- Blocking all URLs in arbitrary prose.
- Live verification of secrets by calling external services.
- Full provider-specific rule packs for OpenAI/Anthropic/Hugging Face/GitHub/GitLab/npm/PyPI/etc.; these are Stage B.
- Full cloud/config-file credential packs for AWS/Azure/GCP/Docker/kubeconfig/npmrc/pypirc/netrc/curl; these are Stage C.
- Generic entropy or base64 decode scanning; these are Stage D.

## Acceptance Criteria

- [ ] A JSON body containing mixed-case `apiKey` and `baseUrl` is returned with both values replaced by `<<PRIVACY_MASK:CONTEXTUAL_SECRET>>` and no raw credential or endpoint remains.
- [ ] Key matching is case/separator-insensitive for secret and endpoint variants such as `APIKEY`, `ApiKey`, `api-key`, `BASEURL`, `BaseUrl`, and `base_url`.
- [ ] A JSON body containing reported typo `bashUrl` is masked when it carries an endpoint-like value.
- [ ] A payload where an API-key-like key and base-url-like key co-occur masks both values as a high-confidence config leak.
- [ ] Raw config text containing endpoint keys and API-key keys is masked by the pipeline.
- [ ] Nested JSON config paths such as `providers.openai.apiKey` and `providers.openai.baseUrl` mask only the sensitive string values and remain valid JSON.
- [ ] Identity-like fields remain compatible with existing pair-trigger behavior when paired with a secret key.
- [ ] Normal prose containing an arbitrary URL, without endpoint-like key assignment and without secret co-occurrence, is allowed unchanged.
- [ ] Existing scanner exclusions continue to apply.
- [ ] Relevant focused tests pass, then full suite passes or any unrelated failure is documented before proceeding.

## Scope Expansion Approval — Stage B/C/D

The user explicitly approved completing the remaining goals after Stage A. This supersedes the earlier Stage A-only implementation boundary for this task while preserving the same safety decision: no live credential verification and no external calls with user secrets.

Additional in-scope requirements:

- R12: Add LLM gateway provider coverage for stable high-signal token prefixes, including OpenAI-style `sk-...` variants, Anthropic `sk-ant-...`, Hugging Face `hf_...`, OpenRouter, Groq, Replicate, and Perplexity patterns where locally detectable.
- R13: Expand developer token coverage for GitHub token prefixes beyond `ghp_`, GitLab personal/runner/agent token prefixes, npm tokens, PyPI tokens, and common deployment-service token prefixes where stable.
- R14: Add cloud/config-file credential coverage for AWS secret/session keys, Azure client-secret/tenant/client compound configs, Azure storage connection strings, GCP service-account metadata, Docker auth JSON, kubeconfig tokens/client-key data, `.netrc`, and cURL `--user` / `--proxy-user` snippets.
- R15: Add broader credentialed connection-string masking for non-DB URL credentials and JDBC/user-password parameter forms while preserving the existing `DB_URI` category for existing DB URI coverage.
- R16: Add sensitive-key-gated generic detection for high-entropy values while avoiding obvious placeholders/examples in balanced mode.
- R17: Add sensitive-key-gated base64 decoding for encoded config blobs and mask the encoded blob when decoded content contains secret-like keys or known credential shapes.
- R18: Keep all new detections mask-only; `SENSITIVE_FILENAME` remains the only blocking category.

Additional acceptance criteria:

- [x] Provider prefix tests cover OpenAI-style, Anthropic, Hugging Face, OpenRouter, Groq, Replicate, and Perplexity tokens.
- [x] Developer token tests cover expanded GitHub prefixes plus GitLab, npm, PyPI, and deployment-service token examples.
- [x] Cloud/config tests cover AWS secret/session keys, Azure identity co-occurrence, GCP service-account metadata, Docker auth/identitytoken, kube token, `.netrc`, and cURL credential snippets.
- [x] Connection-string tests cover non-DB URL credentials and JDBC user/password parameters.
- [x] Generic/encoded tests cover high-entropy sensitive-key values, balanced-mode placeholder rejection, and base64 encoded sensitive config masking.
- [x] JSON tests prove sibling fields in the same object can calibrate identity masking while preserving valid JSON.
