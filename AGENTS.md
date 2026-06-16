# Project Guidelines

## Code Style

- Concise and efficient; no redundancy in code, comments, or documentation.
- Only make targeted changes for the requirement; never break existing functionality.
- All configuration via environment variables; never hardcode secrets.

## Architecture

- `src/app/api/[[...path]]/route.ts` — Reverse proxy entry point.
- `src/scanner/` — Privacy scanning pipeline (secrets, context keys, PII, filenames).
- `src/proxy/` — Upstream forwarding and SSE streaming.
- `src/audit/` — SQLite audit metadata.
- `Dockerfile` — Multi-stage production image (Next.js standalone).
- `docker-compose.yaml` — Local and production deployment.
