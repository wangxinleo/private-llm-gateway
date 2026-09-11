# 深度分析子任务产出(grok-4.6)

> 来源:OpenChamber session `ses_f75b3e623ffeTkrYG2n12x5XQh`,2026-09-10。原型级伪码已按代码主权原则在 design.md 中重构,本文仅存档原始参考。

**1. Mapping lifecycle**
Per-request in-memory value->index mapping suffices for multi-turn chats because the client always resends the full restored conversation history, so the gateway always re-scans the complete body and rebuilds the mapping from scratch.

Failure modes:
- Stream retry (SSE partial chunk loss) — mapping state lost.
- Parallel requests to same model — race on shared index counter.
- Same value appearing in multiple categories — ambiguous tag.
- Oversized mapping (>10k unique values) — memory bloat on large bodies.

Decisions: per-request rebuild = Yes; per-request counter reset.

**2. SSE streaming restore algorithm**
Recommended: incremental matcher with hold-back buffer for partial prefix (O(1) amortized per byte, no end-of-stream buffering).

Decision table:
| Option | Recommended | Pros | Cons |
|--------|-------------|------|------|
| raw-text restore | Yes | Simple, zero parse risk, UTF-8 safe with hold-back | Tag can split across chunks |
| parse each SSE JSON event + rewrite deltas | No | More robust for some providers | Fragile JSON structure, extra CPU, per-provider edge cases |

**3. Non-stream JSON restore**
Rewrite message.content / delta.content / tool_calls[].function.arguments: Yes; finish_reason / error objects: No.

**4. Field scope**
Grok 建议 narrowest safe scope(正文 + tool 参数);用户已裁决为全文本字段统一还原,以用户裁决为准。

**5. Edge cases**
Model paraphrase → tag still appears; placeholder in code blocks → restore still applies; damaged tag → passthrough; legacy tags unmapped → passthrough; fake-tag flood → regex only; audit must stay masked → restoration after logAudit (route.ts audit 先于转发,天然满足).

**6. Overall soundness review**
- Response-side re-scan: none needed (model output not re-scanned)
- Disambiguation notice echo: already handled in disambiguation.ts
- Blocked-response: request-level only
- Parallel request race: mitigated by per-request counter
- Base64/tool_id fields: protected in json-mask

**Prioritized risk list**
1. Stream retry + partial tag split (high) — streaming.ts
2. Same-value cross-category collision (med) — mask-tag.ts / pii.ts
3. Oversized mapping in long context (med)
4. Model paraphrase corrupting restore (low)
5. Legacy tag recognition (low) — mask-tag.ts
6. Audit post-log restore order (low) — route.ts audit 先于转发,已满足
