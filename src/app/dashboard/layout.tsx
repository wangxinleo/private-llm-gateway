"use client";

import { NavSidebar } from "@/components/nav-sidebar";
import { AdminLoginGate } from "@/components/admin-login-gate";
import { AdminAuthProvider } from "@/lib/admin-auth-context";
import { I18nProvider } from "@/i18n";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider defaultLocale="zh">
      <AdminAuthProvider>
        <AdminLoginGate>
          <div className="flex min-h-screen">
            <NavSidebar />
            <main className="ml-56 flex-1 overflow-auto">
              <div className="mx-auto max-w-[1440px] px-6 py-6">{children}</div>
            </main>
          </div>
        </AdminLoginGate>
      </AdminAuthProvider>
    </I18nProvider>
  );
}
