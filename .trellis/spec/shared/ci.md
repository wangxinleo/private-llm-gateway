# CI Workflow Contract

## Scenario: GitHub Actions Build

### 1. Scope / Trigger

- Trigger: Add or change repository-level GitHub Actions automation.
- Applies to workflows under `.github/workflows/`.
- This repository currently uses npm because `package-lock.json` is committed.

### 2. Signatures

- Workflow file: `.github/workflows/build.yml`
- Required commands:
  - `npm ci`
  - `npm test`
  - `npm run build`

### 3. Contracts

- Runtime: Node.js 22, matching the Docker builder image.
- Package manager: npm.
- Cache key: npm cache managed by `actions/setup-node`.
- Required triggers:
  - `push`
  - `pull_request`
  - `workflow_dispatch`

### 4. Validation & Error Matrix

- Dependency install fails -> CI must fail before tests.
- Test failure -> CI must fail before production build.
- Production build failure -> CI must fail the workflow.
- Missing or mismatched lockfile -> fix the repository package-manager state before changing CI.

### 5. Good/Base/Bad Cases

- Good: `npm ci` installs from `package-lock.json`, tests pass, production build succeeds.
- Base: A pull request runs the same checks as a push.
- Bad: CI uses pnpm or yarn while the repository only commits `package-lock.json`.

### 6. Tests Required

- Run `npm test` locally after workflow changes.
- Run `npm run build` locally after workflow changes.

### 7. Wrong vs Correct

#### Wrong

```yaml
- run: pnpm install
- run: pnpm build
```

#### Correct

```yaml
- run: npm ci
- run: npm test
- run: npm run build
```
