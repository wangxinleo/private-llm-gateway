import type { Severity } from "@/types";
import { TAG_RE } from "@/scanner/mask-tag";
import { scanSecrets } from "@/scanner/secrets";
import { scanPii } from "@/scanner/pii";
import { scanCustomWords } from "@/scanner/custom-words";
import { PRIVACY_NOTICE_TEXT } from "@/config";
import type { AuditSignal } from "@/audit/signals-store";
import { insertSignals } from "@/audit/signals-store";

// 分析窗口截断:只用于只读信号分析,截断不影响响应转发
const TEXT_ANALYSIS_LIMIT = 2_000_000;

const TAG_GLOBAL = new RegExp(TAG_RE.source, "g");

// notice 自带的示例占位符(默认文本含 {{EMAIL_trwmq}} 等):模型回显 notice 属常态,
// 不应计入 placeholder_residual,否则真实占位符泄漏会淹没在例行假警报里
const NOTICE_EXAMPLE_TAGS: ReadonlySet<string> = new Set(
  [...PRIVACY_NOTICE_TEXT.matchAll(new RegExp(TAG_RE.source, "g"))].map((m) => m[0]!)
);

export interface ResponseAnalysisInput {
  status: number;
  text: string;
  // 请求侧脱敏映射(占位符 → 原文),用于还原回声抑制与响应泄漏判别
  forwardValues: string[];
  requestModel?: string;
  // 流式异常统计(可选)
  streamStats?: { frames: number; parseFailures: number };
}

