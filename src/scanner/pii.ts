import type { Finding } from "@/types";
import { buildMaskTag, TAG_RE } from "./mask-tag";
import type { MaskRegistry } from "./mask-registry";
import { isRuleEnabled } from "@/config";

// PII 正则都加边界前缀,避免长串(base64/token/时间戳)内子串误匹配,
// 同时消除贪婪匹配失败的 O(n²) 回溯(真实 1.18MB 请求 scanPii 1062ms 的根因)
const PHONE_RE = /(?<!\d)1[3-9]\d{9}/g;
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ID_CARD_RE = /(?<!\d)\d{17}[\dXx]/g;
const BANK_CARD_RE = /(?<!\d)\d{16,19}/g;
const LANDLINE_RE = /(?<![\d-])0\d{2,3}-?\d{7,8}(?:-\d{1,5})?(?![\d-])/g;
const PLATE_RE = /(?<![A-Za-z0-9])[京津沪渝冀晋辽吉黑苏浙皖闽赣鲁豫鄂湘粤桂琼川贵云陕甘青蒙藏宁新使][A-HJ-NP-Z][A-HJ-NP-Z0-9]{5,6}挂?学?警?港?澳?(?![A-Za-z0-9])/g;
const IPV4_RE = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g;
const IBAN_RE = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}[A-Z0-9]{11,30}(?![A-Za-z0-9])/g;
const USCC_RE = /(?<![0-9A-Za-z])[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}(?![0-9A-Za-z])/g;
const MAC_RE = /(?<![0-9A-Fa-f:.-])(?:[0-9A-Fa-f]{2}([-:]))(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:.-])/gi;
const HKID_RE = /(?<![A-Za-z0-9])[A-HJ-NP-Z]{1,2}\d{6}(?:\([0-9A]\)|[0-9A])?(?![A-Za-z0-9])/g;

// 内网 IPv6(默认关):宽候选段 + 结构化子匹配 + 语义校验。
// - 宽段 `[0-9A-Fa-f:]{2,45}` 先切出含冒号 hex 片段,再在段内从左到右用
//   结构化正则 sticky 匹配,避免贪婪候选吞掉后续地址(maskit 同款宽正则会被
//   `IPV6:fe80::1` 前缀的 `6:` 整段吃掉,校验不过就漏检);
// - 起始边界:段首要求外部非 hex/非点,段内起点必须紧跟 `:`——键值形态
//   `IPV6:fe80::1` / `gateway:fd00::5` 可命中,长 hex 串内部不会误切;
// - 只放行 fe80::/10(链路本地)与 fc00::/7(ULA)。刻意不用 is_private:
//   它把 2001:db8::/32 文档段、::1 环回也当私网,会误脱公网讨论文本(maskit 实测)。
const IPV6_RUN_RE = /[0-9A-Fa-f:]{2,45}/g;
const HEX_CHAR_RE = /[0-9A-Fa-f]/;
// 结构化形态:8 组全写 / 压缩(含尾组优先于纯尾 `::`)/ 尾部 `::`;zone 后缀可选
const IPV6_ADDR_RE = new RegExp(
  "(?:" +
    [
      "(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}",
      "(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}",
      "(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}",
      "(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}",
      "(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}",
      "(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}",
      "[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}",
      "(?:[0-9A-Fa-f]{1,4}:){1,7}:",
    ].join("|") +
    ")(?:%[0-9A-Za-z._-]+)?",
  "y"
);
// 预过滤(必要条件):含冒号且含私网首组前缀 fe8x/fe9x/feax/febx 或 fc/fd。
// 大小写不敏感(fe80::1 / Fe80::1 / FE80::1 一致);用 ':' 单独做特征会在
// 任意 URL/JSON 上全量跑宽正则,故前缀必须参与(maskit 大小写静默跳过教训)。
const IPV6_PREFIX_RE = /[fF][eE][89aAbB]|[fF][cCdD]/;

function ipv6Prefilter(text: string): boolean {
  return text.includes(":") && IPV6_PREFIX_RE.test(text);
}

