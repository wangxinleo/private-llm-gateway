import type { MaskRegistry } from "@/scanner/mask-registry";
import { LOOSE_RX, MAX_TAG_LEN, TAG_PARTIAL_RE, TAG_RE } from "@/scanner/mask-tag";
import { classifyEnvelope, semanticChannelKey, terminalPrefixes, type Envelope } from "./restore-channels";

const STRICT_TAG_GLOBAL = new RegExp(TAG_RE.source, "g");
const STRICT_TAG_STICKY = new RegExp(TAG_RE.source, "y");

export interface RestoreStats {
  degraded: number;
}

export function restoreText(text: string, registry: MaskRegistry, stats?: RestoreStats): string {
  const tags = registry.tagToValue;
  const strict = text.replace(STRICT_TAG_GLOBAL, (tag) => tags.get(tag) ?? tag);
  return strict.replace(LOOSE_RX, (match) => {
    const core = match.replace(/^\{+/, "").replace(/\}+$/, "");
    const value = tags.get(`{{${core}}}`);
    if (value === undefined) return match;
    if (stats) stats.degraded += 1;
    return value;
  });
}

interface ChannelState {
  pending: string;
  lastFrame?: unknown;
  lastPath?: string[];
}

export class SseChannelRestorer {
  private buffer = "";
  private readonly channels = new Map<string, ChannelState>();
  private readonly stats: RestoreStats = { degraded: 0 };
  // 当前帧内已独立还原的 .done 快照字段路径(restoreDeep 跳过其通道缓冲)
  private freshPaths: string[][] = [];

  constructor(private readonly registry: MaskRegistry) {}

  getDegraded(): number {
    return this.stats.degraded;
  }

  pushBytes(text: string): string {
    this.buffer += text;
    let out = "";
    for (;;) {
      const sep = this.buffer.indexOf("\n\n");
      if (sep === -1) break;
      const frame = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      out += this.restoreFrame(frame) + "\n\n";
    }
    return out;
  }

  flush(): string {
    return this.flushMatching("all");
  }

  private flushMatching(matcher: "all" | string[]): string {
    let out = "";
    for (const [key, ch] of this.channels.entries()) {
      if (matcher !== "all" && !matcher.some((prefix) => key.startsWith(prefix))) continue;
      if (!ch.pending || ch.lastFrame === undefined || !ch.lastPath) continue;
      // 单通道异常不丢字:还原失败时原样补发已扣留文本(maskit 教训)
      let residual: string;
      try {
        residual = restoreText(ch.pending, this.registry, this.stats);
      } catch {
        residual = ch.pending;
      }
      ch.pending = "";
      let evt = "";
      try {
        const clone = structuredClone(ch.lastFrame);
        if (setByPath(clone, ch.lastPath, residual)) {
          evt = `data: ${JSON.stringify(clone)}\n\n`;
        }
      } catch {
        evt = "";
      }
      // 模板不可用时退化为裸文本,至少不丢字
      if (!evt && residual) evt = residual;
      out += evt;
    }
    return out;
  }

  private dropChannel(key: string): void {
    this.channels.delete(key);
  }