const DANGEROUS_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "rm_root", re: /\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+)*\/(?=[\s"'`*]|$)/ },
  { name: "rm_home", re: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+~/ },
  { name: "dd_disk", re: /\bdd\s+[^\n]*of=\/dev\/(?:sd|nvme|disk|rdisk)/ },
  { name: "mkfs", re: /\bmkfs\.\w+\s+\/dev\// },
  { name: "fork_bomb", re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
  { name: "drop_database", re: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i },
  { name: "truncate_table", re: /\bTRUNCATE\s+TABLE\b/i },
  { name: "curl_pipe_sh", re: /\b(?:curl|wget)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|fi)?sh\b/ },
  { name: "chmod_root", re: /\bchmod\s+-R\s+777\s+\/(?:\s|$)/ },
  { name: "shutdown_force", re: /\b(?:shutdown|reboot|halt)\s+-[fF]\b/ },
  { name: "devnull_disk", re: />\s*\/dev\/(?:sd[a-z]|nvme\d)/ },
];

function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function maskPreview(value: string): string {
  if (value.length <= 6) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function isEchoOfForwarded(matched: string, forwardValues: string[]): boolean {
  return forwardValues.some((value) => value.includes(matched) || matched.includes(value));
}

function signal(name: string, severity: Severity, detail: Record<string, unknown>): AuditSignal {
  return { signal: name, severity, detail };
}

// 被动响应分析:只记录不阻断;内部全 try/catch,任何异常都不得中断响应转发
export function analyzeResponse(input: ResponseAnalysisInput): AuditSignal[] {
  const signals: AuditSignal[] = [];
  try {
    const text = input.text.length > TEXT_ANALYSIS_LIMIT ? input.text.slice(0, TEXT_ANALYSIS_LIMIT) : input.text;
    if (!text) return signals;

    // error_leak:上游 4xx/5xx 错误体回扫密钥形态(高/危)
    if (input.status >= 400) {
      try {
        for (const finding of scanSecrets(text)) {
          signals.push(signal("error_leak", "CRITICAL", { kind: "secret_pattern", category: finding.category, preview: maskPreview(finding.matched) }));
        }
        for (const m of text.matchAll(/[A-Za-z0-9_+/-]{20,}/g)) {
          const candidate = m[0] ?? "";
          if (shannonEntropy(candidate) > 3.0) {
            signals.push(signal("error_leak", "HIGH", { kind: "high_entropy", preview: maskPreview(candidate) }));
          }
        }
      } catch {
        /* 单信号异常不中断 */
      }
    }

    // identity_swap:响应 model 与请求 model 首段家族比对
    try {
      if (input.requestModel) {
        let responseModel: string | undefined;
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          if (typeof parsed?.model === "string") responseModel = parsed.model;
        } catch {
          /* 非整段 JSON(流式累积等)跳过 */
        }
        if (responseModel) {
          const familyOf = (model: string) => model.split(/[-_/]/)[0]?.toLowerCase() ?? "";
          if (familyOf(responseModel) !== familyOf(input.requestModel)) {
            signals.push(signal("identity_swap", "MEDIUM", { requestModel: input.requestModel, responseModel }));
          }
        }
      }
    } catch {
      /* 忽略 */
    }

    // response_poison:双向覆盖符 / 零宽字符 / 占位符残留(还原失败面)
    try {
      const bidi = text.match(/[\u202A-\u202E\u2066-\u2069]/g);
      if (bidi && bidi.length > 0) {
        signals.push(signal("response_poison", "HIGH", { kind: "bidi_override", count: bidi.length }));
      }
      const zeroWidth = text.match(/[\u200B-\u200F\u2060\uFEFF]/g);
      if (zeroWidth && zeroWidth.length >= 8) {
        signals.push(signal("response_poison", "MEDIUM", { kind: "zero_width", count: zeroWidth.length }));
      }
      const residualTags = (text.match(TAG_GLOBAL) ?? []).filter((tag) => !NOTICE_EXAMPLE_TAGS.has(tag));
      if (residualTags.length > 0) {
        signals.push(signal("response_poison", "MEDIUM", { kind: "placeholder_residual", count: residualTags.length }));
      }
    } catch {
      /* 忽略 */
    }

    // response_scan(SCAN_WARN):还原后重扫规则,命中不在请求映射内的值 → 模型自产敏感信息
    try {
      const scanFindings = [...scanSecrets(text), ...scanPii(text), ...scanCustomWords(text)];
      for (const finding of scanFindings) {
        if (isEchoOfForwarded(finding.matched, input.forwardValues)) continue;
        signals.push(signal("response_scan", "LOW", { category: finding.category, preview: maskPreview(finding.matched) }));
      }
    } catch {
      /* 忽略 */
    }

    // sse_anomaly:流式解析失败帧占比
    try {
      const stats = input.streamStats;
      if (stats && stats.frames > 0) {
        const rate = stats.parseFailures / stats.frames;
        if (rate > 0.3) {
          signals.push(signal("sse_anomaly", "LOW", { frames: stats.frames, parseFailures: stats.parseFailures, rate: Number(rate.toFixed(3)) }));
        }
      }
    } catch {
      /* 忽略 */
    }

    // dangerous_action:危险命令只记不拦
    try {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.re.test(text)) {
          signals.push(signal("dangerous_action", "LOW", { pattern: pattern.name }));
        }
      }
    } catch {
      /* 忽略 */
    }
  } catch {
    /* 顶层兜底:分析绝不抛出 */
  }
  return signals;
}

// 流式累积器:逐帧吞入还原后输出,流结束产出并落库分析结果
export class StreamResponseAnalyzer {
  private text = "";
  private frames = 0;
  private parseFailures = 0;

  constructor(
    private readonly base: Omit<ResponseAnalysisInput, "text" | "streamStats">,
    private readonly auditId: number
  ) {}

  observe(frameOutput: string): void {
    try {
      if (this.text.length < TEXT_ANALYSIS_LIMIT) {
        this.text += frameOutput;
        if (this.text.length > TEXT_ANALYSIS_LIMIT) this.text = this.text.slice(0, TEXT_ANALYSIS_LIMIT);
      }
      for (const line of frameOutput.split("\n")) {
        if (!line.startsWith("data:")) continue;
        this.frames += 1;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          JSON.parse(payload);
        } catch {
          this.parseFailures += 1;
        }
      }
    } catch {
      /* 忽略 */
    }
  }

  finish(): number {
    const signals = analyzeResponse({ ...this.base, text: this.text, streamStats: { frames: this.frames, parseFailures: this.parseFailures } });
    return insertSignals(this.auditId, signals);
  }
}