function ipv6PrivateOk(addr: string): boolean {
  const clean = addr.split("%", 1)[0] ?? "";
  if (!clean.includes(":")) return false;
  const parts = clean.split("::");
  if (parts.length > 2) return false;
  const head = parts[0] ? (parts[0] as string).split(":") : [];
  const tail = parts.length === 2 && parts[1] ? (parts[1] as string).split(":") : [];
  if (parts.length === 1 && head.length !== 8) return false;
  if (parts.length === 2 && head.length + tail.length > 7) return false;
  for (const group of [...head, ...tail]) {
    if (!/^[0-9A-Fa-f]{1,4}$/.test(group)) return false;
  }
  const first = parseInt(head[0] ?? "0", 16);
  return (first >= 0xfe80 && first <= 0xfebf) || (first >= 0xfc00 && first <= 0xfdff);
}

function findIpv6Private(text: string): string[] {
  const out: string[] = [];
  IPV6_RUN_RE.lastIndex = 0;
  let run: RegExpExecArray | null;
  while ((run = IPV6_RUN_RE.exec(text)) !== null) {
    const seg = run[0];
    const segStart = run.index;
    const boundaryBeforeOk =
      segStart === 0 || (text[segStart - 1] !== "." && !HEX_CHAR_RE.test(text[segStart - 1] as string));
    for (let i = 0; i < seg.length; i++) {
      if (!HEX_CHAR_RE.test(seg[i] as string)) continue;
      if (i === 0 ? !boundaryBeforeOk : seg[i - 1] !== ":") continue;
      IPV6_ADDR_RE.lastIndex = segStart + i;
      const m = IPV6_ADDR_RE.exec(text);
      if (!m || m.index !== segStart + i) continue;
      if (ipv6PrivateOk(m[0])) {
        out.push(m[0]);
        break;
      }
    }
  }
  return out;
}

function idCardCheck(num: string): boolean {
  if (num.length !== 18) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkCodes = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const d = parseInt(num[i] ?? "", 10);
    if (Number.isNaN(d)) return false;
    sum += d * (weights[i] ?? 0);
  }
  const expected = checkCodes[sum % 11];
  return expected?.toUpperCase() === (num[17] ?? "").toUpperCase();
}

function luhnCheck(num: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    const d = parseInt(num[i] ?? "0", 10);
    if (alt) {
      const doubled = d * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += d;
    }
    alt = !alt;
  }
  return sum % 10 === 0;
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return parts;
}

function isIpPrivate(ip: string): boolean {
  const parts = parseIpv4(ip);
  if (!parts) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isIpInternal(ip: string): boolean {
  const parts = parseIpv4(ip);
  if (!parts) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function landlineCheck(num: string): boolean {
  const segs = num.split("-");
  if (segs.length > 3) return false;
  if (segs.length === 3 && !/^\d{1,5}$/.test(segs[2] ?? "")) return false;
  // main = 区号(3-4 位) + 本地号(7-8 位),去分隔线后按长度组合校验;本地号首位 2-9
  const main = segs.slice(0, Math.min(2, segs.length)).join("-").replace(/-/g, "");
  if (main.length < 10 || main.length > 12) return false;
  for (const areaLen of [3, 4]) {
    if (main.length !== areaLen + 7 && main.length !== areaLen + 8) continue;
    const area = main.slice(0, areaLen);
    const local = main.slice(areaLen);
    // 真实区号形态:010 / 02x(3 位) 或 0[3-9]xx(4 位)
    const validArea = areaLen === 3 ? /^(010|02\d)$/.test(area) : /^0[3-9]\d{2}$/.test(area);
    if (!validArea) continue;
    if (local[0] && local[0] >= "2" && local[0] <= "9") return true;
  }
  return false;
}

function plateCheck(plate: string): boolean {
  return /\d/.test(plate);
}

// IBAN mod-97(ISO 13616):重排 + 字母转数 + 取模
function ibanCheck(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    if (ch >= "A" && ch <= "Z") {
      const value = ch.charCodeAt(0) - "A".charCodeAt(0) + 10;
      remainder = (remainder * 100 + value) % 97;
    } else if (ch >= "0" && ch <= "9") {
      remainder = (remainder * 10 + Number(ch)) % 97;
    } else {
      return false;
    }
  }
  return remainder === 1;
}

const USCC_CHARSET = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

function usccCheck(uscc: string): boolean {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const index = USCC_CHARSET.indexOf(uscc[i] ?? "");
    if (index < 0) return false;
    sum += index * (USCC_WEIGHTS[i] ?? 0);
  }
  const check = (31 - (sum % 31)) % 31;
  return USCC_CHARSET[check] === uscc[17];
}

