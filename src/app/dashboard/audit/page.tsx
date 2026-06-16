"use client";

import { AuditTable } from "@/components/audit-table";
import { useLocale } from "@/i18n";

export default function AuditPage() {
  const { t } = useLocale();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-bold tracking-tight">{t("audit.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("audit.desc")}</p>
      </div>
      <AuditTable />
    </div>
  );
}
