# Git automatic build workflow

## Goal

Add a versioned GitHub Actions workflow so commits pushed to GitHub automatically install dependencies, run tests, and build the Next.js application.

## What I already know

- The user asked for an automatic builder on git after commits.
- The repository is a Next.js application named `privacy-proxy`.
- The package manager in this repository is npm, indicated by `package-lock.json`.
- Existing scripts are `npm run build`, `npm test`, `npm run dev`, and `npm start`.
- There is no existing `.github/workflows` directory.
- The Dockerfile also builds with `npm ci` and `npm run build`.

## Assumptions

- "After commit" means after commits are pushed to GitHub, not a local `post-commit` hook.
- The minimum useful build gate is install dependencies, run unit tests, and run the production build.
- The workflow should not publish or deploy artifacts yet.

## Requirements

- Add a GitHub Actions workflow committed in the repository.
- Trigger on `push` and `pull_request`.
- Allow manual reruns via `workflow_dispatch`.
- Use Node.js 22 to match the Dockerfile builder image.
- Use `npm ci` for deterministic installs from `package-lock.json`.
- Run `npm test`.
- Run `npm run build`.

## Acceptance Criteria

- [ ] `.github/workflows/build.yml` exists.
- [ ] The workflow triggers on pushes and pull requests.
- [ ] The workflow installs dependencies with `npm ci`.
- [ ] The workflow runs the test suite.
- [ ] The workflow runs the production Next.js build.
- [ ] Local `npm test` passes.
- [ ] Local `npm run build` passes.

## Definition of Done

- Tests pass locally.
- Production build succeeds locally.
- CI workflow is minimal and maintainable.
- No unrelated source changes are made.

## Out of Scope

- Deployment.
- Docker image publishing.
- Local git hook installation.
- Dependency upgrades.

## Technical Notes

- Shared Trellis docs mention pnpm as a generic guideline, but this repository currently uses npm and has `package-lock.json`.
- `better-sqlite3` may need native build tooling in CI; GitHub's Ubuntu runners include the usual compiler toolchain, and `actions/setup-node` plus npm cache should be enough for this project.
