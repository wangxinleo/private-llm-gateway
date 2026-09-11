# Supplemental Secret Rule Catalog Research

## Sources consulted

- Gitleaks default rules: https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
- detect-secrets README/plugins/keyword detector: https://github.com/Yelp/detect-secrets
- GitHub supported secret scanning patterns: https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns
- Semgrep Secrets generic secrets / validators: https://semgrep.dev/docs/semgrep-secrets/generic-secrets and https://semgrep.dev/docs/semgrep-secrets/validators
- Trivy secret scanner docs and builtin rules: https://github.com/aquasecurity/trivy/blob/main/docs/guide/scanner/secret.md and https://github.com/aquasecurity/trivy/blob/main/pkg/fanal/secret/builtin-rules.go
- GitGuardian generic high entropy detector docs: https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/generics/base64_generic_high_entropy_secret
- OWASP Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

## Current project coverage observed

`src/scanner/secrets.ts` currently covers:

- Private key PEM blocks
- Bearer / Basic auth headers
- JWT
- Cookie / Set-Cookie headers
- A narrow DB URI pattern for postgres/mysql/mongodb/redis with username/password
- AWS access key ID only (`AKIA`/`ASIA`), not the paired secret access key
- GitHub `ghp_` / `github_pat_`
- Slack `xoxb` / `xoxp`
- Google API key `AIza...`
- Base64-ish `eyJ...` token
- Stripe `sk_live` / `sk_test`
- SendGrid `SG...`

`src/scanner/context-key.ts` covers a small set of contextual key names, but misses endpoint keys and many provider/config variants.

## High-risk gaps likely to leak today

### 1. AI provider keys

This proxy is an LLM gateway, so AI-provider credentials are priority. Add strong prefix rules for:

- OpenAI: `sk-...`, including modern `sk-proj-`, `sk-svcacct-`, `sk-admin-` variants referenced by Gitleaks.
- Anthropic: `sk-ant-...`, including admin/session variants where identifiable.
- Hugging Face: `hf_...` tokens.
- Cohere, Replicate, Mistral, Together, Groq, Perplexity, DeepSeek, OpenRouter, Azure OpenAI endpoint+key pairs where feasible.
- Gemini/Google AI Studio usually overlaps `AIza...`, already covered, but should be tested in contextual JSON and raw config.

### 2. Provider-specific developer tokens

Mature scanners include many provider-specific tokens. A targeted first wave should include common developer/cloud tokens:

- GitHub: expand beyond `ghp_` / `github_pat_` to `gho_`, `ghu_`, `ghs_`, `ghr_`, GitHub app/refresh tokens.
- GitLab: `glpat-...`, runner/trigger/deploy tokens where stable.
- npm: `npm_...` and `.npmrc` `_authToken` contextual detection.
- PyPI: `pypi-...` upload tokens.
- Cloudflare: API token/key forms and tunnel tokens.
- Vercel, Netlify, Linear, Sentry auth tokens, Datadog, DigitalOcean, Heroku, Twilio, Discord, Telegram, Slack webhook URLs.

### 3. Cloud credential pairs and JSON service-account objects

Current AWS detection only masks access key IDs, but the damaging secret is usually paired nearby.

Add pair-aware detectors for:

- AWS `aws_access_key_id` + `aws_secret_access_key` + optional `aws_session_token`.
- Azure `client_id` + `client_secret` + `tenant_id`, storage account keys / connection strings.
- GCP service account JSON (`"type": "service_account"`, `private_key`, `client_email`, `project_id`). Existing private-key masking may mask the key block, but should also mask surrounding credential fields when sent as JSON.
- Alibaba/Tencent/Huawei cloud access key ID + secret pairs if used by target users.

### 4. Endpoint + credential co-occurrence

Reported leak is exactly this class.

Add a generic compound-config detector for same object/text window containing:

