import type { AuditSignal } from "@/audit/signals-store";

// 请求侧提示词注入被动审计（只记录不阻断，severity ≥ MEDIUM 以通过默认 floor）。
// 三族（评估结论 09-21-eval-injection-signals）：
//  1) injection_fake_system_turn  (MEDIUM) 协议控制字面量
//  2) injection_credential_exfil  (HIGH)   凭据对象 + 外发动作 + 外部目标 同窗共现
//  3) injection_prompt_exfil      (MEDIUM) 套取系统提示词 + 编码/外发标记 同窗共现
// FP 纪律：泛化句式（"忽略以上指令"）绝不单独上报——只在客观载荷同现时并入对应族；
// 排除了"encoded payload 绕过"族（解码成本与 FP 面大，评估裁定不做）。
// detail 只含 kind + 打码 preview，不落完整原文。

const WINDOW = 200;
// 凭据外发族用更紧的同现窗：文档/代码里"敏感文件名清单 + uploaded + URL"分散在 200 字符内
// 会误报（README 实测），收紧到 80 后只保留真正贴着对象的"对象→动作→目标"语句。
const EXFIL_WINDOW = 80;

const FAKE_TURN_RE = /<\|(?:im_start|im_end|system|assistant|user|endoftext)\|>|<<SYS>>|\[\/?INST\]/g;
const INSTRUCTION_HINT_RE = /ignore|disregard|forget|override|new instructions|忽略|无视|不要遵循|不要理会|新指令|从现在起|以上指令/i;

// 凭据对象取"高信号文件/密钥物"：刻意不含 `credentials`/`token` 等泛化词
// （文档与代码里随手可见，实测会与 curl/URL 形成大量误报）；`.env` 要求非单词字符前界，
// 排除 `process.env` 这类代码写法。
const CRED_OBJECT_RE = /~?\/\.ssh|\bid_rsa\b|(?<![\w])\.env\b|aws_secret|aws_access|private key|keystore|wallet|私钥|钱包|助记词|(?<![\w])\.npmrc\b/gi;
const EGRESS_VERB_RE = /curl|wget|upload|exfiltrat|post\b|send|发送|上传|外发|回传|发给|寄到|提交到/i;
const EXTERNAL_TARGET_RE = /https?:\/\/|pastebin|requestbin|ngrok|webhook|transfer\.sh|\b\d{1,3}(?:\.\d{1,3}){3}\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i;

const PROMPT_PHRASE_RE = /system prompt|system instructions|initial instructions|your instructions|hidden instructions|系统提示词|系统指令|隐藏指令|以上指令|前面的指令/gi;
const ENCODE_MARKER_RE = /base64|base-64|rot13|encode|encodeURI|编码|转码/i;

function preview(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= 8) return "***";
  return `${flat.slice(0, 4)}***${flat.slice(-4)}`;
}

function windowAround(text: string, start: number, end: number, radius: number = WINDOW): string {
  return text.slice(Math.max(0, start - radius), Math.min(text.length, end + radius));
}

function countDistinctFakeTurns(text: string): number {
  const seen = new Set<string>();
  FAKE_TURN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FAKE_TURN_RE.exec(text)) !== null) {
    seen.add(m[0].toLowerCase());
    if (seen.size >= 2) break;
  }
  return seen.size;
}

function findFakeSystemTurn(text: string): string | null {
  if (!text.includes("<|") && !text.includes("<</") && !text.includes("[INST]") && !text.includes("[/INST]")) {
    return null;
  }
  const distinct = countDistinctFakeTurns(text);
  FAKE_TURN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FAKE_TURN_RE.exec(text)) !== null) {
    const near = windowAround(text, m.index, m.index + m[0].length);
    if (distinct >= 2 || INSTRUCTION_HINT_RE.test(near)) {
      return preview(near);
    }
  }
  return null;
}

function findCredentialExfil(text: string): string | null {
  if (!text.includes("://") && !/私钥|钱包|助记词|id_rsa|\.ssh|\.env/i.test(text)) return null;
  CRED_OBJECT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CRED_OBJECT_RE.exec(text)) !== null) {
    const near = windowAround(text, m.index, m.index + m[0].length, EXFIL_WINDOW);
    if (EGRESS_VERB_RE.test(near) && EXTERNAL_TARGET_RE.test(near)) {
      return preview(near);
    }
  }
  return null;
}

function findPromptExfil(text: string): string | null {
  if (!/system prompt|system instructions|系统提示词|系统指令|隐藏指令|instructions|以上指令|前面的指令/i.test(text)) {
    return null;
  }
  PROMPT_PHRASE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROMPT_PHRASE_RE.exec(text)) !== null) {
    const near = windowAround(text, m.index, m.index + m[0].length);
    if (ENCODE_MARKER_RE.test(near)) {
      return preview(near);
    }
  }
  return null;
}

export function analyzeRequestInjection(text: string): AuditSignal[] {
  if (!text) return [];
  const signals: AuditSignal[] = [];
  try {
    const fake = findFakeSystemTurn(text);
    if (fake) signals.push({ signal: "injection_fake_system_turn", severity: "MEDIUM", detail: { kind: "fake_protocol_turn", preview: fake } });

    const exfil = findCredentialExfil(text);
    if (exfil) signals.push({ signal: "injection_credential_exfil", severity: "HIGH", detail: { kind: "credential_egress", preview: exfil } });

    const prompt = findPromptExfil(text);
    if (prompt) signals.push({ signal: "injection_prompt_exfil", severity: "MEDIUM", detail: { kind: "prompt_extraction", preview: prompt } });
  } catch {
    // 被动分析绝不中断请求
  }
  return signals;
}
