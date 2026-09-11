# Rule Expansion Backlog

This backlog preserves the broader research without expanding the immediate Stage A implementation. Details and sources are in `research/supplemental-secret-rule-catalog.md`.

## Stage A — Immediate Critical Fix (current task)

Goal: stop confirmed config leaks involving credentials plus endpoints.

Deliverables:

- Structured contextual key/value detector.
- Case/separator-insensitive key normalization.
- `secret`, `endpoint`, and `identity` key groups.
- Endpoint + secret co-occurrence calibration.
- URL/host-safe endpoint value validation.
- Regression tests for `apiKey`, `baseUrl`, `bashUrl`, mixed-case/separator variants, nested JSON, raw config text, and negative arbitrary URL prose.

## Stage B — LLM Gateway Provider Pack

Goal: cover the highest-risk token classes for an LLM gateway.

Candidate rules:

- OpenAI `sk-...`, including modern `sk-proj-`, `sk-svcacct-`, and `sk-admin-` formats where stable.
- Anthropic `sk-ant-...`.
- Hugging Face `hf_...`.
- Gemini / Google AI Studio validation coverage for `AIza...` in JSON/raw config.
- Cohere, Replicate, Mistral, Together, Groq, Perplexity, DeepSeek, OpenRouter if stable public patterns are available.
- Azure OpenAI endpoint + key compound detection.
- Tests for provider prefixes and config key/value variants.

## Stage C — Developer, Cloud, and Config-file Credential Pack

Goal: cover common pasted configuration files and cloud credential pairs.

Candidate rules:

- GitHub: `gho_`, `ghu_`, `ghs_`, `ghr_`, plus current `ghp_` and `github_pat_`.
- GitLab: `glpat-...` and stable token variants.
- npm: `npm_...`, `.npmrc` `_authToken`, `_auth`.
- PyPI: `pypi-...`, `.pypirc` / `pip.conf` username/password/token fields.
- AWS: `aws_access_key_id` + `aws_secret_access_key` + optional `aws_session_token` pair-aware masking.
- Azure: `client_id` + `client_secret` + `tenant_id`, storage connection strings.
- GCP: service account JSON fields, including `type=service_account`, `private_key`, `client_email`, `project_id`.
- Docker config JSON: `auths`, `auth`, `identitytoken`.
- kubeconfig: `client-key-data`, `token`, username/password.
- `.netrc`: `machine ... login ... password ...`.
- cURL auth snippets: authorization headers, `-u`, `--user`, `--proxy-user`.
- Broader connection strings: URL credentials, JDBC user/password params, Redis/Mongo/Supabase service role keys.

## Stage D — Generic / Encoded Detector Pack

Goal: catch generic or encoded secrets while controlling false positives.

Candidate rules:

- Sensitive-key-gated high entropy detection.
- Sensitive-key-gated base64 decode and rescan when decoded text contains secret-like keys.
- Base64-encoded JWT detection if needed.
- Strict/balanced scanner mode:
  - `balanced`: avoid masking obvious placeholders/examples.
  - `strict`: mask more aggressively.
- More robust allowlist/negative test fixtures for placeholders such as `YOUR_API_KEY`, `${TOKEN}`, `process.env.X`, and docs examples.

## Safety Decision

Do not add live secret verification to this proxy. The scanner must not call user endpoints, test user API keys, or make third-party validation requests with leaked credentials.


## Implementation Status

Stage B/C/D were approved by the user and implemented in this task. The backlog now serves as the trace of what was covered; future work should add only newly discovered provider patterns or stricter validators that are not already represented by the expanded tests. Live verification remains explicitly out of scope.
