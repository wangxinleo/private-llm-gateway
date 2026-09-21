import { Logger } from "@/log";

const log = new Logger("env");

interface EnvRule {
  key: string;
  expected: string;
  validate: (value: string) => boolean;
  fallback: string;
}

// 启动期 env 校验:非法/拼写错误的值会被静默回退(安全配置"沉默失效"),
// 这里集中检查并输出可见告警。只告警、不改变解析结果(拒绝启动会破坏存量部署)。
const ENV_RULES: EnvRule[] = [
  {
    key: "PRIVACY_MASK_FORMAT",
    expected: "legacy | semantic",
    validate: (v) => v === "legacy" || v === "semantic",
    fallback: "semantic",
  },
  {
    key: "PRIVACY_DISAMBIGUATION_MODE",
    expected: "off | auto(旧值 prefix/json-meta 归一为 auto)",
    validate: (v) => v === "off" || v === "auto" || v === "prefix" || v === "json-meta",
    fallback: "auto",
  },
  {
    key: "PRIVACY_SECRET_SCANNER_MODE",
    expected: "strict | balanced",
    validate: (v) => v === "strict" || v === "balanced",
    fallback: "balanced",
  },
  {
    key: "PRIVACY_DEBUG_HEADERS",
    expected: "true | false",
    validate: (v) => v === "true" || v === "false",
    fallback: "false",
  },
  {
    key: "DISABLE_ORIGIN_CHECK",
    expected: "1",
    validate: (v) => v === "1",
    fallback: "来源校验保持开启",
  },
  {
    key: "TRUST_PROXY",
    expected: "1",
    validate: (v) => v === "1",
    fallback: "不信任转发头",
  },
];

const SUFFIX_SECRET_MIN_LENGTH = 16;

export function collectEnvWarnings(env: Record<string, string | undefined> = process.env): string[] {
  const warnings: string[] = [];
  for (const rule of ENV_RULES) {
    const value = env[rule.key];
    if (value === undefined || value === "") continue;
    if (rule.validate(value)) continue;
    warnings.push(`${rule.key}="${value}" 非法（期望: ${rule.expected}）,已按 ${rule.fallback} 处理`);
  }
  const secret = env.PRIVACY_SUFFIX_SECRET;
  if (secret !== undefined && secret !== "" && secret.length < SUFFIX_SECRET_MIN_LENGTH) {
    warnings.push(
      `PRIVACY_SUFFIX_SECRET 长度 ${secret.length} < ${SUFFIX_SECRET_MIN_LENGTH},已忽略并回退进程随机密钥` +
        "（重启/多副本下占位符后缀不一致,上游 Prompt Cache 前缀无法跨请求稳定）"
    );
  }
  return warnings;
}

export function warnInvalidEnv(env: Record<string, string | undefined> = process.env): string[] {
  const warnings = collectEnvWarnings(env);
  for (const message of warnings) {
    log.warn(message);
  }
  return warnings;
}
