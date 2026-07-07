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
            <main id="main-content" className="flex-1 overflow-auto pt-16 md:ml-56 md:pt-0">
              <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 md:py-7">{children}</div>
            </main>
          </div>
        </AdminLoginGate>
      </AdminAuthProvider>
    </I18nProvider>
  );
}
