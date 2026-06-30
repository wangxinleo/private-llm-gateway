import type { Finding } from "@/types";
import { SCANNER_EXCLUSIONS, type ExclusionRule } from "@/config";
import { Logger } from "@/log";

const log = new Logger("exclusions");

export function applyExclusions(
  findings: Finding[],
  rules: ExclusionRule[] = SCANNER_EXCLUSIONS
): Finding[] {
  if (rules.length === 0) return findings;

  const compiled = compileRules(rules);
  if (compiled.length === 0) return findings;

  return findings.filter((f) => {
    for (const rule of compiled) {
      if (rule.category !== f.category) continue;
      if (rule.matches(f.matched)) return false;
    }
    return true;
  });
}

interface CompiledRule {
  category: ExclusionRule["category"];
  matches: (value: string) => boolean;
}

function compileRules(rules: ExclusionRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    if (rule.mode === "exact") {
      compiled.push({
        category: rule.category,
        matches: (v) => v === rule.value,
      });
    } else {
      let re: RegExp;
      try {
        re = new RegExp(rule.value);
      } catch {
        log.warn(`invalid exclusion regex, skipping: ${rule.value}`);
        continue;
      }
      compiled.push({
        category: rule.category,
        matches: (v) => re.test(v),
      });
    }
  }
  return compiled;
}
