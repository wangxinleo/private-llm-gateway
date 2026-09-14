import type { Finding, ScanResult } from "@/types";
import { isBlockCategory } from "@/types";
import type { MaskRegistry } from "@/scanner/mask-registry";
import { applyMasks } from "./pii";

type ScanFn = (text: string, size: number, registry?: MaskRegistry) => ScanResult;

const PATH_SEPARATOR = ".";

export function isJsonContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase().trim();
  return ct.startsWith("application/json") || ct.includes("+json");
}

function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

function buildContextText(value: string, path: string[]): string {
  const key = path.at(-1);
  if (!key) return value;

  const fullPath = path.join(PATH_SEPARATOR);
  return key === fullPath
    ? `${key}=${value}`
    : `${key}=${value}\n${fullPath}=${value}`;
}

const DATA_URI_RE = /^data:[a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+;base64,/;
const BASE64_BLOB_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_BLOB_MIN_LENGTH = 64;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

// 字节级 splice 上限(maskit _SPLICE_MAX 思路):超限直接退回重序列化
const SPLICE_MAX_BYTES = 8 * 1024 * 1024;
const SPLICE_MAX_FORMS = 256;

function jsonLiteral(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

// \uXXXX 转义形态:客户端 body 可能用 ensure_ascii 风格写非 ASCII 字符
function jsonLiteralAscii(value: string): string {
  return jsonLiteral(value).replace(/[^\x20-\x7E]/g, (ch) => "\\u" + (ch.charCodeAt(0).toString(16).padStart(4, "0")));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object") {
    if (typeof b !== "object" || Array.isArray(b)) return false;
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/**
 * 字节级 splice(maskit _splice_mask 设计):在客户端原始 body 文本上只替换被脱敏的
 * 原文→占位符(双形态字面量:原字符 / \uXXXX 转义),保留排版与上游 Prompt Cache 前缀。
 *
 * 正确性不由本函数保证:任何多替换/错替换都会被调用方的深等价校验
 * `JSON.parse(结果) deep-equal 脱敏树` 拦下并退回重序列化——最差回到旧行为,绝不放行原文。
 */
function buildSplicedBody(
  raw: string,
  maskedRoot: unknown,
  pairs: Map<string, string>
): string | null {
  if (!raw || raw.length > SPLICE_MAX_BYTES || pairs.size === 0) return null;
  const table = new Map<string, string>();
  for (const [orig, tok] of pairs) {
    if (!orig || !tok || orig === tok) continue;
    const litRaw = jsonLiteral(orig);
    const litAscii = jsonLiteralAscii(orig);
    const replRaw = jsonLiteral(tok);
    const replAscii = jsonLiteralAscii(tok);
    if (litRaw !== replRaw) table.set(litRaw, replRaw);
    if (litAscii !== replAscii) table.set(litAscii, replAscii);
  }
  if (table.size === 0 || table.size > SPLICE_MAX_FORMS) return null;

  // 长 form 优先:正则交替首个匹配胜出,短原文是长原文子串时会把长值切碎
  const forms = [...table.keys()].sort((a, b) => b.length - a.length);
  const pat = new RegExp(forms.map((f) => f.replace(REGEX_SPECIALS, "\\$&")).join("|"), "g");
  const spliced = raw.replace(pat, (m) => table.get(m)!);
  if (spliced === raw) return null;

  // 等价校验:spliced 解析后必须与脱敏树完全一致
  try {
    if (deepEqual(JSON.parse(spliced), maskedRoot)) return spliced;
  } catch {
    /* 解析失败 → 退回重序列化 */
  }
  return null;
}

/**
 * 二进制 base64 payload 不被当作文本扫描,否则 BASE64_TOKEN 会误判其中的
 * `eyJ...` 序列并打码,破坏 base64。仅豁免 data URI 与键名 `data` 的长纯 base64
 * (Anthropic/Gemini 图片形态);短值或含 `-`/`_` 的 base64url 仍正常扫描。
 */
function isBinaryPayload(value: string, key: string | undefined): boolean {
  if (DATA_URI_RE.test(value)) return true;
  if (key !== "data" || value.length < BASE64_BLOB_MIN_LENGTH) return false;
  return BASE64_BLOB_RE.test(value);
}

function appendFindings(target: Finding[], additions: Finding[]): void {
  const seen = new Set(target.map((finding) => `${finding.category}\0${finding.action}\0${finding.matched}`));
  for (const finding of additions) {
    const key = `${finding.category}\0${finding.action}\0${finding.matched}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(finding);
  }
}

function maskStringValue(
  value: string,
  findings: Finding[],
  registry?: MaskRegistry,
  pairs?: Map<string, string>
): string {
  return applyMasks(value, findings, registry, pairs).masked;
}

function scanStringContext(value: string, scan: ScanFn, path: string[]): ScanResult {
  const scanText = buildContextText(value, path);
  return scan(scanText, byteLength(scanText));
}

function scanObjectContext(
  obj: Record<string, unknown>,
  scan: ScanFn,
  findings: Finding[],
  path: string[]
): Finding[] {
  const contextLines: string[] = [];
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "string" && !isBinaryPayload(value, key)) {
      contextLines.push(buildContextText(value, [...path, key]));
    }
  }

  if (contextLines.length === 0) return [];

  const contextText = contextLines.join("\n");
  const result = scan(contextText, byteLength(contextText));
  appendFindings(findings, result.findings);
  return result.action === "block"
    ? result.findings.filter((finding) => isBlockCategory(finding.category))
    : result.findings;
}

function scanValue(
  value: unknown,
  scan: ScanFn,
  findings: Finding[],
  path: string[] = [],
  siblingFindings: Finding[] = [],
  registry?: MaskRegistry,
  pairs?: Map<string, string>
): unknown {
  if (typeof value === "string") {
    if (isBinaryPayload(value, path.at(-1))) {
      return value;
    }

    const result = scanStringContext(value, scan, path);
    appendFindings(findings, result.findings);

    if (result.action === "block") {
      return value;
    }

    const localFindings = [...siblingFindings, ...result.findings];
    // 包含性过滤由 applyMasks 单遍扫描天然完成(只替换叶内实际出现的值);
    // 这里不再逐 finding includes(旧实现 O(findings×leaf) 的第二个热点)
    return maskStringValue(value, localFindings, registry, pairs);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      scanValue(item, scan, findings, [...path, String(index)], [], registry, pairs)
    );
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const localFindings = scanObjectContext(obj, scan, findings, path);
    for (const key of Object.keys(obj)) {
      const child = obj[key];
      const childSiblingFindings = typeof child === "string" ? localFindings : [];
      result[key] = scanValue(child, scan, findings, [...path, key], childSiblingFindings, registry, pairs);
    }
    return result;
  }

  return value;
}

export function maskJsonBody(body: string, scan: ScanFn, registry?: MaskRegistry): ScanResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return scan(body, byteLength(body), registry);
  }

  const findings: Finding[] = [];
  const pairs = new Map<string, string>();
  const masked = scanValue(parsed, scan, findings, [], [], registry, pairs);

  if (findings.some((finding) => isBlockCategory(finding.category))) {
    return { findings, maskedBody: body, action: "block", maskSummary: { applied: false, categories: [], replacementCount: 0 }, registry };
  }

  if (findings.length > 0) {
    const maskFindings = findings.filter((finding) => finding.action === "mask");
    // 字节级 splice 优先(保排版/上游 Prompt Cache 前缀),等价校验不过退回重序列化
    const spliced = buildSplicedBody(body, masked, pairs);
    return {
      findings,
      maskedBody: spliced ?? JSON.stringify(masked),
      action: "mask",
      maskSummary: {
        applied: maskFindings.length > 0,
        categories: [...new Set(maskFindings.map((finding) => finding.category))],
        replacementCount: maskFindings.length,
      },
      registry,
    };
  }

  // 无命中:原样返回原始文本,不做无谓重序列化(转发层本就使用原文,字节零改动)
  return { findings, maskedBody: body, action: "allow", maskSummary: { applied: false, categories: [], replacementCount: 0 }, registry };
}
