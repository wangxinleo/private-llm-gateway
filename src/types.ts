export type FindingCategory =
  | "PRIVATE_KEY"
  | "BEARER_TOKEN"
  | "BASIC_AUTH"
  | "JWT"
  | "COOKIE_HEADER"
  | "SET_COOKIE_HEADER"
  | "DB_URI"
  | "AWS_ACCESS_KEY"
  | "GITHUB_TOKEN"
  | "DEVELOPER_TOKEN"
  | "SLACK_TOKEN"
  | "GOOGLE_API_KEY"
  | "PROVIDER_API_KEY"
  | "CLOUD_CREDENTIAL"
  | "CONNECTION_STRING"
  | "ENCODED_SECRET"
  | "BASE64_TOKEN"
  | "STRIPE_KEY"
  | "SENDGRID_KEY"
  | "CONTEXTUAL_SECRET"
  | "SENSITIVE_FILENAME"
  | "PHONE"
  | "EMAIL"
  | "ID_CARD"
  | "BANK_CARD";

export type ActionType = "block" | "mask" | "allow";

export interface HighRiskAssets {
  domains: string[];
  emails: string[];
  accounts: string[];
}

export type EditableConfigType = "number" | "string" | "json_array";
export type EditableConfigValue = number | string | string[] | HighRiskAssets;

export interface EditableConfig {
  value: EditableConfigValue;
  type: EditableConfigType;
  description?: string;
}

export interface AdminConfigResponse {
  env?: {
    upstreamUrl: string;
    dbPath: string;
    debug: boolean;
    nodeEnv: string;
    port: string;
  };
  editableConfigs?: Record<string, EditableConfig>;
  constants?: {
    contextKey: {
      minLength: number;
      maxLength: number;
      maxSpaces: number;
    };
    contextWindowSize?: number;
  };
  dbStats?: {
    totalRecords: number;
    earliestRecord: string | null;
    latestRecord: string | null;
    dbFileSize: number;
  };
}

export interface Finding {
  category: FindingCategory;
  action: ActionType;
  matched: string;
  maskTag?: string;
}

export interface ScanResult {
  findings: Finding[];
  maskedBody: string;
  action: ActionType;
  maskSummary: MaskSummary;
}

export interface MaskSummary {
  applied: boolean;
  categories: FindingCategory[];
  replacementCount: number;
}

export interface AuditEntry {
  timestamp: string;
  path: string;
  method: string;
  contentType: string;
  bodySize: number;
  model?: string;
  filenames: string[];
  findings: FindingCategory[];
  matchedValues: Record<string, string[]>;
  action: ActionType;
  maskApplied?: boolean;
  maskCategories?: FindingCategory[];
  maskCount?: number;
  bypassApplied?: boolean;
  duration?: number;
}

const BLOCK_CATEGORIES: ReadonlySet<FindingCategory> = new Set([
  "SENSITIVE_FILENAME",
]);

export function isBlockCategory(category: FindingCategory): boolean {
  return BLOCK_CATEGORIES.has(category);
}
