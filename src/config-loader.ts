import { getConfig, setConfig, getAllConfigs } from "@/audit";
import { SIZE_THRESHOLDS, CONFIG_STATE, CONTEXT_KEY, PATH_PREFIX_OPTIONS, DEFAULT_CONFIG_VALUES } from "@/config";

let configsInitialized = false;

export function initializeConfigs() {
  if (configsInitialized) return;
  configsInitialized = true;

  try {
    const configs = getAllConfigs();
    const configMap = new Map(configs.map(c => [c.key, c]));

    // Load or initialize each config
    const loadOrInit = (key: string, defaultValue: any, type: 'number' | 'string' | 'json_array', description: string) => {
      const config = configMap.get(key);
      if (config) {
        return type === 'json_array' ? JSON.parse(config.value) : type === 'number' ? parseInt(config.value, 10) : config.value;
      } else {
        const value = type === 'json_array' ? JSON.stringify(defaultValue) : String(defaultValue);
        setConfig(key, value, type, description);
        return defaultValue;
      }
    };

    SIZE_THRESHOLDS.FULL_SCAN = loadOrInit("size_threshold_full_scan", DEFAULT_CONFIG_VALUES.SIZE_THRESHOLD_FULL_SCAN, "number", "Full scan threshold in bytes");
    SIZE_THRESHOLDS.CHUNKED_SCAN = loadOrInit("size_threshold_chunked_scan", DEFAULT_CONFIG_VALUES.SIZE_THRESHOLD_CHUNKED_SCAN, "number", "Chunked scan threshold in bytes");
    CONFIG_STATE.CHUNK_SIZE = loadOrInit("chunk_size", DEFAULT_CONFIG_VALUES.CHUNK_SIZE, "number", "Chunk size in bytes");
    CONTEXT_KEY.MIN_LENGTH = loadOrInit("context_key_min_length", DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MIN_LENGTH, "number", "Context key minimum length");
    CONTEXT_KEY.MAX_LENGTH = loadOrInit("context_key_max_length", DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MAX_LENGTH, "number", "Context key maximum length");
    CONTEXT_KEY.MAX_SPACES = loadOrInit("context_key_max_spaces", DEFAULT_CONFIG_VALUES.CONTEXT_KEY_MAX_SPACES, "number", "Context key maximum spaces");
    PATH_PREFIX_OPTIONS.length = 0;
    PATH_PREFIX_OPTIONS.push(...loadOrInit("path_prefix_options", DEFAULT_CONFIG_VALUES.PATH_PREFIX_OPTIONS, "json_array", "Path prefix options for bypass rules"));
  } catch (err) {
    console.error("Failed to initialize configs from database:", err);
    // Fall back to defaults on error
  }
}

// Refresh config from database (called after config updates via API)
export function refreshConfig(key: string) {
  const config = getConfig(key);
  if (!config) return;

  switch (key) {
    case "path_prefix_options":
      PATH_PREFIX_OPTIONS.length = 0;
      PATH_PREFIX_OPTIONS.push(...JSON.parse(config.value));
      break;
    case "size_threshold_full_scan":
      SIZE_THRESHOLDS.FULL_SCAN = parseInt(config.value, 10);
      break;
    case "size_threshold_chunked_scan":
      SIZE_THRESHOLDS.CHUNKED_SCAN = parseInt(config.value, 10);
      break;
    case "chunk_size":
      CONFIG_STATE.CHUNK_SIZE = parseInt(config.value, 10);
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
  }
}
