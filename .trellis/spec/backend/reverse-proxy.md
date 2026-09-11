# Reverse Proxy Patterns (Next.js 16 Route Handler)

## Scenario: Transparent Reverse Proxy with Body Inspection

### 1. Scope / Trigger
- Building a proxy that inspects request body before forwarding
- SSE streaming response passthrough
- Native module integration (better-sqlite3) with Next.js standalone output

### 2. Core Proxy Pattern

Use `request.clone()` to split scanning and forwarding without double-consuming the body:

```typescript
// app/api/[[...path]]/route.ts
export async function POST(request: Request) {
  const [forScan, forForward] = [request.clone(), request];

  const body = await forScan.text();
  const result = await runPipeline(body);

  if (result.action === 'block') {
    return blockResponse(result.findings);
  }

  const forwarded = await forwardRequest(forForward, result.maskedBody ?? body);
  return passthrough(forwarded);
}
```

### 3. SSE Streaming Passthrough

Use Web Streams API `ReadableStream` to transparently pipe SSE responses:

```typescript
function passthrough(upstream: Response): Response {
  if (!upstream.body) return new Response(null, { status: upstream.status });

  const reader = upstream.body.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      controller.enqueue(value);
    },
    cancel() { reader.cancel(); }
  });

  return new Response(stream, {
    status: upstream.status,
    headers: upstream.headers
  });
}
```

### 4. Native Module + Standalone Output

When using native modules (better-sqlite3) with Next.js standalone output:

```typescript
// next.config.ts
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
};
```

Both builder and runner stages in Dockerfile must use the same base image for ABI compatibility.

### 5. Gotchas

> **Warning**: `text.length` returns character count, not byte count. For size-based tiering with non-ASCII content, use `new TextEncoder().encode(text).length`.

> **Warning**: `Finding` objects may carry raw matched values for audit persistence, but live SSE broadcasts and application logs must serialize only categories/metadata. Admin UI must display matched values with partial `**` masking and use reveal-auth-gated copy for the true value.

> **Warning**: When scanning multipart requests, use `request.clone()` before calling `formData()` — `formData()` consumes the body.

> **Warning**: Never forward the scanned concatenated text as a multipart body. `collectMultipartText` drops file blobs and strips the boundary, so the upstream receives a `multipart/form-data` header with a plain-text body. Rebuild a `FormData` (mask string fields, keep `File` entries) and delete the stale `content-type` header before `fetch` so a fresh boundary is generated. Do not forward `request.body` streams directly — Node fetch requires `duplex: "half"` for stream bodies.

> **Warning**: Never scan binary payloads (image/file base64) as text. Token-style regexes such as `BASE64_TOKEN` (`eyJ[A-Za-z0-9_-]{40,}`) match random base64 data at a non-trivial rate (~2% at 22 KB, ~17% at 240 KB), and masking corrupts the base64 — upstream token counters then fail with `failed to decode base64 data: illegal base64 data at input byte N`. Before running the secret scan, skip data URIs (`data:<mime>;base64,`) and long pure-base64 `data` fields (Anthropic `source.data` / Gemini `inline_data.data`). Restrict the exemption to these shapes so pasted base64 tokens in ordinary text fields are still masked.

### 6. Wrong vs Correct

#### Wrong — Byte size from string length
```typescript
const size = body.length; // characters, not bytes
if (size > 128 * 1024) { /* wrong threshold */ }
```

#### Correct — Actual byte size
```typescript
const size = new TextEncoder().encode(body).length;
if (size > 128 * 1024) { /* accurate */ }
```

