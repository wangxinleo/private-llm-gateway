// 共享库：符号化、tokenize、bigram 计数与代价表、评分、阈值插值、多样性下限、样本生成。
// 供 gen-entropy-table.mjs 与 calibrate-entropy.mjs 复用；运行时不依赖本文件
// （src/scanner/entropy.ts 内联等价实现，避免 scripts 参与构建）。

export const SYM_COUNT = 29; // a-z(0-25) + '#'(26 数字类) + '^'(27) + '$'(28)
export const ALPHA = 0.1;

export function buildIndex() {
  const idx = new Uint8Array(128).fill(255);
  for (let i = 0; i < 26; i++) idx[97 + i] = i;
  for (let d = 48; d <= 57; d++) idx[d] = 26;
  return idx;
}

export function symbolOfChar(code, index) {
  return code < 128 ? index[code] : 255;
}

/** 统计 bigram 计数：lowercase；数字并入 '#'；其余字符作分隔；含 ^/$ 边界 */
export function countBigrams(text, index = buildIndex()) {
  const counts = Array.from({ length: SYM_COUNT }, () => new Float64Array(SYM_COUNT));
  const lower = text.toLowerCase();
  let tokenStart = -1;
  const flush = (end) => {
    if (tokenStart === -1) return;
    const token = lower.slice(tokenStart, end);
    tokenStart = -1;
    if (!token) return;
    const syms = [];
    for (let i = 0; i < token.length; i++) {
      const sym = symbolOfChar(token.charCodeAt(i), index);
      if (sym === 255) return;
      syms.push(sym);
    }
    if (syms.length === 0) return;
    counts[27][syms[0]] += 1;
    for (let i = 0; i + 1 < syms.length; i++) counts[syms[i]][syms[i + 1]] += 1;
    counts[syms[syms.length - 1]][28] += 1;
  };
  for (let i = 0; i < lower.length; i++) {
    const sym = symbolOfChar(lower.charCodeAt(i), index);
    if (sym === 255) flush(i);
    else if (tokenStart === -1) tokenStart = i;
  }
  flush(lower.length);
  return counts;
}

/** add-α 平滑 → cost = -log2(P(ch|prev)) */
export function buildTable(text, alpha = ALPHA) {
  const index = buildIndex();
  const counts = countBigrams(text, index);
  const table = new Float64Array(SYM_COUNT * SYM_COUNT);
  for (let prev = 0; prev < SYM_COUNT; prev++) {
    let rowTotal = 0;
    for (let ch = 0; ch < SYM_COUNT; ch++) rowTotal += counts[prev][ch];
    if (rowTotal === 0) continue;
    for (let ch = 0; ch < SYM_COUNT; ch++) {
      const p = (counts[prev][ch] + alpha) / (rowTotal + alpha * SYM_COUNT);
      table[prev * SYM_COUNT + ch] = -Math.log2(p);
    }
  }
  return table;
}

/** [A-Za-z0-9]+ 块；len>8；排除纯数字；保留偏移 */
export function tokenize(text) {
  const out = [];
  const re = /[A-Za-z0-9]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = m[0];
    if (value.length <= 8) continue;
    if (/^\d+$/.test(value)) continue;
    out.push({ value, start: m.index, end: m.index + value.length });
  }
  return out;
}

export function scoreBlock(block, table, index = buildIndex()) {
  const s = block.toLowerCase();
  let prev = 27;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const sym = symbolOfChar(s.charCodeAt(i), index);
    if (sym === 255) return 0;
    bits += table[prev * SYM_COUNT + sym];
    prev = sym;
  }
  bits += table[prev * SYM_COUNT + 28];
  return bits / (s.length + 1);
}

/** 自有多样性下限：拒绝 aaaa…/abab… 类重复串 */
export function diversityOk(block) {
  const lower = block.toLowerCase();
  const distinct = new Set(lower).size;
  const need = Math.min(6, Math.max(3, Math.ceil(lower.length * 0.4)));
  return distinct >= need;
}

/**
 * 标准哈希守卫（已声明边界，见 spec）：纯小写 hex 且长度恰为 md5/sha1/sha256/sha512
 * （32/40/64/128）→ 判为哈希而非凭据，跳过。代码/锁文件里的哈希是最大误报源，
 * 且与"随机 hex 凭据"在统计上不可区分，必须用长度形状排除；其它长度/大小写形态照常检测。
 */
export const HASH_LIKE_LENGTHS = new Set([32, 40, 64, 128]);
export function isStandardHashHex(block) {
  return HASH_LIKE_LENGTHS.has(block.length) && /^[0-9a-f]+$/.test(block);
}

/** 完整判定：长度/纯数字 → 哈希守卫 → 多样性下限 → 阈值 */
export function isHighEntropyBlock(block, table, anchors, index = buildIndex()) {
  const len = block.length;
  if (len <= 8 || /^\d+$/.test(block)) return false;
  if (isStandardHashHex(block)) return false;
  if (!diversityOk(block)) return false;
  return scoreBlock(block, table, index) > thresholdFor(len, anchors);
}

export function thresholdFor(len, anchors) {
  if (len <= anchors[0][0]) return anchors[0][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [l1, t1] = anchors[i];
    const [l2, t2] = anchors[i + 1];
    if (len >= l1 && len <= l2) return t1 + ((t2 - t1) * (len - l1)) / (l2 - l1);
  }
  return anchors[anchors.length - 1][1];
}

export const BUCKETS = [9, 10, 11, 12, 13, 16, 20, 24, 32, 40, 48, 64, 80, 96, 112, 128];

/** 固定种子 LCG，保证样本可复现 */
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function randomBlock(rng, alphabet, length) {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}
