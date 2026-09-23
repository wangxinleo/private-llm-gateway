import { PRIVACY_NOTICE_TEXT } from "@/config";
import { CATEGORY_SHORTCODES, TAG_RE } from "./mask-tag";

// 容忍形态检测:计数面不得窄于修复面(maskit 教训——{{ EMAIL_x }} 加空格、
// {{email_x}} 小写标签全漏会导致「页面满屏未还原、事件页只报 1」)。
// 形态与 LOOSE_RX 同宽:2 重花括号 / 1 重花括号 / 裸 token;空白只作为
// 花括号内衬消耗(裸 token 不吞邻接空白)
const TAG_CORE = "[A-Za-z][A-Za-z0-9_]*_[bcdfghjkmnpqrstvwxzBCDFGHJKMNPQRSTVWXZ]{5}";
const RESIDUAL_TAG_RX = new RegExp(
  `\\{\\{?\\s?${TAG_CORE}\\s?\\}?\\}|\\{\\{?\\s?${TAG_CORE}|${TAG_CORE}`,
  "g"
);

const KNOWN_LABELS: ReadonlySet<string> = new Set(Object.values(CATEGORY_SHORTCODES));

const SUFFIX_RE = /^[bcdfghjkmnpqrstvwxzBCDFGHJKMNPQRSTVWXZ]{5}$/;

// 形态归一:去花括号/空白,标签大写,后缀原样;返回我们的规范标签或 null
export function canonicalTag(raw: string): string | null {
  const core = raw.replace(/^\{+/, "").replace(/\}+$/, "").trim();
  const idx = core.lastIndexOf("_");
  if (idx <= 0) return null;
  const label = core.slice(0, idx).toUpperCase();
  const suffix = core.slice(idx + 1);
  if (!SUFFIX_RE.test(suffix)) return null;
  if (!KNOWN_LABELS.has(label)) return null;
  return `{{${label}_${suffix}}}`;
}

// notice 自带的示例占位符(模型回显 notice 属常态):按归一形态豁免,
// 否则真实占位符残留会淹没在例行假警报里
const NOTICE_EXAMPLE_TAGS: ReadonlySet<string> = new Set(
  [...PRIVACY_NOTICE_TEXT.matchAll(new RegExp(TAG_RE.source, "g"))]
    .map((m) => canonicalTag(m[0]!))
    .filter((tag): tag is string => tag !== null)
);

export function isNoticeExampleTag(canonical: string): boolean {
  return NOTICE_EXAMPLE_TAGS.has(canonical);
}

export interface ResidualPlaceholders {
  count: number;
  samples: string[];
}

const MAX_SAMPLES = 5;
const MAX_SAMPLE_LEN = 40;

// 扫描「还原后输出」:仍呈占位符形态者即未还原(含容忍形态)。
// 单遍扫描天然不双计;samples 只含 token 本身,不含任何明文。
export function findResidualPlaceholders(text: string): ResidualPlaceholders {
  const samples: string[] = [];
  let count = 0;
  for (const match of text.matchAll(RESIDUAL_TAG_RX)) {
    const canonical = canonicalTag(match[0]);
    if (canonical === null || isNoticeExampleTag(canonical)) continue;
    count += 1;
    if (samples.length < MAX_SAMPLES) {
      const sample = match[0].slice(0, MAX_SAMPLE_LEN);
      if (!samples.includes(sample)) samples.push(sample);
    }
  }
  return { count, samples };
}