### 7. Dockerfile Pattern (Alpine + standalone)

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Copy native module
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
EXPOSE 3000
CMD ["node", "server.js"]
```

## Scenario: Docker Deployment for Privacy Proxy

### 1. Scope / Trigger
- Trigger: changing Dockerfile, Compose, environment wiring, or audit storage for this privacy proxy.
- Applies to Next.js standalone output, reverse proxy forwarding to the configured upstream service, SQLite audit storage through `better-sqlite3`, and admin reveal of raw matched values.

### 2. Signatures
- Production run command: `docker compose up -d privacy-proxy`
- Healthcheck endpoint: `GET /` on the proxy container port.
- Admin audit API: `GET /api/admin/audit` returns `matchedValues` only when reveal auth is active.

### 3. Contracts

Runtime env keys in `docker-compose.yaml` are written directly, without `.env`, environment-file wiring, or project-prefixed indirection:

| Container env | Required | Default in Compose | Contract |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | `production` | Production runtime mode. |
| `PORT` | yes | `3000` | Next.js listen port inside the container. |
| `HOSTNAME` | yes | `0.0.0.0` | Bind all container interfaces. |
| `UPSTREAM_URL` | yes | `http://host.docker.internal:8787` | Base URL reachable from inside the container; edit directly for the real upstream. |
| `DB_PATH` | yes | `/data/audit.sqlite` | SQLite audit database path under the bind-mounted `/data`. |
| `ADMIN_KEY` | deployment-specific | empty | Required for `/dashboard`; user fills a strong value directly in Compose. |

Audit raw-value contract:
- `logAudit` must persist `matchedValues` for every finding so private deployments can measure real leakage.
- SQLite may contain raw secrets/PII; protect `./data/audit.sqlite` and do not log or SSE-broadcast raw values.
- Admin audit API returns raw `matchedValues` only after reveal auth.
- Admin UI displays partial masks containing `**`; copy actions copy the raw value from the reveal-auth response.

Compose topology contract:
- Use the published image (`image:`) only; do not add local build configuration.
- Do not use environment-file wiring or nested variable interpolation.
- Do not add a simulated upstream service; smoke tests must use a real upstream URL edited into Compose.
- Mount persistent audit data with bind mount `./data:/data`; do not use named volumes.

Native module contract:
- Builder and runner stages must use the same base image family for ABI compatibility.
- Builder must include `python3 make g++` so `better-sqlite3` can compile when no matching prebuild exists.
- Runner must include `libstdc++`.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Docker daemon is unavailable | `docker compose config` / `docker compose up` fails before application validation; report daemon issue separately. |
| `UPSTREAM_URL` is not reachable from inside the container | Proxy forwarding fails; edit the direct Compose value to `host.docker.internal`, a real service name, or a routable URL. |
| `/data` is not writable by runtime user | First audit write fails when opening SQLite; create and chown `/data` before switching to `USER node`. |
| SQLite sidecar files are not ignored | `audit.sqlite-shm`/`audit.sqlite-wal` appear as dirty files; ignore `*.sqlite-*` and `*.db-*`. |
| `better-sqlite3` native runtime libs are missing | Container starts then crashes on module load; keep same Alpine base and install `libstdc++` in runner. |
| Admin reveal auth is inactive | Audit API omits `matchedValues`; UI shows reveal-required copy/display hint. |

### 5. Good/Base/Bad Cases
- Good: `docker-compose.yaml` has `image`, direct `environment`, `./data:/data`, and no local build, environment-file wiring, or mock service.
- Base: `UPSTREAM_URL: http://host.docker.internal:8787` for Docker Desktop host upstream; user edits directly for production.
- Bad: reintroducing project-prefixed upstream indirection, a raw-value opt-in switch, or a mock upstream service to simulate deployment complexity.

### 6. Tests Required
- `docker compose config` must parse the production topology.
- `npm test` must assert raw matched values are persisted, admin API gates them behind reveal auth, UI masking helper includes `**`, and SSE broadcasts omit raw values.
- `npm run build` must pass after deployment changes.
- Search deployment, docs, specs, and source for rejected topology/privacy contract terms; no local build stanza, environment-file wiring, project-prefixed indirection, raw-value opt-in switch, or mock upstream service may remain.

### 7. Wrong vs Correct

#### Wrong — Compose adds local image construction, env indirection, and mock service
```yaml
services:
  privacy-proxy:
    # local image construction configured here
    # environment loaded from a sidecar file
    environment:
      UPSTREAM_URL: ${PROJECT_UPSTREAM_URL:-http://upstream-service:8787}
  simulated-upstream:
    image: node:22-alpine
```

