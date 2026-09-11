"use client";

import { DashboardShell } from "@/components/dashboard-shell";
import { AdminLoginGate } from "@/components/admin-login-gate";
import { AdminAuthProvider } from "@/lib/admin-auth-context";
import { I18nProvider } from "@/i18n";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider defaultLocale="zh">
      <AdminAuthProvider>
        <AdminLoginGate>
          <DashboardShell>{children}</DashboardShell>
        </AdminLoginGate>
      </AdminAuthProvider>
    </I18nProvider>
  );
}
