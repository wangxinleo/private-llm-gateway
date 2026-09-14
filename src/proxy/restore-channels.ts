// SSE 事件信封分类与语义通道键(maskit 2026-09 教训批次):
// - chat 稀疏分片中 choices[].index ≠ 数组位置,通道键必须用语义 index(#25/#29)
// - Anthropic content_block_* 与 Responses 根级 delta 的扁平信封,若按 JSON 路径
//   建通道会让所有块共享一个缓冲,半截占位符跨块串号
// - Responses content_index 缺失或为 0 时省略该段保持键形兼容;刻意不用 item_id
//   (部分中转实现 delta 与 .done 的 item_id 不齐,会让快照清理失配)
export type Envelope =
  | { type: "chat" }
  | { type: "anthropic"; base: string; deltaKind: "text" | "json" }
  | { type: "responses"; base: string | null; done: { field: string; channel: string } | null };

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function responsesKind(eventType: string): string | null {
  if (eventType.includes("output_text")) return "text";
  if (eventType.includes("reasoning")) return "reason";
  if (eventType.includes("function_call_arguments")) return "args";
  return null;
}

function responsesChannelBase(eventType: string, outputIndex: unknown, contentIndex: unknown): string | null {
  const kind = responsesKind(eventType);
  if (!kind) return null;
  const oi = isIndex(outputIndex) ? outputIndex : 0;
  const ci = typeof contentIndex === "number" && Number.isInteger(contentIndex) && contentIndex > 0 ? `.${contentIndex}` : "";
  return `r${oi}${ci}.${kind}`;
}

const RESPONSES_DONE: Record<string, { field: string; kind: string }> = {
  "response.output_text.done": { field: "text", kind: "text" },
  "response.reasoning_text.done": { field: "text", kind: "reason" },
  "response.function_call_arguments.done": { field: "arguments", kind: "args" },
};

export function classifyEnvelope(data: unknown): Envelope | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;

  if (Array.isArray(record.choices)) return { type: "chat" };

  if (typeof record.type === "string") {
    const eventType = record.type;
    if (eventType.startsWith("content_block_")) {
      const index = isIndex(record.index) ? record.index : 0;
      const deltaType = typeof record.delta === "object" && record.delta !== null
        ? (record.delta as Record<string, unknown>).type
        : undefined;
      const deltaKind = deltaType === "input_json_delta" ? "json" : "text";
      return { type: "anthropic", base: `b${index}`, deltaKind };
    }
    if (eventType.startsWith("response.")) {
      if (eventType in RESPONSES_DONE) {
        const done = RESPONSES_DONE[eventType]!;
        const oi = isIndex(record.output_index) ? record.output_index : 0;
        const ci = typeof record.content_index === "number" && Number.isInteger(record.content_index) && record.content_index > 0
          ? `.${record.content_index}`
          : "";
        return {
          type: "responses",
          base: null,
          done: { field: done.field, channel: `r${oi}${ci}.${done.kind}` },
        };
      }
      return { type: "responses", base: responsesChannelBase(eventType, record.output_index, record.content_index), done: null };
    }
  }

  return null;
}

// 事件叶子字符串 → 语义通道键;不命中返回 null(回退 JSON 路径)
export function semanticChannelKey(
  envelope: Envelope,
  data: Record<string, unknown>,
  segments: string[]
): string | null {
  if (envelope.type === "chat") {
    if (segments[0] !== "choices" || segments.length < 3) return null;
    const position = Number(segments[1]);
    if (!Number.isInteger(position)) return null;
    const choice = (data.choices as unknown[])[position];
    let index = position;
    if (choice && typeof choice === "object" && isIndex((choice as Record<string, unknown>).index)) {
      index = (choice as Record<string, unknown>).index as number;
    }
    return `c${index}.${segments.slice(2).join(".")}`;
  }
  if (envelope.type === "anthropic") {
    // 仅值承载字段进通道(delta.text / delta.partial_json);
    // delta.type 等元数据字符串若进同一通道,滞留半截占位符会经 lastPath 串写进别的字段
    const target = envelope.deltaKind === "json" ? "partial_json" : "text";
    if (segments.length === 2 && segments[0] === "delta" && segments[1] === target) {
      return `${envelope.base}.${envelope.deltaKind}`;
    }
    return null;
  }
  // responses:仅 delta 字段走通道;.done 快照由 snapshot 逻辑单独处理
  if (envelope.type === "responses") {
    if (envelope.base && segments[0] === "delta") return envelope.base;
    return null;
  }
  return null;
}

// 终态事件 → 需要立即 flush 的通道前缀;"all" 全部;null 非终态(maskit 终态通道级 flush)
export function terminalPrefixes(data: unknown, envelope: Envelope | null): "all" | string[] | null {
  if (!envelope || !data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  if (envelope.type === "chat") {
    const prefixes: string[] = [];
    const choices = Array.isArray(record.choices) ? record.choices : [];
    for (let position = 0; position < choices.length; position++) {
      const choice = choices[position];
      if (!choice || typeof choice !== "object") continue;
      if ((choice as Record<string, unknown>).finish_reason !== undefined && (choice as Record<string, unknown>).finish_reason !== null) {
        const c = choice as Record<string, unknown>;
        const index = isIndex(c.index) ? c.index : position;
        prefixes.push(`c${index}.`);
      }
    }
    return prefixes.length > 0 ? prefixes : null;
  }

  if (envelope.type === "anthropic") {
    const eventType = typeof record.type === "string" ? record.type : "";
    if (eventType === "content_block_stop") return [`${envelope.base}.`];
    if (eventType === "message_stop" || eventType === "message_delta") return "all";
    return null;
  }

  if (envelope.type === "responses") {
    const eventType = typeof record.type === "string" ? record.type : "";
    if (eventType === "response.completed" || eventType === "response.incomplete" || eventType === "response.failed") return "all";
    return null;
  }

  return null;
}