#### Correct — Image-only Compose with direct startup env
```yaml
services:
  privacy-proxy:
    image: ghcr.io/wangxinleo/private-llm-gateway:latest
    environment:
      NODE_ENV: production
      PORT: 3000
      HOSTNAME: 0.0.0.0
      UPSTREAM_URL: http://host.docker.internal:8787
      DB_PATH: /data/audit.sqlite
      ADMIN_KEY: ""
```

## Scenario: LLM Privacy Proxy Alignment

### 1. Scope / Trigger
- Trigger: changing `src/app/api/[[...path]]/route.ts`, `src/proxy/forwarder.ts`, `src/scanner/json-mask.ts`, or policy docs for the LLM privacy proxy path.
- Applies to OpenAI-compatible and Anthropic-compatible JSON request flows, SSE response passthrough, DB-backed runtime scanner config, and privacy mask policy.

### 2. Signatures
- Proxy route signature: `/api/[[...path]]` forwards to upstream path `pathnameWithoutApiPrefix + search`.
- Scanner signature: `maskJsonBody(body: string, scan: (text: string, size: number) => ScanResult): ScanResult`.
- Runtime config signature: call `initializeConfigs()` before scan, bypass, threshold, or exclusion decisions on the proxy request path.

### 3. Contracts
- Query strings are part of the upstream forwarding contract: `/api/v1/messages?beta=true` must forward as `/v1/messages?beta=true`.
- JSON string values are scanned with immediate key/path context, but the forwarded JSON must contain only original fields and masked original values.
- Synthetic scan text such as `api_key=value` or `config.secret=value` must never be inserted into the forwarded body.
- Default LLM JSON/text secret policy is mask-and-forward. High-risk secrets should be replaced with `<<PRIVACY_MASK:...>>`, not blocked.
- Hard block remains reserved for explicit block categories such as `SENSITIVE_FILENAME`.

### 4. Validation & Error Matrix
- Missing query preservation -> provider options or LLM-compatible endpoints can break; add route/forwarder regression tests.
- Missing config initialization -> proxy behavior depends on visiting admin config first; test proxy request without admin config GET.
- Missing JSON key/path context -> fields such as `api_key`, `authorization`, or `secret` can be missed; test nested JSON fields.
- Secret categories treated as block by default -> LLM code/log/config analysis is interrupted; policy tests must keep secrets as mask unless explicitly hard-blocked.

### 5. Good/Base/Bad Cases
- Good: `/api/v1/chat/completions?trace=1` forwards to `/v1/chat/completions?trace=1` and masks `{ "api_key": "abc12345_67890" }` to `{ "api_key": "<<PRIVACY_MASK:CONTEXTUAL_SECRET>>" }`.
- Base: clean JSON with no findings is parsed and re-serialized without changing values.
- Bad: forwarding `/api/v1/chat/completions?trace=1` as `/v1/chat/completions`, or forwarding synthetic text like `api_key=abc12345_67890` inside the JSON payload.

### 6. Tests Required
- Route regression: forwarded path includes query string for an LLM-style API path.
- Route regression: `initializeConfigs()` is called before bypass or scan decisions.
- JSON scanner regression: root and nested contextual secret fields are masked and synthetic context is absent from `maskedBody`.
- Policy regression: LLM JSON/text secrets are mask-and-forward; `SENSITIVE_FILENAME` remains block.

### 7. Wrong vs Correct

#### Wrong — drop query string and scan values without context
```typescript
const path = url.pathname.replace(/^\/api/, "") || "/";
const result = scan(value, value.length);
```

#### Correct — preserve query and scan with context while masking only original value
```typescript
const path = url.pathname.replace(/^\/api/, "") || "/";
const upstreamPath = `${path}${url.search}`;
const scanText = `${key}=${value}`;
const result = scan(scanText, new TextEncoder().encode(scanText).length);
```

## Scenario: Contextual Secret Configuration Scanner

