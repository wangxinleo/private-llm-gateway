export interface BypassRuleWindow {
  enabled: number;
  startAt: string;
  endAt: string;
}

export interface BypassRuleRecord extends BypassRuleWindow {
  id: number;
  pathPrefix: string;
  modelName: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface BypassMatchInput {
  path: string;
  model: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractRequestModel(bodyText: string): string | null {
  if (!bodyText) return null;

  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!isRecord(parsed)) return null;
    return typeof parsed.model === "string" && parsed.model.trim() ? parsed.model : null;
  } catch {
    return null;
  }
}

export function isBypassRuleActive(
  rule: BypassRuleWindow,
  now: Date
): boolean {
  if (rule.enabled !== 1) return false;

  const start = Date.parse(rule.startAt);
  const end = Date.parse(rule.endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;

  const nowMs = now.getTime();
  // One-time bypass windows use an inclusive closed interval: [startAt, endAt].
  return nowMs >= start && nowMs <= end;
}

export function matchBypassRule(
  rules: BypassRuleRecord[],
  input: BypassMatchInput,
  now: Date
): BypassRuleRecord | null {
  if (!input.model) return null;

  for (const rule of rules) {
    if (!isBypassRuleActive(rule, now)) continue;
    if (!input.path.startsWith(rule.pathPrefix)) continue;
    if (rule.modelName !== input.model) continue;
    return rule;
  }

  return null;
}
