# Publish Docker image to GHCR

## Goal

GitHub Actions should automatically build and publish the production Docker image for this Next.js privacy proxy to GitHub Container Registry, so deployments can pull a stable image instead of building locally from source.

## What I already know

- The repository already has `.github/workflows/build.yml`.
- The current workflow runs `npm ci`, `npm test`, and `npm run build`, but does not build or publish a Docker image.
- The repository has a production `Dockerfile` using a multi-stage `node:22-alpine` build and Next.js standalone output.
- `compose.yaml` currently builds a local image named `privacy-proxy:local`.
- There is an existing Trellis task at `.trellis/tasks/06-10-publish-docker-image/`.

## Assumptions

- GitHub Container Registry is the intended registry.
- The image name should be `privacy-proxy`.
- The default release branch is `master`.
- Pull requests should validate the Docker build but should not publish images.
- The built-in `GITHUB_TOKEN` should be used unless the repository requires a custom PAT later.

## Confirmed Decisions

- Use the recommended tagging policy: `master` publishes `latest`; Git tags matching `v*` publish version-derived image tags.

## Requirements

- Add GitHub Actions support for building the Docker image from the repository `Dockerfile`.
- Publish the image to `ghcr.io/<repo-owner>/privacy-proxy` for trusted refs.
- Keep the existing Node test/build checks before image publication.
- Grant the minimum workflow permissions needed for source checkout and GHCR publishing.
- Generate OCI labels and tags using a conventional metadata action.
- Avoid publishing images from pull request events.
- Support manual workflow runs through `workflow_dispatch`.

## Tagging Policy

- Pushes to `master` publish `latest`.
- Pushes to `master` also publish a branch-derived tag.
- Git tags matching `v*` publish version-derived tags.
- Pull requests build for validation only and publish nothing.

## Acceptance Criteria

- [ ] `.github/workflows/build.yml` contains a Docker image job that depends on the Node build/test job.
- [ ] The workflow logs in to `ghcr.io` with `${{ github.actor }}` and `${{ secrets.GITHUB_TOKEN }}`.
- [ ] The workflow declares `contents: read` and `packages: write` permissions.
- [ ] The workflow uses `docker/metadata-action` to generate image tags and labels.
- [ ] The workflow uses `docker/build-push-action` to build the Dockerfile.
- [ ] Pushes to `master` publish `ghcr.io/<owner>/privacy-proxy:latest`.
- [ ] Pull requests run Docker build validation without pushing to GHCR.
- [ ] The workflow remains runnable manually via `workflow_dispatch`.

## Definition of Done

- Existing tests still pass locally or in CI.
- The workflow YAML is syntactically valid.
- The Docker build path still uses the existing production `Dockerfile`.
- Documentation is updated if users need a new image pull command.

## Out of Scope

- Multi-architecture images.
- Release notes or GitHub Releases.
- Signing images or generating SBOM/provenance attestations.
- Changing the application runtime or Dockerfile unless required by CI failures.
- Publishing to Docker Hub or another registry.

## Research References

- [`research/ghcr-publish-workflow.md`](research/ghcr-publish-workflow.md) — GHCR publishing should use `GITHUB_TOKEN`, `packages: write`, Docker metadata tags, and build-push-action.

## Technical Notes

- Impacted files are expected to be `.github/workflows/build.yml` and optionally `README.md`.
- The existing workflow is named `Build`; it may keep that name or grow into a combined test/build/publish workflow.
- The existing Dockerfile already runs `npm ci` and `npm run build`, so CI will perform both application build validation and image build validation.