  private restoreFrame(frame: string): string {
    const lines = frame.split("\n");
    const dataLineIndexes: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.startsWith("data:")) dataLineIndexes.push(i);
    }
    if (dataLineIndexes.length === 0) return frame;
    // SSE 规范:同帧多行 data 以 \n 连接
    const payload = dataLineIndexes.map((i) => (lines[i] ?? "").slice(5)).join("\n");
    if (payload.trimStart() === "[DONE]") return frame;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return frame;
    }
    if (!parsed || typeof parsed !== "object") return frame;
    const record = parsed as Record<string, unknown>;

    const envelope = classifyEnvelope(parsed);

    // Responses .done 快照:整树替换语义——快照文本独立还原(不经增量通道缓冲),
    // 随后丢弃该通道的滞留尾与模板,流尾不得再补发 delta(maskit 0bc1ea7)
    let freshPaths: string[][] = [];
    if (envelope?.type === "responses" && envelope.done) {
      const snapshot = record[envelope.done.field];
      if (typeof snapshot === "string") {
        record[envelope.done.field] = restoreText(snapshot, this.registry, this.stats);
        freshPaths = [[envelope.done.field]];
        this.dropChannel(envelope.done.channel);
      }
    }
    this.freshPaths = freshPaths;

    const touched = new Set<string>();
    const restored = this.restoreDeep(parsed, "", [], envelope, record, touched);
    for (const key of touched) {
      const ch = this.channels.get(key);
      if (ch) ch.lastFrame = restored;
    }
    this.freshPaths = [];

    // 终态事件通道级 flush:先还原本帧最终文本,再按归属前缀补发滞留半截占位符。
    // 补发帧前加帧分隔,避免与当前帧同行破坏 SSE 解析
    const terminal = terminalPrefixes(parsed, envelope);
    const flushed = terminal ? this.flushMatching(terminal) : "";

    // 重建帧:保留 event:/注释等行,仅替换 data 行(Anthropic/Responses 带 event: 前缀)
    const outLines: string[] = [];
    let inserted = false;
    for (let i = 0; i < lines.length; i++) {
      const isData = dataLineIndexes.includes(i);
      if (isData) {
        if (!inserted) {
          outLines.push(`data: ${JSON.stringify(restored)}`);
          inserted = true;
        }
        continue;
      }
      outLines.push(lines[i] ?? "");
    }
    return outLines.join("\n") + (flushed ? "\n\n" + flushed : "");
  }

  private restoreDeep(
    value: unknown,
    path: string,
    segments: string[],
    envelope: Envelope | null,
    root: Record<string, unknown>,
    touched: Set<string>
  ): unknown {
    if (typeof value === "string") {
      // .done 快照字段已独立还原,跳过通道缓冲
      if (this.freshPaths.some((p) => p.join(".") === segments.join("."))) {
        return value;
      }
      const key = (envelope && semanticChannelKey(envelope, root, segments)) || path;
      touched.add(key);
      return this.restoreChannel(key, value, segments);
    }
    if (Array.isArray(value)) {
      return value.map((item, i) =>
        this.restoreDeep(item, path ? `${path}.${i}` : `${i}`, [...segments, `${i}`], envelope, root, touched)
      );
    }
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(value)) {
        out[k] = this.restoreDeep(child, path ? `${path}.${k}` : k, [...segments, k], envelope, root, touched);
      }
      return out;
    }
    return value;
  }

  private restoreChannel(key: string, text: string, segments: string[]): string {
    let ch = this.channels.get(key);
    if (!ch) {
      ch = { pending: "" };
      this.channels.set(key, ch);
    }
    ch.lastPath = segments;
    ch.pending += text;
    return this.drain(ch);
  }

  private drain(ch: ChannelState): string {
    let out = "";
    let pending = ch.pending;
    for (;;) {
      if (!pending) break;
      const anchor = pending.indexOf("{{");
      if (anchor === -1) {
        if (pending.endsWith("{")) {
          out += pending.slice(0, -1);
          pending = "{";
        } else {
          out += pending;
          pending = "";
        }
        break;
      }
      if (anchor > 0) {
        out += pending.slice(0, anchor);
        pending = pending.slice(anchor);
      }
      STRICT_TAG_STICKY.lastIndex = 0;
      const strict = STRICT_TAG_STICKY.exec(pending);
      if (strict) {
        const tag = strict[0];
        const value = this.registry.tagToValue.get(tag);
        out += value !== undefined ? value : tag;
        pending = pending.slice(tag.length);
        continue;
      }
      if (pending.length <= MAX_TAG_LEN && TAG_PARTIAL_RE.test(pending)) break;
      out += pending[0];
      pending = pending.slice(1);
    }
    ch.pending = pending;
    return out;
  }
}

function setByPath(root: unknown, segments: string[], value: string): boolean {
  let node = root;
  for (let i = 0; i < segments.length - 1; i++) {
    if (node === null || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[segments[i]!];
  }
  if (node === null || typeof node !== "object") return false;
  (node as Record<string, unknown>)[segments[segments.length - 1]!] = value;
  return true;
}
