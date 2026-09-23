# 修复：上游/流式错误诊断增强

## Goal

流式响应中途中断完全静默（streaming.ts 仅 controller.error）；非流式错误仅 code。补错误名/响应是否已开始/字节数/时长等诊断字段，落日志与审计。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
