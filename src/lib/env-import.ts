export interface ParsedEnvEntry {
  key: string;
  value: string;
  selected: boolean;
}

// 解析 .env 文本:KEY=VALUE 行;跳过注释与空值;剥离成对引号;值侧作为词条
export function parseEnvContent(content: string): ParsedEnvEntry[] {
  const out: ParsedEnvEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = (match[2] ?? "").trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    out.push({ key: match[1] ?? "", value, selected: true });
  }
  return out;
}
