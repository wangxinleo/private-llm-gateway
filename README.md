# Private LLM Gateway

Languages: [English](./README.md) | [简体中文](./README.zh-CN.md)

Last reviewed: 2026-07-08

Private LLM Gateway is a fast privacy reverse proxy for LLM API traffic. It scans requests before forwarding them to an upstream LLM-compatible service, masks likely secrets and common PII, blocks obviously sensitive uploaded filenames, and records local SQLite audit metadata.

```text
client -> private-llm-gateway -> upstream service -> LLM provider
```

## What it does

- Proxies `/api/*` traffic to the same path on `UPSTREAM_URL`.
- Supports OpenAI/Anthropic-style JSON requests and SSE streaming responses.
- Scans JSON, plain text, form, and multipart requests before forwarding.
- Masks credential-like values and common PII instead of sending raw values upstream.
- Blocks uploads with sensitive filenames such as private-key and env/config files.
- Stores audit metadata in SQLite and exposes a local admin dashboard.
- Keeps all runtime configuration in environment variables or admin-managed settings.

## What it does not do

- It does not parse uploaded file contents.
- It does not perform OCR, PDF parsing, or Office document parsing.
- It does not use NLP/semantic detection for names or addresses.
- It does not treat every random-looking string as a secret without context.

## Quick start

### 1. Configure the app

```bash
cp .env.template .env
openssl rand -base64 32
```

Edit `.env`:

```dotenv
UPSTREAM_URL=http://localhost:8787
ADMIN_KEY=<paste-generated-admin-key>
```

Never commit `.env` or real credentials.

### 2. Run locally

```bash
npm install
npm run dev
```

The proxy listens on `http://localhost:3000` by default.

### 3. Send traffic through the proxy

Requests under `/api/*` are forwarded to `UPSTREAM_URL` with the `/api` prefix removed.

```bash
curl -s http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"demo-model","messages":[{"role":"user","content":"hello"}]}'
```

With `UPSTREAM_URL=http://localhost:8787`, the example above forwards to:

```text
http://localhost:8787/v1/chat/completions
```

### 4. Open the admin dashboard

Visit:

```text
http://localhost:3000/dashboard
```

Use `ADMIN_KEY` to authenticate. Without `ADMIN_KEY`, dashboard APIs return `503`.

## Docker deployment

The production image is published to GitHub Container Registry:

```text
ghcr.io/wangxinleo/private-llm-gateway:latest
```

Edit `docker-compose.yaml` before starting:

```yaml
environment:
  NODE_ENV: production
  PORT: 3000
  HOSTNAME: 0.0.0.0
  UPSTREAM_URL: http://host.docker.internal:8787
  DB_PATH: /data/audit.sqlite
  ADMIN_KEY: "<strong-admin-key>"
```

Start the service:

```bash
docker compose up -d privacy-proxy
```

Check status and logs:

```bash
docker compose ps
docker compose logs -f privacy-proxy
```

Stop the service:

```bash
docker compose down
```

Audit data is persisted in `./data/audit.sqlite` through the `/data` container mount. To clear audit data:

```bash
docker compose down
rm -rf ./data/audit.sqlite
rm -rf ./data  # clears the whole mounted data directory
```

If the upstream service runs on the Docker host, `http://host.docker.internal:8787` works on Docker Desktop. If the upstream service runs in the same Docker network, use its service name, for example `http://your-upstream-service:8787`.

## Runtime configuration

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `production` in Compose | Node.js runtime environment. |
| `PORT` | `3000` | Next.js listen port. |
| `HOSTNAME` | `0.0.0.0` in Compose | Bind interface inside the container. |
| `UPSTREAM_URL` | `http://localhost:8787` directly / `http://host.docker.internal:8787` in Compose | Upstream base URL. |
| `DB_PATH` | `audit.sqlite` directly / `/data/audit.sqlite` in Compose | SQLite audit database path. |
| `DEBUG` | `false` in production | Enables verbose scan flow logs when `true`. |
| `ADMIN_KEY` | empty | Required for dashboard and reveal-auth access. |
| `PRIVACY_SECRET_SCANNER_MODE` | `balanced` | Set to `strict` to use stricter contextual secret scanning. |
| `PRIVACY_MASK_FORMAT` | `explicit` | Mask token format; `legacy` is available for compatibility. |
| `PRIVACY_DISAMBIGUATION_MODE` | `auto` | Adds privacy-mask guidance for upstream LLMs. Values: `off`, `prefix`, `json-meta`, `auto`. |
| `PRIVACY_NOTICE_TEXT` | built-in notice | Custom notice text for masked-token handling. |
| `PRIVACY_DEBUG_HEADERS` | `false` | Adds debug response headers for masked requests when enabled. |

The admin settings page also manages hot-reloadable scanner settings stored in SQLite: scan size thresholds, chunk size, contextual secret limits, bypass path options, and scanner exclusion rules.

## Privacy behavior

### Supported request bodies

