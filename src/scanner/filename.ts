import type { Finding } from "@/types";

const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".env",
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".npmrc",
  ".pypirc",
]);

const BLOCKED_NAMES: ReadonlySet<string> = new Set([
  "id_rsa",
  "id_dsa",
  "authorized_keys",
  "known_hosts",
  "credentials.json",
  "service-account.json",
  "secrets.yaml",
  "secrets.yml",
  "prod.env",
  "config.prod",
]);

function basename(filepath: string): string {
  const idx = Math.max(filepath.lastIndexOf("/"), filepath.lastIndexOf("\\"));
  return filepath.slice(idx + 1);
}

function extension(filename: string): string {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx < 0) return "";
  return filename.slice(dotIdx).toLowerCase();
}

export function scanFilename(filename: string): Finding | null {
  const name = basename(filename);
  const ext = extension(name);
  const lowerName = name.toLowerCase();

  if (BLOCKED_NAMES.has(lowerName) || BLOCKED_EXTENSIONS.has(ext)) {
    return {
      category: "SENSITIVE_FILENAME",
      action: "block",
      matched: name,
    };
  }

  return null;
}

export function scanFilenames(filenames: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of filenames) {
    const result = scanFilename(f);
    if (result) findings.push(result);
  }
  return findings;
}
