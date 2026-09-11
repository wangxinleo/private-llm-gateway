import type { MaskRegistry } from "@/scanner/mask-registry";
import { LOOSE_RX, MAX_TAG_LEN, TAG_PARTIAL_RE, TAG_RE } from "@/scanner/mask-tag";

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
    let out = "";
    for (const ch of this.channels.values()) {
      if (!ch.pending || ch.lastFrame === undefined || !ch.lastPath) continue;
      const residual = restoreText(ch.pending, this.registry, this.stats);
      ch.pending = "";
      const clone = structuredClone(ch.lastFrame);
      if (!setByPath(clone, ch.lastPath, residual)) continue;
      out += `data: ${JSON.stringify(clone)}\n\n`;
    }
    return out;
  }

  private restoreFrame(frame: string): string {
    if (!frame.startsWith("data:")) return frame;
    const payload = frame.slice(5);
    if (payload.trimStart() === "[DONE]") return frame;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return frame;
    }
    const visited: Array<{ path: string; segments: string[] }> = [];
    const restored = this.restoreDeep(parsed, "", [], visited);
    for (const { path, segments } of visited) {
      const ch = this.channels.get(path);
      if (ch) {
        ch.lastFrame = restored;
        ch.lastPath = segments;
      }
    }
    return `data: ${JSON.stringify(restored)}\n\n`;
  }

  private restoreDeep(
    value: unknown,
    path: string,
    segments: string[],
    visited: Array<{ path: string; segments: string[] }>
  ): unknown {
    if (typeof value === "string") {
      visited.push({ path, segments });
      return this.restoreChannel(path, value);
    }
    if (Array.isArray(value)) {
      return value.map((item, i) =>
        this.restoreDeep(item, path ? `${path}.${i}` : `${i}`, [...segments, `${i}`], visited)
      );
    }
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = this.restoreDeep(child, path ? `${path}.${key}` : key, [...segments, key], visited);
      }
      return out;
    }
    return value;
  }

  private restoreChannel(path: string, text: string): string {
    let ch = this.channels.get(path);
    if (!ch) {
      ch = { pending: "" };
      this.channels.set(path, ch);
    }
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
    node = (node as Record<string, unknown>)[segments[i]];
  }
  if (node === null || typeof node !== "object") return false;
  (node as Record<string, unknown>)[segments[segments.length - 1]] = value;
  return true;
}