| Content type | Behavior |
| --- | --- |
| `application/json` | Recursively scans string values and forwards masked JSON. |
| `text/plain` | Scans the full text body. |
| `application/x-www-form-urlencoded` | Scans submitted field values. |
| `multipart/form-data` | Scans text fields and checks uploaded file metadata only. |

### Actions

| Action | Meaning |
| --- | --- |
| `allow` | Forward the request unchanged. |
| `mask` | Replace matched values with privacy mask tokens, then forward. |
| `block` | Reject the request with a deterministic JSON error. |

Only sensitive uploaded filenames are currently hard-blocked. Secrets, contextual secrets, connection strings, provider tokens, and PII are masked and forwarded so code-review and debugging workflows can continue without exposing raw values upstream.

### Masked categories

The scanner covers these broad categories:

- Private-key blocks, authorization-token values, JWTs, cookie headers, database URIs, and connection strings.
- Provider/developer/cloud tokens such as OpenAI/Anthropic-style provider keys, GitHub/GitLab/npm/PyPI/Vercel/Linear tokens, AWS access keys, Slack tokens, Google API keys, Stripe keys, SendGrid keys, base64-like tokens, and encoded secrets.
- Contextual secrets where a high-risk key name appears near a suspicious token-like value.
- Common PII: mainland China phone numbers, email addresses, Chinese resident ID numbers, and bank card numbers.

Example mask tokens:

```text
<<PRIVACY_MASK:EMAIL>>
<<PRIVACY_MASK:BEARER_TOKEN>>
<<PRIVACY_MASK:CONTEXTUAL_SECRET>>
```

### Blocked upload metadata

The proxy does not read uploaded file contents. It blocks only by filename or extension:

- Extensions: `.env`, `.pem`, `.key`, `.p12`, `.pfx`, `.npmrc`, `.pypirc`
- Filenames: `id_rsa`, `id_dsa`, `authorized_keys`, `known_hosts`, `credentials.json`, `service-account.json`, `secrets.yaml`, `secrets.yml`, `prod.env`, `config.prod`

Blocked requests return JSON similar to:

```json
{
  "error": "blocked_by_privacy_proxy",
  "blocked_types": ["SENSITIVE_FILENAME"]
}
```

### Size tiers

| Request body size | Scan behavior |
| --- | --- |
| `< 128 KB` | Full scan: secrets, contextual secrets, and PII. |
| `128 KB - 1 MB` | Chunked secret/context scan plus PII scan. |
| `> 1 MB` | Minimal scan: strong secret rules and PII. |

The thresholds and chunk size can be changed from the admin settings page.

## Audit and admin console

The SQLite audit log records request metadata, findings, actions, duration, model when detected, and raw matched values grouped by category. It does not store full prompts or uploaded file contents.

Raw matched values are intentionally not sent through live SSE events or normal logs. Admin audit APIs return them only after reveal-auth succeeds, and the UI displays partially masked values while still allowing authenticated copy actions.

Protect the SQLite file (`./data/audit.sqlite` in Docker deployments) as sensitive local data.

Dashboard areas:

- Overview: recent incidents and summary metrics.
- Audit: searchable audit entries, hit categories, matched-value reveal flow, duration, model, and bypass status.
- Rules: temporary bypass rules for path/model windows.
- Settings: hot-reloadable scanner thresholds, path prefix options, and exclusion rules.

