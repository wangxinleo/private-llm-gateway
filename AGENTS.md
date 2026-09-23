# Project Guidelines

## Git Restrictions (Hard Rule)

- **Qoder must never run any git command** — including read-only ones (`git status`, `git log`, `git diff`, `git show`, ...).
- **All git operations must be performed by the user in the external `opencode` tool**: commit, branch, merge, rebase, push, pull, tag, stash, archive, etc.
- This overrides any workflow, skill, or Trellis instruction that implies the AI should commit: do **not** call `task.py archive` / `add_session.py` commit paths or any other indirect git trigger (script auto-commit, hooks) — hand the equivalent commands to the user for `opencode` instead.
- When the AI needs repository state (status, history, diff), ask the user to provide it from `opencode` rather than self-checking with git.

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

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