### 1. Scope / Trigger
- Trigger: changing `src/scanner/context-key.ts`, `src/scanner/json-mask.ts`, or tests for credential/config leakage masking.
- Applies to contextual config snippets where secret keys, endpoint keys, and identity keys appear in JSON, env-style text, query parameters, XML, bracket access, or dot-path contexts.

### 2. Signatures
- Scanner signature: `scanContextKey(text: string): Finding[]`.
- Finding category contract: contextual config findings use `category: "CONTEXTUAL_SECRET"`, `action: "mask"`, and `buildMaskTag("CONTEXTUAL_SECRET")`.
- JSON scanner contract: `maskJsonBody` may scan synthetic context (`key=value`, `full.path=value`) but must mask only original JSON string values.

### 3. Contracts
- Key matching is case-insensitive and separator-insensitive: normalize by lowercasing and stripping `_`, `-`, `.`, and whitespace. Examples: `apiKey`, `api_key`, `api-key`, and `APIKEY` all resolve to `apikey`.
- Secret keys mask token-like values directly when the value validator passes.
- Endpoint keys such as `baseUrl`, `apiBaseUrl`, `endpoint`, `apiUrl`, `serverUrl`, `host`, and the typo `bashUrl` mask URL/host-like values only in endpoint-key context.
- Identity keys such as `username`, `session_id`, and `account_id` mask only when a secret candidate exists in the same scan window.
- Do not globally mask arbitrary prose URLs. URL masking must remain key-contextual.
- Do not perform live credential or endpoint verification from the proxy.

### 4. Validation & Error Matrix
| Case | Expected behavior | Why |
| --- | --- | --- |
| `apiKey` with token-like value | mask value | CamelCase config keys are common in SDK settings. |
| `APIKEY` / `base_url` variants | mask values | User config files vary by case and separator style. |
| `baseUrl=https://...` with API key nearby | mask endpoint value | Endpoint plus key is enough to use leaked credentials. |
| `bashUrl=https://...` with API key nearby | mask endpoint value | Preserve the observed typo leak scenario. |
| prose `https://example.test/docs` | allow | Avoid over-broad URL false positives. |
| JSON field value match | output valid JSON with only value replaced | Synthetic context must not leak into forwarded JSON. |

### 5. Good/Base/Bad Cases
- Good: `{ "apiKey": "demo-key_1234567890", "baseUrl": "https://api.example.test/v1" }` becomes `{ "apiKey": "<<PRIVACY_MASK:CONTEXTUAL_SECRET>>", "baseUrl": "<<PRIVACY_MASK:CONTEXTUAL_SECRET>>" }`.
- Base: `Please read https://api.example.test/v1` remains unchanged when no endpoint key exists.
- Bad: widening the generic contextual charset and masking every URL-like string in prose.

### 6. Tests Required
- Unit tests for `apiKey + baseUrl`, mixed-case keys, separator variants, and `bashUrl`.
- Unit tests that URL query parameters in endpoint values remain part of the matched endpoint.
- Negative tests for ordinary prose URLs without endpoint key context.
- JSON tests that nested `providers.openai.apiKey` and `providers.openai.baseUrl` remain valid JSON and mask only values.
- Pipeline tests for raw env/config text such as `APIKEY=...` plus `BASEURL=https://...`.

### 7. Wrong vs Correct

#### Wrong — case-sensitive key list and globally widened value charset
```typescript
const SECRET_KEYS = new Set(["api_key"]);
if (SECRET_KEYS.has(key) && /^[A-Za-z0-9._=-]+$/.test(value)) mask(value);
```

#### Correct — normalized key groups and context-specific validators
```typescript
const normalized = key.toLowerCase().replace(/[_.\-\s]/g, "");
if (SECRET_KEYS.has(normalized) && isSuspiciousSecretValue(value)) mask(value);
if (ENDPOINT_KEYS.has(normalized) && isEndpointValue(value)) mask(value);
```

## Scenario: Expanded Secret Rule Packs

