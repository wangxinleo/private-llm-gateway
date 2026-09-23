# 修复：响应体还原体积闸 + 跳过留痕

## Goal

非流式响应全文读入 + 同步还原/分析无上限：超大响应阻塞事件循环。加响应侧体积闸（超限跳过还原/分析、响应体字节不动并留可查痕迹）。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
