import type { Finding } from "@/types";
import { isRuleEnabled } from "@/config";
import { buildMaskTag } from "./mask-tag";
import { ENTROPY_ANCHORS } from "./entropy-anchors";
import { ENTROPY_COST_TABLE, ENTROPY_SYMBOL_COUNT } from "./entropy-table";

// 无标签随机凭据检测（默认关，见 config.DEFAULT_RULE_TOGGLES）。
// 算法与常量均为自算（scripts/gen-entropy-table.mjs + scripts/calibrate-entropy.mjs）：
// 英文 bigram 交叉熵代价表 + 长度插值阈值 + 多样性下限 + 标准哈希守卫。
// 已知边界（spec 有记录）：hash/标识符/压缩内容/非英文转写可能误报；被分隔符拆开的凭据会漏检。

const SYM_HASH = 26;
const SYM_CARET = 27;
const SYM_DOLLAR = 28;
const SYM_COUNT = ENTROPY_SYMBOL_COUNT;

// 生成物完整性：表维度不符会让评分静默退化为 NaN，宁可显式失败（测试/构建即暴露）
if (ENTROPY_COST_TABLE.length !== SYM_COUNT * SYM_COUNT) {
  throw new Error(
    `entropy-table.ts 维度错误: ${ENTROPY_COST_TABLE.length} != ${SYM_COUNT * SYM_COUNT}（运行 scripts/gen-entropy-table.mjs 重新生成）`
  );
}

// 单块长度上限：超长连续块（多在 base64 大 blob 内）跳过，避免把二进制/长编码当凭据
const MAX_BLOCK_LENGTH = 256;
// 标准哈希长度（md5/sha1/sha256/sha512）：纯小写 hex 且恰为该长度 → 判为哈希，不脱敏
const HASH_LIKE_LENGTHS = new Set([32, 40, 64, 128]);

const SYMBOL_INDEX = (() => {
  const index = new Uint8Array(128).fill(255);
  for (let i = 0; i < 26; i++) index[97 + i] = i;
  for (let d = 48; d <= 57; d++) index[d] = SYM_HASH;
  return index;
})();

const COST = Float64Array.from(ENTROPY_COST_TABLE);

// 复用位图做多样性统计（避免每块分配 Set）
const seenSymbols = new Uint8Array(128);
const touched: number[] = [];

function scoreBlock(block: string): number {
  const s = block.toLowerCase();
  let prev = SYM_CARET;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const sym = code < 128 ? SYMBOL_INDEX[code]! : 255;
    if (sym === 255) return 0;
    bits += COST[prev * SYM_COUNT + sym]!;
    prev = sym;
  }
  bits += COST[prev * SYM_COUNT + SYM_DOLLAR]!;
  return bits / (s.length + 1);
}

function diversityOk(block: string): boolean {
  const s = block.toLowerCase();
  const need = Math.min(6, Math.max(3, Math.ceil(s.length * 0.4)));
  let distinct = 0;
  touched.length = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 128) return false;
    if (seenSymbols[code] === 0) {
      seenSymbols[code] = 1;
      touched.push(code);
      distinct += 1;
      if (distinct >= need) break;
    }
  }
  for (const code of touched) seenSymbols[code] = 0;
  return distinct >= need;
}

function isStandardHashHex(block: string): boolean {
  if (!HASH_LIKE_LENGTHS.has(block.length)) return false;
  for (let i = 0; i < block.length; i++) {
    const code = block.charCodeAt(i);
    const isHex = (code >= 48 && code <= 57) || (code >= 97 && code <= 102);
    if (!isHex) return false;
  }
  return true;
}

function thresholdFor(len: number): number {
  const anchors = ENTROPY_ANCHORS;
  if (len <= anchors[0]![0]) return anchors[0]![1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [l1, t1] = anchors[i]!;
    const [l2, t2] = anchors[i + 1]!;
    if (len >= l1 && len <= l2) return t1! + ((t2! - t1!) * (len - l1)) / (l2 - l1);
  }
  return anchors[anchors.length - 1]![1];
}

export function isHighEntropyBlock(block: string): boolean {
  const len = block.length;
  if (len <= 8 || len > MAX_BLOCK_LENGTH) return false;
  if (isStandardHashHex(block)) return false;
  if (!diversityOk(block)) return false;
  return scoreBlock(block) > thresholdFor(len);
}

export function scanHighEntropy(text: string): Finding[] {
  if (!isRuleEnabled("HIGH_ENTROPY")) return [];
  const findings: Finding[] = [];
  const re = /[A-Za-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[0];
    const len = value.length;
    if (len <= 8 || len > MAX_BLOCK_LENGTH) continue;
    if (isStandardHashHex(value)) continue;
    if (!diversityOk(value)) continue;
    if (scoreBlock(value) > thresholdFor(len)) {
      findings.push({ category: "HIGH_ENTROPY", action: "mask", matched: value, maskTag: buildMaskTag("HIGH_ENTROPY") });
    }
  }
  return findings;
}
