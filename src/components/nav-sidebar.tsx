"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, FileText, Shield, Settings, ShieldCheck, Languages } from "lucide-react";
import { useLocale } from "@/i18n";

const NAV_KEYS = [
  { href: "/dashboard", labelKey: "nav.overview", icon: LayoutDashboard },
  { href: "/dashboard/audit", labelKey: "nav.audit", icon: FileText },
  { href: "/dashboard/rules", labelKey: "nav.rules", icon: Shield },
  { href: "/dashboard/settings", labelKey: "nav.settings", icon: Settings },
] as const;

export function NavSidebar() {
  const pathname = usePathname();
  const { locale, setLocale, t } = useLocale();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
      <Link href="/dashboard" className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-5">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <span className="font-mono text-sm font-semibold tracking-tight text-foreground">PRIVACY&nbsp;PROXY</span>
      </Link>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_KEYS.map(({ href, labelKey, icon: Icon }) => {
          const active = href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {t(labelKey)}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border px-3 py-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 truncate whitespace-nowrap font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {t("nav.version")}
          </p>
          <button
            type="button"
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm leading-none text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Languages className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">{locale === "zh" ? "EN" : "中文"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
