"use client";

import { AuditTable } from "@/components/audit-table";
import { useLocale } from "@/i18n";

export default function AuditPage() {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold leading-tight tracking-[-0.035em]">{t("audit.title")}</h1>
        <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">{t("audit.desc")}</p>
      </div>
      <AuditTable />
    </div>
  );
}
