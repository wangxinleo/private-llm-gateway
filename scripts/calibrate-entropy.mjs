// 自校准锚点：用留出语料 + 仓库英文文本 + 自然词拼接样本，产出"自然文本 FP≈1%"
// 的每长度阈值锚点（p99），并验证随机 hex/base62 召回阶梯；写入
// src/scanner/entropy-anchors.ts（含实测统计头）。不使用任何竞品常量。
// 用法：node scripts/calibrate-entropy.mjs [--corpus <path>]

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUCKETS,
  SYM_COUNT,
  buildIndex,
  buildTable,
  isHighEntropyBlock,
  isStandardHashHex,
  makeRng,
  randomBlock,
  scoreBlock,
  tokenize,
} from "./entropy-lib.mjs";

const CORPUS_URL = "https://www.gutenberg.org/files/1342/1342-0.txt";
const PERCENTILE = Number(process.env.ENTROPY_PCT || 0.999);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cachePath = resolve(root, "node_modules/.cache/entropy-corpus.txt");

function loadCorpus() {
  const argIdx = process.argv.indexOf("--corpus");
  if (argIdx !== -1) return readFileSync(resolve(process.argv[argIdx + 1]));
  if (existsSync(cachePath)) return readFileSync(cachePath);
  mkdirSync(dirname(cachePath), { recursive: true });
  const res = spawnSync("curl", ["-sSfL", CORPUS_URL]);
  if (res.status !== 0) throw new Error("corpus download failed; pass --corpus <path>");
  writeFileSync(cachePath, res.stdout);
  return res.stdout;
}

const corpus = loadCorpus().toString("utf8");
const table = buildTable(corpus);
const index = buildIndex();

// 0) 完整性：已生成的表文件必须与本次计算一致（防止手改生成物）
const generated = readFileSync(resolve(root, "src/scanner/entropy-table.ts"), "utf8");
const arrayBody = /ENTROPY_COST_TABLE: readonly number\[\] = \[([\s\S]*?)\];/.exec(generated)?.[1] ?? "";
const numbers = [...arrayBody.matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]));
if (numbers.length !== SYM_COUNT * SYM_COUNT) {
  throw new Error(`entropy-table.ts 解析失败: ${numbers.length} != ${SYM_COUNT * SYM_COUNT}`);
}
let maxDiff = 0;
for (let i = 0; i < numbers.length; i++) maxDiff = Math.max(maxDiff, Math.abs(numbers[i] - table[i]));
if (maxDiff > 1e-3) throw new Error(`entropy-table.ts 与重算表不一致(maxDiff=${maxDiff})`);
console.log(`integrity: entropy-table.ts 与重算一致 (maxDiff=${maxDiff.toExponential(2)})`);

// 1) 自然样本：语料后半（留出）+ 仓库英文文本 + 自然词拼接
const half = Math.floor(corpus.length / 2);
const holdoutTokens = tokenize(corpus.slice(half)).map((t) => t.value);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "data"].includes(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(md|ts|tsx|mjs|json)$/.test(name) && st.size < 512 * 1024) acc.push(p);
  }
  return acc;
}
const repoTokens = [];
const repoDocTokens = [];
for (const file of walk(root)) {
  const text = readFileSync(file, "utf8");
  if (/[\u4e00-\u9fff]/.test(text.slice(0, 2000))) continue; // 跳过中文为主的文件
  const toks = tokenize(text).map((t) => t.value);
  repoTokens.push(...toks);
  if (file.endsWith(".md")) repoDocTokens.push(...toks);
}

const vocab = [...new Set(holdoutTokens.map((w) => w.toLowerCase()).filter((w) => /^[a-z]{3,10}$/.test(w)))];
const rng = makeRng(20260921);
const concat = [];
for (const target of BUCKETS) {
  for (let i = 0; i < 300; i++) {
    let s = "";
    while (s.length < target) s += vocab[Math.floor(rng() * vocab.length)];
    concat.push(s.slice(0, target));
  }
}

// 校准池 = 自然语言（文学留出 token + 自然词拼接）；仓库文本（含代码/锁文件里的
// 随机片段）只作压力报告，不参与阈值标定——否则阈会被随机片段推到无意义的水平。
const natural = [...holdoutTokens, ...concat].filter((b) => b.length > 8 && !/^\d+$/.test(b));