### 1. Scope / Trigger
- Trigger: changing `src/scanner/secrets.ts`, `src/scanner/context-key.ts`, `src/scanner/json-mask.ts`, `src/types.ts`, or audit UI category lists for provider/developer/cloud/encoded secret detection.
- Applies to mask-only scanning for LLM provider tokens, developer tokens, cloud/config-file credentials, credentialed connection strings, and sensitive-key-gated encoded blobs.

### 2. Signatures
- Strong scanner signature: `scanSecrets(text: string): Finding[]`.
- Contextual scanner signature: `scanContextKey(text: string): Finding[]`.
- JSON scanner signature: `maskJsonBody(body: string, scan: (text: string, size: number) => ScanResult): ScanResult`.
- Environment mode: `PRIVACY_SECRET_SCANNER_MODE=balanced|strict`; default is `balanced`.

### 3. Contracts
- New strong categories are mask-only: `PROVIDER_API_KEY`, `DEVELOPER_TOKEN`, `CLOUD_CREDENTIAL`, and `CONNECTION_STRING`.
- Sensitive-key-gated base64 config masking uses `ENCODED_SECRET` and masks the encoded blob, not decoded synthetic text.
- Existing category compatibility remains: DB credential URLs that match existing DB schemes stay `DB_URI`; expanded non-DB/JDBC credential strings use `CONNECTION_STRING`.
- JSON object scanning may use sibling string fields as calibration context, but forwarded JSON must still contain only original keys and masked original values.
- Balanced mode rejects obvious placeholders such as `YOUR_API_KEY`, `${TOKEN}`, and `process.env.X`; strict mode may lower entropy thresholds but must not perform external verification.
- The scanner must not call provider, cloud, or user endpoints to verify credentials.

### 4. Validation & Error Matrix
| Case | Expected behavior | Why |
| --- | --- | --- |
| `sk-proj-...`, `sk-ant-...`, `hf_...` | `PROVIDER_API_KEY` mask | LLM gateway users often paste provider credentials. |
| `gho_...`, `glpat-...`, `npm_...`, `pypi-...` | developer token mask | Common developer config files leak these token classes. |
| AWS/Azure/GCP/Docker/kube sibling config fields | mask secret values and paired identifiers | Credential pairs are exploitable as a group. |
| `amqps://user:pass@host` or JDBC `password=` | connection-string mask | Credentials can appear outside classic DB URI schemes. |
| `config_b64=<base64 JSON with apiKey>` | `ENCODED_SECRET` mask on original encoded blob | Do not forward decodable credential configs. |
| placeholder docs examples | allow in balanced mode | Avoid noisy false positives in docs/prompts. |
| live provider verification | forbidden | Proxy must never test user credentials. |

### 5. Good/Base/Bad Cases
- Good: `OPENAI_API_KEY=sk-proj-...` is masked as contextual or provider secret; `{ clientId, tenantId, clientSecret }` masks all three values in JSON.
- Base: prose `Visit https://api.example.test/docs` remains unchanged without endpoint-key or secret context.
- Bad: decoding base64 and inserting decoded `api_key=value` into the forwarded JSON, or making a network request to validate a key.

### 6. Tests Required
- Strong-rule tests for provider token prefixes, expanded GitHub/GitLab/npm/PyPI developer tokens, Azure storage strings, `.netrc`, cURL auth snippets, URL credentials, and JDBC credentials.
- Context-key tests for AWS secret/session keys, Azure identity co-occurrence, npmrc/Docker/kube keys, high-entropy sensitive-key values, placeholders, and encoded config blobs.
- JSON tests for sibling object calibration and preservation of valid JSON with only original values masked.
- Pipeline tests proving new categories are mask-and-forward and `SENSITIVE_FILENAME` remains the hard-block path.

### 7. Wrong vs Correct

#### Wrong — one broad regex or live verification
```typescript
if (/key|token|secret/i.test(text)) {
  await fetch(providerVerifyUrl, { body: text });
}
```