interface PiiRule {
  category: Finding["category"];
  pattern: RegExp;
  validate?: (match: string) => boolean;
  // 必要条件预过滤(keyword/前缀),不满足则整条规则跳过(只影响性能,不影响正确性)
  prefilter?: (text: string) => boolean;
  // 自定义取匹配(结构复杂、单正则不足以表达的规则,如 IPv6);优先于 pattern
  findAll?: (text: string) => string[];
}

const PII_RULES: PiiRule[] = [
  { category: "PHONE", pattern: PHONE_RE },
  { category: "EMAIL", pattern: EMAIL_RE },
  { category: "ID_CARD", pattern: ID_CARD_RE, validate: idCardCheck },
  { category: "BANK_CARD", pattern: BANK_CARD_RE, validate: luhnCheck },
  { category: "LANDLINE", pattern: LANDLINE_RE, validate: landlineCheck },
  { category: "PLATE", pattern: PLATE_RE, validate: plateCheck },
  { category: "IP_PRIVATE", pattern: IPV4_RE, validate: isIpPrivate },
  { category: "IP_INTERNAL", pattern: IPV4_RE, validate: isIpInternal },
  { category: "IPV6_PRIVATE", pattern: IPV6_RUN_RE, prefilter: ipv6Prefilter, findAll: findIpv6Private },
  { category: "IBAN", pattern: IBAN_RE, validate: ibanCheck },
  { category: "USCC", pattern: USCC_RE, validate: usccCheck },
  { category: "MAC", pattern: MAC_RE },
  { category: "HKID", pattern: HKID_RE },
];

export function scanPii(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const rule of PII_RULES) {
    if (!isRuleEnabled(rule.category)) continue;
    if (rule.prefilter && !rule.prefilter(text)) continue;
    for (const matched of rule.findAll ? rule.findAll(text) : matchAll(rule, text)) {
      findings.push({
        category: rule.category,
        action: "mask",
        matched,
        maskTag: buildMaskTag(rule.category),
      });
    }
  }
  return findings;
}

function matchAll(rule: PiiRule, text: string): string[] {
  const out: string[] = [];
  rule.pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rule.pattern.exec(text)) !== null) {
    if (rule.validate && !rule.validate(m[0])) continue;
    out.push(m[0]);
  }
  return out;
}

export interface MaskResult {
  masked: string;
  replacementCount: number;
  registry?: MaskRegistry;
  // 本次脱敏实际使用的 原文→占位符 对(供字节级 splice 复用)
  pairs?: Map<string, string>;
}

const PLACEHOLDER_SPLIT_RE = new RegExp(`(${TAG_RE.source})`);
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

export function applyMasks(
  text: string,
  findings: Finding[],
  registry?: MaskRegistry,
  pairsOut?: Map<string, string>
): MaskResult {
  const maskFindings = findings.filter((f) => f.action === "mask" && f.maskTag && f.matched);
  if (!text || maskFindings.length === 0) {
    return { masked: text, replacementCount: 0, registry };
  }

  // 值→finding 去重(同值多类别时首个生效,与旧的"先替换者胜"语义一致)
  const literalToFinding = new Map<string, Finding>();
  const alts: string[] = [];
  for (const f of maskFindings) {
    if (literalToFinding.has(f.matched)) continue;
    literalToFinding.set(f.matched, f);
    alts.push(f.matched.replace(REGEX_SPECIALS, "\\$&"));
  }
  if (alts.length === 0) {
    return { masked: text, replacementCount: 0, registry };
  }

  // 单遍合并替换(CosyRedactGateway span 模型 / maskit 合并 subn 的等价实现):
  // 旧实现逐 finding includes+replaceAll 为 O(findings×text);合并 alternation 后整段文本只扫一遍。
  // 最长优先:同一起点的包含关系(长词/短词同时命中)由长词胜出,短词不再劈开长值。
  // 分段保护:占位符文法段(TAG_RE)不参与替换,防套娃/防劈开既有占位符语义保持。
  // tagFor 保持惰性:只为文本中实际命中的值铸造占位符(与旧 includes 门槛语义一致)。
  //
  // alternation 规模上限:真实管线按叶子调用,去重后数量远低于此;超过则回退
  // 逐条 includes 循环(巨型合并正则的编译代价反而成为瓶颈)。
  if (alts.length <= 512) {
    return applyMasksCombined(text, alts, literalToFinding, registry, pairsOut);
  }
  return applyMasksSequential(text, maskFindings, registry, pairsOut);
}

