import { getDb } from "./store";
import { pruneAuditBefore, pruneSignalsBefore } from "./signals-store";
import { RUNTIME } from "@/config";
import { Logger } from "@/log";

const log = new Logger("retention");

let timer: NodeJS.Timeout | null = null;

export function pruneExpired(): { audit: number; signals: number } {
  const days = RUNTIME.logRetentionDays;
  if (!Number.isFinite(days) || days <= 0) return { audit: 0, signals: 0 };
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const audit = pruneAuditBefore(cutoff);
  const signals = pruneSignalsBefore(cutoff);
  return { audit, signals };
}

export function initRetentionScheduler(): void {
  if (timer) return;
  const run = () => {
    try {
      const { audit, signals } = pruneExpired();
      if (audit > 0 || signals > 0) {
        log.info(`retention pruned | days: ${RUNTIME.logRetentionDays} | audit: ${audit} | signals: ${signals}`);
      }
    } catch (err) {
      log.error("retention prune failed", err instanceof Error ? err.message : String(err));
    }
  };
  run();
  timer = setInterval(run, 3_600_000);
  timer.unref?.();
}
