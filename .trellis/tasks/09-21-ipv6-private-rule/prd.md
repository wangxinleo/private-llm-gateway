# 实现：IPV6_PRIVATE 内置规则（默认关）

## Goal

新增 fe80::/10+fc00::/7 私网 IPv6 规则：语义校验（不用 is_private）、zone id 剥离、前缀预过滤（ci）、默认关、正负用例与 UI/i18n。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
