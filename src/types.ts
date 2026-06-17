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
  | "SLACK_TOKEN"
  | "GOOGLE_API_KEY"
  | "CONTEXTUAL_SECRET"
  | "SENSITIVE_FILENAME"
  | "PHONE"
  | "EMAIL"
  | "ID_CARD"
  | "BANK_CARD";

export type ActionType = "block" | "mask" | "allow";

export interface Finding {
  category: FindingCategory;
  action: ActionType;
  matched: string;
  maskTag?: string;
}

export type SizeTier = "full" | "chunked" | "minimal";

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
  filenames: string[];
  findings: FindingCategory[];
  action: ActionType;
  maskApplied?: boolean;
  maskCategories?: FindingCategory[];
  maskCount?: number;
}

const BLOCK_CATEGORIES: ReadonlySet<FindingCategory> = new Set([
  "SENSITIVE_FILENAME",
]);

export function isBlockCategory(category: FindingCategory): boolean {
  return BLOCK_CATEGORIES.has(category);
}