// 2) 锚点：每桶窗口内自然样本分数 p99.5（原始值，不做单调钳制）
const anchors = [];
for (let bi = 0; bi < BUCKETS.length; bi++) {
  const lo = BUCKETS[bi];
  const hi = bi + 1 < BUCKETS.length ? BUCKETS[bi + 1] - 1 : 200;
  const scores = natural
    .filter((b) => b.length >= lo && b.length <= hi)
    .map((b) => scoreBlock(b, table, index))
    .sort((a, b) => a - b);
  const idx = Math.min(scores.length - 1, Math.max(0, Math.ceil(scores.length * PERCENTILE) - 1));
  anchors.push([lo, Number((scores[idx] ?? 6).toFixed(3))]);
}

// 3) 评估：FP（分类报告）与召回阶梯（含哈希守卫代价）
const fpRate = (samples) => {
  const pool = samples.filter((b) => b.length > 8);
  let fp = 0;
  for (const b of pool) if (isHighEntropyBlock(b, table, anchors, index)) fp++;
  return `${((fp / pool.length) * 100).toFixed(2)}% (${fp}/${pool.length})`;
};
console.log(`anchors: ${JSON.stringify(anchors)}`);
console.log(`FP holdout=${fpRate(holdoutTokens)}`);
console.log(`FP concat=${fpRate(concat)}`);
console.log(`FP repo-docs=${fpRate(repoDocTokens)}`);
console.log(`FP repo-all=${fpRate(repoTokens)}`);

const hits = repoTokens.filter((b) => b.length > 8 && isHighEntropyBlock(b, table, anchors, index));
const hashSkipped = repoTokens.filter((b) => isStandardHashHex(b)).length;
const byLen = {};
for (const h of hits) byLen[h.length] = (byLen[h.length] || 0) + 1;
console.log(`repo hits=${hits.length} (标准哈希守卫另跳过 ${hashSkipped} 个), 长度分布=${JSON.stringify(Object.fromEntries(Object.entries(byLen).sort((a, b) => a[0] - b[0])))}`);
console.log(`repo hits 样例: ${[...new Set(hits)].slice(0, 12).join("  ")}`);

const alphabets = {
  hex: "0123456789abcdef",
  base62: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
};
const recall = {};
for (const [name, alphabet] of Object.entries(alphabets)) {
  recall[name] = {};
  for (const len of [9, 12, 16, 24, 32, 40, 64]) {
    const r = makeRng(777 + len);
    let hit = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      if (isHighEntropyBlock(randomBlock(r, alphabet, len), table, anchors, index)) hit++;
    }
    recall[name][len] = Number(((hit / N) * 100).toFixed(1));
  }
}
console.log(`recall hex=${JSON.stringify(recall.hex)}`);
console.log(`recall base62=${JSON.stringify(recall.base62)}`);

// 4) 重复串守卫（多样性下限）
const repeats = ["aaaaaaaaaa", "abababababab", "abcabcabcabcabc", "000000000000", "ffffffffffffffff"];
const repeatFlagged = repeats.filter((b) => !isHighEntropyBlock(b, table, anchors, index));

// 5) 生成 entropy-anchors.ts
const lines = anchors.map(([len, t]) => `  [${len}, ${t}],`).join("\n");
const header = `// AUTO-GENERATED by scripts/calibrate-entropy.mjs — DO NOT EDIT BY HAND.
// 校准口径：锚点 = 自然样本（文学留出 token + 自然词拼接；仓库文本仅作压力报告）分数 p${PERCENTILE * 100}；
// 判定 = 长度>8 且非纯数字 且 非标准哈希(纯小写 hex@32/40/64/128) 且 多样性下限 且 score>阈值(线性插值)。
// 实测 FP: holdout=${fpRate(holdoutTokens)} | 自然词拼接=${fpRate(concat)} | 仓库文档=${fpRate(repoDocTokens)} | 仓库全部=${fpRate(repoTokens)}
// 实测召回 hex=${JSON.stringify(recall.hex)} | base62=${JSON.stringify(recall.base62)}（32/40/64 hex=0 为哈希守卫代价）
// 重复串守卫: ${repeatFlagged.length}/${repeats.length} 被拒

export const ENTROPY_ANCHORS: ReadonlyArray<readonly [number, number]> = [
${lines}
];`;

writeFileSync(resolve(root, "src/scanner/entropy-anchors.ts"), header + "\n");
console.log("written src/scanner/entropy-anchors.ts");
