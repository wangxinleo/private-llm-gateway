import { getConfig, setConfig, getAllConfigs } from "@/audit";
import { CONTEXT_KEY, PATH_PREFIX_OPTIONS, CONTEXT_WINDOW_SIZE, DEFAULT_CONFIG_VALUES, SCANNER_RULES, RUNTIME } from "@/config";
import type { EditableConfigType, Severity, FindingCategory } from "@/types";
import { warnInvalidEnv } from "@/lib/env-check";
import { Logger } from "@/log";

let configsInitialized = false;
const log = new Logger("config");

export function initializeConfigs(): void {
  if (configsInitialized) return;
  configsInitialized = true;

  // 非法 env 可见化(每进程一轮):拼写错误的值会静默回退,这里是唯一的出口
  warnInvalidEnv();

  try {
    const configs = getAllConfigs();
    const configMap = new Map(configs.map(c => [c.key, c]));

    // Load or initialize each config
    const loadOrInit = <T>(
      key: string,
      defaultValue: T,
      type: EditableConfigType,
      description: string
    ): T => {
      const config = configMap.get(key);
      if (config) {
        return (type === "json_array" ? JSON.parse(config.value) : type === "number" ? parseInt(config.value, 10) : config.value) as T;
      }

      const value = type === "json_array" ? JSON.stringify(defaultValue) : String(defaultValue);
      setConfig(key, value, type, description);
      return defaultValue;
    };

    CONTEXT_KEY.MIN_LENGTH = loadOrInit("context_key_min_length", DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MIN_LENGTH, "number", "Context key minimum length");
    CONTEXT_KEY.MAX_LENGTH = loadOrInit("context_key_max_length", DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MAX_LENGTH, "number", "Context key maximum length");
    CONTEXT_KEY.MAX_SPACES = loadOrInit("context_key_max_spaces", DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MAX_SPACES, "number", "Context key maximum spaces");
    CONTEXT_WINDOW_SIZE.value = loadOrInit("context_window_size", DEFAULT_CONFIG_VALUES.CONTEXT_WINDOW_SIZE, "number", "Context scan window radius in characters");
    PATH_PREFIX_OPTIONS.length = 0;
    PATH_PREFIX_OPTIONS.push(...loadOrInit("path_prefix_options", DEFAULT_CONFIG_VALUES.PATH_PREFIX_OPTIONS, "json_array", "Path prefix options for bypass rules"));

    const loadedToggles = loadOrInit(
      "rule_toggles",
      DEFAULT_CONFIG_VALUES.RULE_TOGGLES as unknown as Record<string, boolean>,
      "json_array",
      "Per-category builtin rule toggles"
    );
    for (const [key, value] of Object.entries(loadedToggles)) {
      if (typeof value === "boolean" && key in SCANNER_RULES) {
        SCANNER_RULES[key as FindingCategory] = value;
      }
    }

    const loadedPrefixes = loadOrInit("secret_prefixes", DEFAULT_CONFIG_VALUES.SECRET_PREFIXES, "json_array", "Custom secret prefixes treated as SECRET category");
    RUNTIME.secretPrefixes = loadedPrefixes.filter((p) => typeof p === "string" && p.length > 0);
    RUNTIME.secretPrefixMinLen = loadOrInit("secret_prefix_min_length", DEFAULT_CONFIG_VALUES.SECRET_PREFIX_MIN_LENGTH, "number", "Minimum ciphertext length after a secret prefix");
    RUNTIME.logRetentionDays = loadOrInit("log_retention_days", DEFAULT_CONFIG_VALUES.LOG_RETENTION_DAYS, "number", "Audit log retention in days (0 = keep forever)");
    const floor = loadOrInit("audit_severity_floor", DEFAULT_CONFIG_VALUES.AUDIT_SEVERITY_FLOOR, "string", "Minimum severity for audit signals to persist");
    if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(floor)) RUNTIME.severityFloor = floor as Severity;
    RUNTIME.failClosed = loadOrInit("fail_closed", DEFAULT_CONFIG_VALUES.FAIL_CLOSED, "string", "Fail closed on scan/mask errors (503) instead of forwarding plaintext") === "1";
    const maxBodyMb = loadOrInit("max_body_mb", DEFAULT_CONFIG_VALUES.MAX_BODY_MB, "number", "Maximum request body size in MB");
    RUNTIME.maxBodyBytes = Math.max(1, maxBodyMb) * 1024 * 1024;
  } catch (err) {
    log.error("failed to initialize configs from database", err instanceof Error ? err.message : String(err));
    // Fall back to defaults on error
  }
}

// Refresh config from database (called after config updates via API)
export function refreshConfig(key: string): void {
  const config = getConfig(key);
  if (!config) return;

  switch (key) {
    case "path_prefix_options":
      PATH_PREFIX_OPTIONS.length = 0;
      PATH_PREFIX_OPTIONS.push(...JSON.parse(config.value));
      break;
    case "context_key_min_length":
      CONTEXT_KEY.MIN_LENGTH = parseInt(config.value, 10);
      break;
    case "context_key_max_length":
      CONTEXT_KEY.MAX_LENGTH = parseInt(config.value, 10);
      break;
    case "context_key_max_spaces":
      CONTEXT_KEY.MAX_SPACES = parseInt(config.value, 10);
      break;
    case "context_window_size":
      CONTEXT_WINDOW_SIZE.value = parseInt(config.value, 10);
      break;
    case "rule_toggles": {
      const loaded = JSON.parse(config.value) as Record<string, boolean>;
      for (const [key, value] of Object.entries(loaded)) {
        if (typeof value === "boolean" && key in SCANNER_RULES) {
          SCANNER_RULES[key as FindingCategory] = value;
        }
      }
      break;
    }
    case "secret_prefixes":
      RUNTIME.secretPrefixes = (JSON.parse(config.value) as unknown[]).filter(
        (p): p is string => typeof p === "string" && p.length > 0
      );
      break;
    case "secret_prefix_min_length":
      RUNTIME.secretPrefixMinLen = parseInt(config.value, 10);
      break;
    case "log_retention_days":
      RUNTIME.logRetentionDays = parseInt(config.value, 10);
      break;
    case "audit_severity_floor": {
      const floor = config.value;
      if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(floor)) RUNTIME.severityFloor = floor as Severity;
      break;
    }
    case "fail_closed":
      RUNTIME.failClosed = config.value === "1";
      break;
    case "max_body_mb":
      RUNTIME.maxBodyBytes = Math.max(1, parseInt(config.value, 10)) * 1024 * 1024;
      break;
  }
}