function applyMasksCombined(
  text: string,
  alts: string[],
  literalToFinding: Map<string, Finding>,
  registry?: MaskRegistry,
  pairsOut?: Map<string, string>
): MaskResult {
  alts.sort((a, b) => b.length - a.length);
  const combined = new RegExp(alts.join("|"), "g");

  let replacementCount = 0;
  const pairs = new Map<string, string>();
  const segments = text.split(PLACEHOLDER_SPLIT_RE);
  for (let i = 0; i < segments.length; i += 2) {
    const segment = segments[i]!;
    if (!segment) continue;
    combined.lastIndex = 0;
    const hits: Array<{ start: number; end: number; value: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = combined.exec(segment)) !== null) {
      const matched = m[0];
      if (!matched) {
        combined.lastIndex += 1;
        continue;
      }
      hits.push({ start: m.index, end: m.index + matched.length, value: matched });
    }
    if (hits.length === 0) continue;

    let out = "";
    let at = 0;
    for (const hit of hits) {
      let tag = pairs.get(hit.value);
      if (tag === undefined) {
        const finding = literalToFinding.get(hit.value)!;
        tag = registry ? registry.tagFor(finding.category, finding.matched, finding.shortCode) : finding.maskTag!;
        if (tag === hit.value) {
          // 防套娃:值本身是占位符文法且 tagFor 原样返回——原样保留
          tag = hit.value;
        }
        pairs.set(hit.value, tag);
      }
      out += segment.slice(at, hit.start);
      out += tag;
      at = hit.end;
      if (tag !== hit.value) replacementCount += 1;
    }
    segments[i] = out + segment.slice(at);
  }
  if (pairsOut) {
    for (const [k, v] of pairs) pairsOut.set(k, v);
  }
  return { masked: segments.join(""), replacementCount, registry, pairs };
}

// 逐条回退路径(仅在单次调用超过 512 个去重值时使用)
function applyMasksSequential(
  text: string,
  maskFindings: Finding[],
  registry?: MaskRegistry,
  pairsOut?: Map<string, string>
): MaskResult {
  let result = text;
  let replacementCount = 0;
  const pairs = new Map<string, string>();
  for (const f of maskFindings) {
    if (!result.includes(f.matched)) continue;
    const tag = registry ? registry.tagFor(f.category, f.matched, f.shortCode) : f.maskTag!;
    const applied = replaceOutsidePlaceholders(result, f.matched, tag);
    result = applied.text;
    replacementCount += applied.count;
    if (tag !== f.matched) pairs.set(f.matched, tag);
  }
  if (pairsOut) {
    for (const [k, v] of pairs) pairsOut.set(k, v);
  }
  return { masked: result, replacementCount, registry, pairs };
}

function replaceOutsidePlaceholders(text: string, matched: string, tag: string): { text: string; count: number } {
  const segments = text.split(PLACEHOLDER_SPLIT_RE);
  let count = 0;
  for (let i = 0; i < segments.length; i += 2) {
    const segment = segments[i]!;
    if (!segment.includes(matched)) continue;
    count += segment.split(matched).length - 1;
    segments[i] = segment.replaceAll(matched, tag);
  }
  return { text: segments.join(""), count };
}
