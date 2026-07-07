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
    <aside className="fixed inset-x-0 top-0 z-30 flex h-16 border-b border-sidebar-border bg-sidebar/95 backdrop-blur-xl md:inset-y-0 md:left-0 md:h-auto md:w-56 md:flex-col md:border-b-0 md:border-r">
      <Link href="/dashboard" className="flex h-16 shrink-0 items-center gap-2.5 px-4 md:h-14 md:border-b md:border-sidebar-border md:px-5">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <span className="hidden font-mono text-sm font-semibold tracking-tight text-foreground sm:inline">PRIVACY&nbsp;PROXY</span>
      </Link>
      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-2 md:block md:space-y-1 md:overflow-visible md:px-3 md:py-4">
        {NAV_KEYS.map(({ href, labelKey, icon: Icon }) => {
          const active = href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-[background-color,color,transform] duration-200 hover:-translate-y-0.5 active:translate-y-px md:gap-3",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--color-primary)]"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline md:inline">{t(labelKey)}</span>
            </Link>
          );
        })}
      </nav>
      <div className="hidden border-t border-sidebar-border px-3 py-3 md:block">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="min-w-0 truncate whitespace-nowrap font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {t("nav.version")}
          </p>
          <button
            type="button"
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm leading-none text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Languages className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">{locale === "zh" ? "EN" : "中文"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
