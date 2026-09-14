import type { Finding } from "@/types";
import { buildMaskTag } from "./mask-tag";
import { getWordsVersion, type CustomWordRow } from "@/words/store";
import { listWords } from "@/words/store";
import { Logger } from "@/log";

const log = new Logger("custom-words");

// 分类名 → 占位符短码:大写、剔非 [A-Z0-9]、截 12、空回退 TERM(maskit safe-label 规范)。
// 首字符必须是字母(TAG_RE 要求 [A-Z] 开头),否则整条回退 TERM,保证占位符可还原。
export function safeLabelShortCode(label: string): string {
  const stripped = label.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return /^[A-Z][A-Z0-9_]*$/.test(stripped) ? stripped : "TERM";
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeLiteral(word: string): string {
  return word.replace(REGEX_SPECIALS, "\\$&");
}

interface WordEntry {
  value: string;
  shortcode: string;
  boundary: boolean;
}

interface CompiledWords {
  version: number;
  wordRe: RegExp | null;
  wordMap: Map<string, string>;
  regexRules: Array<{ re: RegExp; shortcode: string }>;
}

let cache: CompiledWords = { version: -1, wordRe: null, wordMap: new Map(), regexRules: [] };

// 边界语义(纠偏):只对字母/数字设界,CJK 邻接不设界——中文无分词,
// 若对 CJK 设界则单字/整词在连续中文里永不命中,词库失去意义。
// 单字词必须加字母数字边界,避免命中英文单词内部;whole_word 同理(主要约束拉丁词)。
function buildAlternative(entry: WordEntry): string {
  const literal = escapeLiteral(entry.value);
  if (!entry.boundary) return `(?:${literal})`;
  return `(?<![A-Za-z0-9])(?:${literal})(?![A-Za-z0-9])`;
}

function compile(words: CustomWordRow[]): CompiledWords {
  const entries: WordEntry[] = [];
  const regexRules: CompiledWords["regexRules"] = [];
  const seenWords = new Set<string>();

  for (const row of words) {
    const shortcode = safeLabelShortCode(row.label);
    if (row.kind === "regex") {
      // 非法正则跳过并告警,绝不让 mask 链路 503(maskit 教训)
      try {
        regexRules.push({ re: new RegExp(row.value, "gu"), shortcode });
      } catch (err) {
        log.warn(`skipping invalid custom regex #${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }
    const value = row.value;
    if (!value || seenWords.has(value)) continue;
    seenWords.add(value);
    const wholeWord = row.whole_word === 1;
    // 单字词(按 Unicode 码点)强制边界,多字词仅在 whole_word 时加边界
    const boundary = wholeWord || [...value].length === 1;
    entries.push({ value, shortcode, boundary });
  }

  // 长词优先:合并 alternation 时按长度降序,保证同一位置长词先命中
  entries.sort((a, b) => b.value.length - a.value.length);

  let wordRe: RegExp | null = null;
  if (entries.length > 0) {
    const alternation = entries.map(buildAlternative).join("|");
    try {
      wordRe = new RegExp(alternation, "gu");
    } catch (err) {
      log.error(`failed to compile combined word regex: ${err instanceof Error ? err.message : String(err)}`);
      wordRe = null;
    }
  }

  return { version: getWordsVersion(), wordRe, wordMap: new Map(entries.map((e) => [e.value, e.shortcode])), regexRules };
}

function getCompiled(): CompiledWords {
  const version = getWordsVersion();
  if (cache.version !== version) {
    cache = compile(listWords().filter((row) => row.enabled === 1));
  }
  return cache;
}

function toFinding(matched: string, shortcode: string): Finding {
  const category = "CUSTOM_TERM";
  return {
    category,
    action: "mask",
    matched,
    maskTag: buildMaskTag(category),
    shortCode: shortcode,
  };
}

export function scanCustomWords(text: string): Finding[] {
  const compiled = getCompiled();
  const findings: Finding[] = [];

  if (compiled.wordRe) {
    compiled.wordRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = compiled.wordRe.exec(text)) !== null) {
      const matched = m[0];
      if (matched.length === 0) {
        compiled.wordRe.lastIndex += 1;
        continue;
      }
      const shortcode = compiled.wordMap.get(matched) ?? "TERM";
      findings.push(toFinding(matched, shortcode));
    }
  }

  for (const { re, shortcode } of compiled.regexRules) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      findings.push(toFinding(m[0], shortcode));
    }
  }

  return findings;
}