Bypass rules allow matching traffic to continue, but the proxy still scans and audits findings with `bypassApplied: true`.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/app/api/[[...path]]/route.ts` | Reverse proxy entry point for `/api/*`. |
| `src/app/api/admin/*` | Admin APIs for audit, stats, config, reveal auth, and bypass rules. |
| `src/app/dashboard/*` | Admin dashboard pages. |
| `src/scanner/` | Privacy scanning pipeline: secrets, contextual keys, PII, filenames, multipart parsing, and exclusions. |
| `src/proxy/` | Upstream forwarding, SSE streaming, and mask disambiguation. |
| `src/audit/` | SQLite schema, audit persistence, and live audit events. |
| `src/bypass/` | Temporary bypass rule storage and matching. |
| `Dockerfile` | Multi-stage production image using Next.js standalone output. |
| `docker-compose.yaml` | Deployment entry point for the published image. |
| `.env.template` | Direct `npm run dev` / `npm start` configuration template. |
| `doc/` | Additional design notes. |

## Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Build production output:

```bash
npm run build
```

Optional local upstream for manual proxy checks:

```bash
node mock-upstream.mjs
```

Then send requests to `http://localhost:3000/api/...` with `UPSTREAM_URL=http://localhost:8787`.

## Security notes

- Keep `ADMIN_KEY` strong and private.
- Keep `UPSTREAM_URL` explicit per environment; do not hardcode provider credentials in source code.
- Do not expose the dashboard or SQLite data directory publicly without additional network controls.
- Enable `DEBUG=true` only for local troubleshooting. Debug logs can reveal scan flow details.
- Treat `audit.sqlite` as sensitive because matched values are persisted for leak statistics.

## License

MIT. See [LICENSE](./LICENSE).

## Project history

This timeline is based on Git commit history, with Trellis task names added only where they clarify the work. It is an implementation log, not a formal release changelog.

### 2026-06-10

- Initialized `private-llm-gateway` and established the Next.js privacy proxy structure. Git: `ccdc70c`.
- Added automated build workflow for install, tests, and production build. Trellis: `Git automatic build workflow`; Git: `7e58857`.
- Started the Docker image publishing direction that later became `Publish Docker image to GHCR`.

### 2026-06-15

- Unified environment-variable configuration and Docker/Compose workflow to reduce drift between local, container, and production runs. Git: `44569e2`, `5eddc7a`.
- Improved sensitive-data detection configuration and tests, and added debug mode for scan troubleshooting. Git: `253367b`, `fe7e807`.

### 2026-06-16

- Added proxy logs, error handling, debug output, and related documentation/configuration. Git: `310ee42`.
- Added the admin dashboard, navigation structure, and i18n foundation. Git: `5e3cbe4`.

### 2026-06-17

- Upgraded privacy mask token format and added request-level semantic disambiguation to reduce ambiguity and context loss. Git: `1d4465d`.
- Fixed frontend runtime config loading by reading server-side environment values through an API. Git: `694c191`.
- Added admin authentication with `ADMIN_KEY`, root redirect to the dashboard, and admin context initialization. Git: `c445c1a`, `914d5e1`, `b9b0f8a`.
- Polished dashboard text sizing, audit table time-range filtering, and i18n copy. Git: `54a8c71`, `b565f0e`.

### 2026-06-18

- Updated integration tests to use a local HTTP server as upstream, making proxy-forwarding tests more stable. Git: `8d23b7f`.

### 2026-06-23

- Added temporary bypass rules that can skip privacy enforcement during a configured time window. Git: `9753c7c`.
- Implemented hot-reloadable system configuration and started admin UX improvements. Git: `ab5a255`.
- Trellis bypass-rule work in this period: `Make bypass rule path prefix options configurable via admin settings`, `Merge path prefix options in audit log filter with configured path_prefix_options`, and `Optimize temporary bypass rule time and path selection UX`.

### 2026-06-24

- Adjusted path prefix options by removing API version prefixes so filters and rules better match actual upstream paths. Git: `96bfdec`.
- Updated the admin UI with temporary bypass-rule management and improved i18n copy. Git: `ce7e220`.
- Trellis cleanup tasks: `Fix incorrect default path prefix configuration`, `Update all documentation references from scan rules to bypass rules`, `Update nav.rules translation from scan rules to bypass rules`, and `Fix dashboard recent incidents to show both block and mask actions`.

### 2026-06-25

- Added reveal authentication for matched audit values and improved contextual key scanning. Git: `4050aaa`.
- By this point, GHCR publishing, bypass-rule path options, audit filter options, temporary bypass UX, default path configuration, and terminology migration were largely complete.

### 2026-06-26

- Added model tracking to audit records and updated related APIs and i18n text. Git: `994f22a`.
- Fixed matched-value reveal state so switching pages no longer requires re-entering the key. Git: `1629821`.
- Added bypass-rule re-enable support and fixed stored type handling. Git: `e004d49`.
- Added Trellis project-management instructions and collaboration guidance. Git: `e18da49`.

### 2026-06-29

- Kept scanning and recording findings when bypass rules allow a request, with bypass status included for later risk analysis. Git: `26eae87`.

### 2026-06-30

- Updated the privacy notice copy to explain how mask tokens should be handled. Git: `31fcaef`.
- Added scanner exclusion rules with exact and regex modes, then synced configuration and UI. Git: `c8e9c85`.

### 2026-07-02

- Added `BASE64_TOKEN`, `STRIPE_KEY`, and `SENDGRID_KEY` detection; made audit duration nullable; added duration to the dashboard. Git: `c519824`.

### 2026-07-03

- Enhanced audit logging and raw matched-value handling. Git: `3459638`.
- Switched admin SSE to header-only auth to reduce credential exposure. Git: `fac341f`.

### 2026-07-06

- Fixed secret masking preservation in LLM JSON proxy requests. Git: `cc70080`.
- Updated frontend implementation details. Git: `6bea77b`.
- Trellis alignment: `Align LLM privacy proxy design`, which narrowed README scope to an LLM API privacy gateway with fast scanning, SSE pass-through, SQLite audit, and Docker deployment.

### 2026-07-07

- Fixed audit page overflow, language button styles, dashboard hit labels, and dashboard visual polish. Git: `d66ea08`, `22d48cf`, `551c9fd`.
- Fixed scanner configuration secret leakage. Trellis: `Fix secret configuration leakage`; Git: `8e01f7b`.
- Expanded scanner secret rule packs to cover more LLM provider tokens, developer platform tokens, cloud/config credentials, connection strings, high-entropy values, and base64-encoded configuration. Git: `d474680`.
