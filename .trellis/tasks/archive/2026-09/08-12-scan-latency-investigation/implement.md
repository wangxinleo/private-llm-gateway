# Integration and artifact completion plan

## Scope

This parent task is an investigation umbrella, not the implementation target for the next scanner rewrite. The plan records the evidence boundary between the completed historical P0 fix and the unimplemented span-based architecture.

## Ordered checklist

1. Freeze the historical evidence: task PRDs, the child follow-up replay, the recorded `6cd2bcc` result, the missing real fixture limitation, and the external architecture synthesis.
2. Keep the parent/child ownership explicit: the existing child owns the catastrophic-regex and PII-boundary fix; the new child owns future span-based masking and structured scan-unit work.
3. Review and maintain `implement.jsonl` and `check.jsonl` as real specification and research manifests. These manifests provide context and do not replace this execution plan.
4. Validate every task JSON file, required artifact, manifest path, parent-child link, and lifecycle status. Do not mark a task complete based only on a historical result table.
5. Record the artifact-repair outcome in the developer journal without changing unrelated untracked files.

## Evidence rules

- Treat the 79.2 ms and 359-test figures as recorded evidence from the implementation child unless the relevant tests are rerun.
- Do not claim production latency resolution without the deployed commit/image, exact slow request body, and deployed phase timings.
- Keep the absent `真实请求.md` fixture explicit; a skipped benchmark is not a passing real-payload measurement.
- Do not move the parent or child into the archive during this repair. Completion requires a separate quality gate and an explicit lifecycle action.

## Validation gate

Run `task.py validate` and `task.py list-context` for the parent, existing child, and architecture child. Confirm all required files exist, every JSONL row has a real referenced file and reason, and `task.py current --source` is reported accurately for the current session. Review the final diff with `git diff --check` and ensure unrelated untracked files remain untouched.

## Rollback

If any task manifest, parent link, or status is inconsistent after the repair, revert only the Trellis artifact changes from this repair. Do not alter production source, the external research synthesis, or unrelated working-tree files.
