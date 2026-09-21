# Reverse Proxy Patterns (Next.js 16 Route Handler)

## Scenario: Transparent Reverse Proxy with Body Inspection

### 1. Scope / Trigger
- Building a proxy that inspects request body before forwarding
- SSE streaming response passthrough
- Native module integration (better-sqlite3) with Next.js standalone output

### 2. Core Proxy Pattern

Use `request.clone()` to split scanning and forwarding without double-consuming the body:

```typescript
// src/app/[...path]/route.ts
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

> **Warning**: Never scan or rewrite upstream-owned model state in requests. Anthropic assistant `thinking`/`redacted_thinking` content blocks, Chat assistant `reasoning_content`/`reasoning`/`reasoning_details`, and Responses `input[]` items of `type` `reasoning`/`compaction` are produced by the upstream; masking them breaks protocol round-trips (Anthropic validates the signature over the thinking text, so any rewrite yields a 400). `json-mask.ts` skips these nodes via `isUpstreamModelState` — the decision must stay protocol + path + role + type aware; a field name alone (e.g. `signature` outside a thinking block) must never bypass scanning. Skipped nodes produce no findings, no placeholders, and no registry entries.

> **Warning**: undici's fetch auto-decompresses `gzip`/`deflate`/`br` but keeps the `content-encoding` header, and does not decode `zstd` at all. Every response re-emission path (restored text path, SSE passthrough, binary passthrough, bypass) must normalize headers via `src/proxy/content-encoding.ts`: strip `content-encoding` when it is a client-decoded coding, decompress `zstd` ourselves (Node ≥ 22.15; unsupported runtimes degrade to opaque passthrough), and keep original bytes + header for unknown codings. On the request side `forwardRequest` filters `accept-encoding` to the decodable set (zstd removed) — advertising zstd invites undecodable responses. Regression tests must cover the no-mask/passthrough paths, not only the restore path.

> **Warning**: Private-IPv6 detection (`IPV6_PRIVATE`, default off) must stay validator-driven: never use "is private" semantics that include `2001:db8::/32` or `::1` (they would mask public/doc text) — accept only `fe80::/10` link-local and `fc00::/7` ULA. Match via a wide run (`[0-9A-Fa-f:]{2,45}`) plus a structured sticky sub-match so a greedy candidate cannot swallow the real address (`IPV6:fe80::1` prefix case), and keep the keyword prefilter case-insensitive (`Fe80::1` must not be skipped) and colon-gated (`:` alone would run the wide regex on every URL/JSON).

> **Warning**: Never dedupe findings by value-substring absorption. `scanContextWindows` merges the full-text pass and windowed passes and must keep only exact-value dedup: the old `longerMatchPresent` heuristic dropped a short finding whenever a longer matched value elsewhere contained it as a substring, so the short value's *independent* occurrences stayed in plaintext while the audit reported "masked" (F1, 2026-09-21 — reproduced with `fe80::1`/`fe80::1%eth0` and with a Luhn card containing a phone number). Overlap/nesting is absorbed positionally by `applyMasks` (longest-first combined alternation); the >512-value fallback `applyMasksSequential` must therefore stay length-descending, and auditing may list both nested categories — that is expected, not a regression.

> **Warning**: Never forward `Expect` or hop-by-hop request headers upstream. curl sends `Expect: 100-continue` by default for POST bodies larger than 1 KB, and undici rejects it with `UND_ERR_NOT_SUPPORTED` — every large request returned 502 (2026-09-21, 1.5 MB stress test). `forwardRequest` drops `expect`, `connection`, `keep-alive`, `proxy-connection`, `te`, `trailer`, `transfer-encoding` and `upgrade`; business headers (Authorization, custom headers) still pass through untouched. The header contract is pinned by `forwarder-headers.test.ts`.

> **Warning**: `HIGH_ENTROPY` (unlabeled random-credential detection, default off) is calibrated, not hand-tuned: thresholds come from `scripts/calibrate-entropy.mjs` (p99.9 of literature-holdout + natural-word concatenations; repo code/lockfile text is a *stress* corpus only and must never re-enter the calibration pool — doing so pushed thresholds to meaningless levels and collapsed hex recall to 0). The standard-hash guard skips lowercase pure-hex at exactly 32/40/64/128 chars (statistically indistinguishable from hex secrets, and the dominant FP source in lockfiles); other shapes still match. Remaining FP classes are documented boundaries: short hex fragments (abbreviated git SHAs), unusual compounds/identifiers, >256-char blocks (skipped), and credentials split by separators. Regenerate with `npm run gen:entropy-table` + `npm run calibrate:entropy`; `entropy.ts` fails loudly if the generated table dimensions are wrong.

> **Warning**: Request-side injection signals (`src/proxy/request-analysis.ts`, audit-only, never blocking) require *objective payloads*: family 1 fires on protocol control-token literals only with a second distinct literal or an instruction verb nearby (±200 chars); family 2 requires credential-object + egress verb + external target inside a **tight ±80-char window** (loosening it re-introduced the README "sensitive filenames list + uploaded + URL" false positive); family 3 requires an extraction phrase plus an encoding marker. Generic phrasing ("ignore previous instructions") is never reported alone, generic words (`credentials`, `token`) are excluded from the object list, `.env` needs a non-word boundary (so `process.env` cannot match), and `detail` carries only a masked preview. The negative-fixture test walks `src/**`, `.trellis/spec` and README and must stay at zero signals; it only skips the detector source, the marker-embedding benchmark, and task docs that enumerate these literals by design.

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

Runtime env keys in `docker-compose.yaml` interpolate from the repository-root `.env` (docker compose reads it automatically): optional values use `${VAR:-}`, required values use `${VAR:?message}` fail-fast. No project-prefixed indirection:

| Container env | Required | Default in Compose | Contract |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | `production` | Production runtime mode. |
| `PORT` | yes | `3000` | Next.js listen port inside the container. |
| `HOSTNAME` | yes | `0.0.0.0` | Bind all container interfaces. |
| `UPSTREAM_URL` | no | empty (anti-enumeration) | Base URL reachable from inside the container; empty means only `/<channel-prefix>/...` paths are reachable. |
| `DB_PATH` | yes | `/data/audit.sqlite` | SQLite audit database path under the bind-mounted `/data`. |
| `ADMIN_KEY` | yes | `${ADMIN_KEY:?...}` fail-fast | Required for `/dashboard`; compose refuses to start when unset. |
| `PRIVACY_SUFFIX_SECRET` | no | empty (random per process) | Fixed placeholder-derivation secret for stable prompt-cache prefixes. Values shorter than 16 chars are ignored (with a startup warning) and fall back to the per-process random key. |
| `TRUST_PROXY` | no | empty | `1` trusts `X-Forwarded-Proto/Host` for the admin origin check (needed when the proxy rewrites `Host`). Any value other than `1` is ignored and produces a startup warning. |
| `ALLOWED_ORIGINS` | no | empty | Extra exact origins allowed to call `/api/admin/*`, comma-separated. |
| `DISABLE_ORIGIN_CHECK` | no | empty | Escape hatch: `1` disables the admin origin check entirely. Any value other than `1` is ignored and produces a startup warning. |

Env-validation contract: enum/constrained env values are parsed leniently (invalid values fall back to the default) but must never fail silently — every lenient fallback of a security-relevant env key belongs in `src/lib/env-check.ts`, which runs once per process from `initializeConfigs()` and reports each ignored value to stderr with expected values and the resulting fallback behaviour.

Audit raw-value contract:
- `logAudit` must persist `matchedValues` for every finding so private deployments can measure real leakage.
- SQLite may contain raw secrets/PII; protect `./data/audit.sqlite` and do not log or SSE-broadcast raw values.
- Admin audit API returns raw `matchedValues` only after reveal auth.
- Admin UI displays partial masks containing `**`; copy actions copy the raw value from the reveal-auth response.

Compose topology contract:
- Use the published image (`image:`) only; do not add local build configuration.
- Env values interpolate from the repository-root `.env`; secrets use fail-fast `${ADMIN_KEY:?...}`, never plaintext defaults.
- Do not add a simulated upstream service; smoke tests must use a real upstream URL.
- Mount persistent audit data with bind mount `./data:/data`; do not use named volumes.

Native module contract:
- Builder and runner stages must use the same base image family for ABI compatibility.
- Builder must include `python3 make g++` so `better-sqlite3` can compile when no matching prebuild exists.
- Runner must include `libstdc++`.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Docker daemon is unavailable | `docker compose config` / `docker compose up` fails before application validation; report daemon issue separately. |
| `UPSTREAM_URL` is not reachable from inside the container | Proxy forwarding fails; edit `.env` to `host.docker.internal`, a real service name, or a routable URL. |
| `/data` is not writable by runtime user | First audit write fails when opening SQLite; create and chown `/data` before switching to `USER node`. |
| SQLite sidecar files are not ignored | `audit.sqlite-shm`/`audit.sqlite-wal` appear as dirty files; ignore `*.sqlite-*` and `*.db-*`. |
| `better-sqlite3` native runtime libs are missing | Container starts then crashes on module load; keep same Alpine base and install `libstdc++` in runner. |
| Admin reveal auth is inactive | Audit API omits `matchedValues`; UI shows reveal-required copy/display hint. |

### 5. Good/Base/Bad Cases
- Good: `docker-compose.yaml` has `image`, `.env`-interpolated `environment`, `./data:/data`, and no local build or mock service.
- Base: `UPSTREAM_URL=http://host.docker.internal:8787` in `.env` for Docker Desktop host upstream.
- Bad: reintroducing project-prefixed upstream indirection, a raw-value opt-in switch, plaintext secrets in Compose, or a mock upstream service to simulate deployment complexity.

### 6. Tests Required
- `docker compose config` must parse the production topology.
- `npm test` must assert raw matched values are persisted, admin API gates them behind reveal auth, UI masking helper includes `**`, and SSE broadcasts omit raw values.
- `npm run build` must pass after deployment changes.
- Search deployment, docs, specs, and source for rejected topology/privacy contract terms; no local build stanza, project-prefixed indirection, raw-value opt-in switch, or mock upstream service may remain.

### 7. Wrong vs Correct

#### Wrong — plaintext/empty secrets and local image construction in Compose
```yaml
services:
  privacy-proxy:
    # local image construction configured here
    environment:
      UPSTREAM_URL: ${PROJECT_UPSTREAM_URL:-http://upstream-service:8787}
      ADMIN_KEY: ""   # container starts silently without a usable console key
  simulated-upstream:
    image: node:22-alpine
```

#### Correct — Image-only Compose with .env interpolation and fail-fast secrets
```yaml
services:
  privacy-proxy:
    image: ghcr.io/wangxinleo/private-llm-gateway:latest
    environment:
      NODE_ENV: production
      PORT: 3000
      HOSTNAME: 0.0.0.0
      UPSTREAM_URL: "${UPSTREAM_URL:-}"
      DB_PATH: /data/audit.sqlite
      ADMIN_KEY: "${ADMIN_KEY:?请在仓库根 .env 或 shell 环境设置 ADMIN_KEY}"
```

## Scenario: Admin API Origin Check (Next.js Middleware)

### 1. Scope / Trigger
- Trigger: changing `src/middleware.ts`, `ALLOWED_ORIGINS` / `TRUST_PROXY` / `DISABLE_ORIGIN_CHECK` wiring, or debugging `/api/admin/*` 403 `origin_not_allowed` after deployment.
- Applies to browser console login (`fetch /api/admin/config` with `x-admin-key`) and any admin API calls behind Docker, reverse proxies, or tunnels.

### 2. Signatures
- `middleware(request: NextRequest)` — matcher `/api/admin/:path*`.
- Env keys: `ALLOWED_ORIGINS` (comma-separated exact origins), `TRUST_PROXY=1`, `DISABLE_ORIGIN_CHECK=1`.
- Same-origin candidates = `http(s)://<request Host header>` plus `new URL(request.url).origin` (local fallback).

### 3. Contracts
- Same-origin base MUST be the request `Host` header. Never base origin decisions on `new URL(request.url).origin`: in non-Vercel runtimes Next.js builds `request.url` from the **server bind address** (`next-server.js` initUrl → `http://0.0.0.0:PORT` in standalone, `http://localhost:PORT` in dev), which no browser ever sends.
- Both `http://` and `https://` of the Host are accepted (server cannot observe the client-facing scheme; TLS may terminate upstream).
- `Origin: null` → 403; missing Origin and Referer → pass (non-browser clients); Referer is the fallback when Origin is absent (same-origin GET fetch sends Referer only).
- `TRUST_PROXY=1` additionally trust `X-Forwarded-Proto` / `X-Forwarded-Host` (single hop); needed when the proxy rewrites `Host` to an internal address. Without it, forwarded headers are ignored (they are client-spoofable).
- `ALLOWED_ORIGINS` entries are exact matches (trailing slash tolerated); `x-admin-key` remains the primary defense, this check is CSRF-style defense-in-depth.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Browser origin scheme+host equals request Host (direct IP, domain, Host-preserving proxy) | pass |
| Cross-site Origin/Referer | 403 `origin_not_allowed` |
| `Origin: null` (sandboxed iframe) | 403 |
| Proxy rewrites Host to internal address, no TRUST_PROXY | 403 (unless `ALLOWED_ORIGINS` covers the public origin) |
| `TRUST_PROXY=1` + `X-Forwarded-Proto/Host` = public origin | pass |
| Spoofed `X-Forwarded-*` without `TRUST_PROXY=1` | 403 |
| Origin check passed, wrong admin key | 401 (not 403) |

### 5. Good/Base/Bad Cases
- Good: `curl -H "Host: 192.168.1.10:3210" -H "Referer: http://192.168.1.10:3210/dashboard" .../api/admin/config` passes in a standalone container.
- Base: `curl` with no Origin/Referer passes (machine clients).
- Bad: `allowedOrigins` seeded only from `new URL(request.url).origin` — every real browser login 403s in Docker while dev on localhost appears to work.

### 6. Tests Required
- `src/__tests__/middleware-origin.test.ts`: same-origin via Host when bind address differs; https Host when TLS terminates upstream; cross-origin rejected with Host present; `Origin: null`; `TRUST_PROXY=1` forwarded origin; spoofed forwarded headers without TRUST_PROXY; `ALLOWED_ORIGINS`; `DISABLE_ORIGIN_CHECK=1`.
- Post-deploy smoke: browser login through the actual ingress (proxy/tunnel), not just `localhost`.

### 7. Wrong vs Correct

#### Wrong — bind address as same-origin base
```typescript
// standalone: always http://0.0.0.0:3000 — no browser matches
origins.add(new URL(request.url).origin);
```

#### Correct — Host header as same-origin base
```typescript
origins.add(new URL(request.url).origin); // local/dev fallback only
const host = request.headers.get("host");
if (host) {
  origins.add(`http://${host}`);
  origins.add(`https://${host}`);
}
```

## Scenario: LLM Privacy Proxy Alignment

### 1. Scope / Trigger
- Trigger: changing `src/app/[...path]/route.ts`, `src/proxy/channels.ts`, `src/proxy/forwarder.ts`, `src/scanner/json-mask.ts`, or policy docs for the LLM privacy proxy path.
- Applies to root-path channel routing (`/<channel-prefix>/**`, plus legacy default-upstream as-is mode), OpenAI-compatible and Anthropic-compatible JSON request flows, SSE response passthrough, DB-backed runtime scanner config, and privacy mask policy.

### 2. Signatures
- Route signature: `src/app/[...path]/route.ts` root catch-all; `extractPath` = `pathname + search` verbatim (no fixed `/api` segment is stripped).
- Channel routing: `resolveChannel(path: string): ResolvedChannel | null` matches `/<channel-prefix>/**` against enabled upstreams; `forwardPath` is the path after the prefix; reserved root segments `api` / `dashboard` / `admin` / `health` never resolve as channels.
- Scanner signature: `maskJsonBody(body: string, scan: (text: string, size: number) => ScanResult): ScanResult`.
- Runtime config signature: call `initializeConfigs()` before scan, bypass, threshold, or exclusion decisions on the proxy request path.

### 3. Contracts
- Channel hit: strip the channel prefix, keep the rest + query — `/<channel>/v1/messages?beta=true` forwards to `<channel-target>/v1/messages?beta=true` (`forwarder` uses `${target}${forwardPath}`).
- Legacy mode (no channel hit, `UPSTREAM_URL` set): forward the full path + query verbatim; the default upstream base URL is host:port and nothing is stripped.
- No channel hit and no default upstream: immediate 404 before reading body, scanning, or auditing (anti-enumeration).
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
- Good: `/<channel>/v1/chat/completions?trace=1` forwards to `<channel-target>/v1/chat/completions?trace=1` and masks `{ "api_key": "abc12345_67890" }` to `{ "api_key": "<<PRIVACY_MASK:CONTEXTUAL_SECRET>>" }`.
- Base: clean JSON with no findings is parsed and re-serialized without changing values.
- Bad: stripping a fixed `/api` segment (pre-migration behavior), forwarding the channel prefix to the upstream, dropping the query string, or forwarding synthetic text like `api_key=abc12345_67890` inside the JSON payload.

### 6. Tests Required
- Route regression: channel prefix stripped and query string preserved for an LLM-style API path; unmatched path without default upstream returns 404 without audit rows.
- Route regression: `initializeConfigs()` is called before bypass or scan decisions.
- JSON scanner regression: root and nested contextual secret fields are masked and synthetic context is absent from `maskedBody`.
- Policy regression: LLM JSON/text secrets are mask-and-forward; `SENSITIVE_FILENAME` remains block.

### 7. Wrong vs Correct

#### Wrong — fixed /api prefix assumption and query dropped
```typescript
const path = url.pathname.replace(/^\/api/, "") || "/"; // invalid after root-path migration
const result = scan(value, value.length);
```

#### Correct — verbatim path, channel prefix stripped only at forward time, query preserved
```typescript
const path = `${url.pathname}${url.search}`;
const upstreamPath = channel ? channel.forwardPath : path; // channel: prefix stripped; legacy: as-is
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