- endpoint-like keys: `baseUrl`, `apiUrl`, `endpoint`, `host`, `server`, `proxy`, `url`, typo `bashUrl`.
- secret-like keys: `apiKey`, `token`, `secret`, `password`, `clientSecret`, `accessKey`, `authorization`.
- optional identity keys: `username`, `accountId`, `tenantId`, `projectId`, `clientId`.

When endpoint + secret co-occur, mask endpoint and secret. When identity + secret co-occur, mask identity too, preserving existing behavior.

### 5. Connection strings beyond current DB URI

Current DB URI only catches four schemes and requires username:password@host.

Add support for:

- URL credentials generally: `scheme://user:pass@host` for http(s), ftp, amqp, rabbitmq, kafka, elasticsearch/opensearch, clickhouse, sqlserver, mssql, oracle, snowflake, neo4j.
- JDBC URLs with `user=` / `password=` parameters.
- Azure Storage / Redis / RabbitMQ / Mongo SRV connection strings with credential query params.
- `DATABASE_URL`, `REDIS_URL`, `MONGODB_URI`, `SUPABASE_SERVICE_ROLE_KEY` contextual keys.

### 6. Auth material in client/tool configuration files

Add contextual rules for common config snippets that users may paste into LLMs:

- `.env`: `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_URL` when paired with secret keys.
- `.npmrc`: `_authToken`, `_auth`, username/password.
- `.pypirc` / pip.conf: username/password/token.
- `.netrc`: `machine ... login ... password ...`.
- Docker config JSON: `auths`, `auth`, `identitytoken`.
- kubeconfig: `client-key-data`, `token`, `username/password`, certificate/key data.
- Terraform/provider configs: access keys, tokens, credentials file fields.
- cURL snippets: `-H 'Authorization: ...'`, `-u user:pass`, `--user`, `--proxy-user` (Gitleaks/Trivy both include curl auth rules).

### 7. Encoded or wrapped secrets

Mature scanners include high-entropy and base64-aware detectors.

Possible staged support:

- Decode base64-looking values only when assigned to sensitive keys or when decoded text contains sensitive key names (`api_key`, `token`, `authorization`, `secret`). Do not decode all text globally for performance/false-positive reasons.
- Preserve JWT detection and add base64-encoded JWT detection if needed.
- Add generic high-entropy token detector only under sensitive keys, not arbitrary prose.

### 8. Allowlist / false-positive controls

All mature tools include allowlists or exclusions. Keep and expand project controls:

- Existing `scanner_exclusions` should remain effective.
- Add negative tests for placeholders (`YOUR_API_KEY`, `sk-...`, `example`, `${TOKEN}`, `process.env.X`) so docs/templates are not over-masked unless user chooses strict mode.
- Consider a future scanner mode: `balanced` (default) vs `strict` (mask placeholders/examples too).

## Recommended staged implementation

### Stage A — immediate critical fix

- Structured contextual detector.
- Case/separator-insensitive keys.
- Endpoint + secret co-occurrence.
- URL-safe endpoint values.
- Tests for `apiKey/baseUrl/bashUrl` leak.

### Stage B — LLM gateway provider pack

- OpenAI, Anthropic, HuggingFace, Cohere, Replicate, Mistral/Together/Groq/DeepSeek/OpenRouter if stable patterns are available.
- Azure OpenAI endpoint + api-key compound detection.
- Expand GitHub/GitLab/npm/PyPI developer tokens.

### Stage C — compound credentials and config files

- AWS/Azure/GCP service-account and credential-pair detection.
- Docker/kubeconfig/npmrc/pypirc/netrc/curl auth snippets.
- Broader connection-string detection.

### Stage D — generic/encoded detector

- Sensitive-key-gated high entropy.
- Sensitive-key-gated base64 decode and rescan.
- Optional strict/balanced scanner mode.

## Important safety decision

Do not implement live verification in this gateway. Several scanners support verification, but this proxy must not call user endpoints or validate user credentials because that creates privacy, legal, and operational risk.
