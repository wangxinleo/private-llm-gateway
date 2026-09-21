import type { Finding } from "@/types";
import { scanSecrets, scanSecretPrefixes } from "./secrets";
import { scanContextKey, locateSensitiveHits } from "./context-key";
import { scanPii } from "./pii";
import { scanHighEntropy } from "./entropy";
import { CONTEXT_WINDOW_SIZE } from "@/config";

export const CONTEXT_WINDOW = CONTEXT_WINDOW_SIZE.value;

interface WindowAnchor {
  value: string;
  start: number;
  end: number;
}

export function sliceWindow(text: string, hit: WindowAnchor, radius: number = CONTEXT_WINDOW_SIZE.value): string {
  return text.slice(Math.max(0, hit.start - radius), Math.min(text.length, hit.end + radius));
}

export function scanContextWindows(text: string): Finding[] {
  const allFindings: Finding[] = [];
  const seen = new Set<string>();

  // 仅做"精确同值去重"(全量 pass 与窗口 pass 会重复命中同一值)。
  // 刻意不做按值子串吸收(F1,2026-09-21):位置盲的 includes 比较会把"短值在别处
  // 独立出现"的 finding 一并丢弃 → 该处明文上行。同位置嵌套/重叠由 applyMasks
  // 的合并交替(长度降序)在文本位置层面吸收,不需要在 finding 层做子串剪枝。
  const push = (findings: Finding[]) => {
    for (const f of findings) {
      if (seen.has(f.matched)) continue;
      seen.add(f.matched);
      allFindings.push(f);
    }
  };

  // 仅 PHONE/ID_CARD/BANK_CARD 全文扫描(用户确认保留);EMAIL 收窄到窗口锚点内
  push(scanPii(text).filter((f) => f.category !== "EMAIL"));

  // 无标签随机凭据(默认关):无锚点语义,按需全文扫描;关闭时 scanHighEntropy 内部门控短路
  push(scanHighEntropy(text));

  // 窗口锚点:敏感键值对(secret/encoded key=value);高风险资产白名单已下线
  const hits: WindowAnchor[] = locateSensitiveHits(text).map((h) => ({ value: h.value, start: h.start, end: h.end }));

  // 区间合并:相邻/重叠锚点的窗口合并为一次扫描。
  // 密集锚点(文件内容里连续 api_key=/token= 行)原本产生上百个高度重叠的窗口,
  // 对同一片文本反复跑 secrets/context-key;合并后扫描区域 = 窗口并集,隐私语义不变。
  const radius = CONTEXT_WINDOW_SIZE.value;
  const ranges = hits
    .map((h) => ({ lo: Math.max(0, h.start - radius), hi: Math.min(text.length, h.end + radius) }))
    .sort((a, b) => a.lo - b.lo);
  const merged: Array<{ lo: number; hi: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.lo <= last.hi) {
      last.hi = Math.max(last.hi, r.hi);
    } else {
      merged.push({ ...r });
    }
  }

  for (const range of merged) {
    const window = text.slice(range.lo, range.hi);
    push(scanPii(window).filter((f) => f.category === "EMAIL"));
    push(scanSecrets(window).filter((f) => f.category !== "BASIC_AUTH"));
    push(scanContextKey(window));
  }

  // 自定义前缀密文全文扫描(排在窗口扫描后:窗口内已有类别的值由 push 去重保留)
  push(scanSecretPrefixes(text));

  return allFindings;
}
