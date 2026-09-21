# 修复：压缩响应链路（content-encoding 头/zstd）

## Goal

转发剔除 undici 不支持的 accept-encoding（zstd）；再发出路径按编码归一；zstd 防御性解压；本地压缩服务器回归测试。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