#### Correct — local high-signal rules plus contextual validation
```typescript
const normalized = key.toLowerCase().replace(/[_.\-\s]/g, "");
if (normalized.endsWith("token") && isSuspiciousSecretValue(value)) mask(value);
if (isEncodedKey(normalized) && decodedTextLooksSensitive(value)) maskEncodedBlob(value);
```

## Scenario: High-Risk Asset Context Window Scanning

### 1. Scope / Trigger

- Trigger: changing `src/scanner/high-risk-assets.ts`, `src/scanner/context-window.ts`, `src/scanner/pipeline.ts`, or `high_risk_assets` runtime config.
- Applies to the scan-paradigm inversion: locate whitelisted high-risk assets → scan only their ±200-char context windows, instead of full-text scan + post-hoc exclusion.

### 2. Signatures

- `locateHighRiskAssets(text: string, assets?: HighRiskAssets): AssetHit[]` — whitelist hits (domains/emails/accounts) with positions.
- `scanContextWindows(text: string, assets?: HighRiskAssets): Finding[]` — global strong-signal layer + per-window scans.
- Runtime config: `high_risk_assets` (json_array) with `{ domains, emails, accounts }` string arrays; `*` matches any sequence.

### 3. Contracts

- PII (phone/email/ID card/bank card) is scanned full-text: stable formats, low false-positive rate.
- Global strong-signal layer (STRONG_RULES prefixes like `sk-`/`eyJ`/`ghp_`) always runs full-text and cannot be disabled (D5).
- `BASIC_AUTH` is excluded from masking: real Basic credentials are not treated as secrets to hide (user decision).
- Windows activate on: whitelist hits with a strong secret signal, or sensitive key-name hits (`api_key=`/`secret=`/`base_url=` etc. via `locateSensitiveHits`).
- Within a window, D7 tightening applies: chaotic 8+ char tokens, password-flag values (`passwd:`/`password:`/`pwd:`), keyword signals, and strong-rule prefixes all produce findings.
- Outside whitelist windows, prose URLs / commit SHAs / `BasicFlow` produce no findings (AC1).
- Synthetic context (`key=value`) is used only for scanning, never inserted into forwarded bodies.

### 4. Validation & Error Matrix

- `npm run bench` — new window-scan must be faster than old full-scan on a 278KB payload (AC5).
- `npm test` — all existing tests green; scanner_exclusions tests migrated to high_risk_assets (AC4/AC6).
- Admin Settings page writes `high_risk_assets`; legacy `scanner_exclusions` DB rows are left untouched.

### 5. Good/Base/Bad Cases

- Good: `https://app.ccload.com/v1` (whitelist domain) with a nearby token → masked.
- Good: `api_key=aBcDeFgHiJkLmNoPqRsTuVwXyZ012` (sensitive key) → CONTEXTUAL_SECRET masked.
- Base: prose URL / commit SHA outside whitelist and without sensitive key → no finding.
- Bad: `Basic dXNlcjpwYXNz` alone → not masked (BASIC_AUTH excluded by decision).

### 6. Tests Required

- `src/__tests__/high-risk-assets.test.ts` — wildcard glob, three-way whitelist location.
- `src/__tests__/context-window.test.ts` — D7 signals (chaos token / password flag / keyword / strong prefix), window slicing, out-of-window isolation.
- Pipeline tests — PII full-text, global strong-signal layer, BASIC_AUTH exclusion, masked JSON.

### 7. Wrong vs Correct

#### Wrong — full-text scan then filter
```typescript
const findings = [...scanSecrets(text), ...scanContextKey(text), ...scanPii(text)];
return applyExclusions(findings); // static suppression, cannot catch every URL variant
```

#### Correct — locate windows then scan
```typescript
push(scanPii(text)); // PII stays full-text (stable formats)
push(scanSecrets(text).filter((f) => f.category !== "BASIC_AUTH")); // global strong-signal layer
for (const hit of [locateHighRiskAssets(text, assets), ...locateSensitiveHits(text)]) {
  const window = sliceWindow(text, hit);
  if (!hasStrongSecretSignal(window)) continue;
  push(scanContextKey(window));
  push(scanChaosTokens(window));
}
```
