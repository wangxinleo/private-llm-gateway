"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FileText,
  Shield,
  Settings,
  ShieldCheck,
  Languages,
  PanelLeft,
  Moon,
  Sun,
  BookLock,
  Network,
} from "lucide-react";
import { useLocale } from "@/i18n";
import { useAdminAuth } from "@/lib/admin-auth-context";

const NAV_KEYS = [
  { href: "/dashboard", labelKey: "nav.overview", icon: LayoutDashboard },
  { href: "/dashboard/audit", labelKey: "nav.audit", icon: FileText },
  { href: "/dashboard/rules", labelKey: "nav.rules", icon: Shield },
  { href: "/dashboard/words", labelKey: "nav.words", icon: BookLock },
  { href: "/dashboard/clients", labelKey: "nav.clients", icon: Network },
  { href: "/dashboard/settings", labelKey: "nav.settings", icon: Settings },
] as const;

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);
  const toggle = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
      try {
        localStorage.setItem("pp_theme", next ? "dark" : "light");
      } catch {
        /* 仅内存态 */
      }
      return next;
    });
  }, []);
  return { dark, toggle };
}

/** 网关存活探测：30s 轻量轮询 /api/admin/stats，驱动顶栏状态点 */
function useGatewayHealth() {
  const { authedFetch } = useAdminAuth();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const r = await authedFetch("/api/admin/stats");
        if (!cancelled) setOnline(r.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    probe();
    const timer = setInterval(probe, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [authedFetch]);
  return online;
}

function SidebarNavItems({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLocale();
  return (
    <>
      {NAV_KEYS.map(({ href, labelKey, icon: Icon }) => {
        const active = href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            title={collapsed ? t(labelKey) : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition-colors duration-150",
              active
                ? "bg-gradient-to-r from-primary/15 to-primary/5 text-primary"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              collapsed && "justify-center px-0"
            )}
          >
            <span
              className={cn(
                "absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                active ? "opacity-100" : "opacity-0"
              )}
            />
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{t(labelKey)}</span>}
          </Link>
        );
      })}
    </>
  );
}

function ThemeToggle({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Light" : "Dark"}
      aria-label="Toggle theme"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function LangToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
      title={locale === "zh" ? "English" : "中文"}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Languages className="h-4 w-4" />
      <span>{locale === "zh" ? "EN" : "中"}</span>
    </button>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { dark, toggle } = useTheme();
  const online = useGatewayHealth();
  const { t } = useLocale();
  const pathname = usePathname();

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("pp_sidebar_collapsed") === "1");
    } catch {
      /* 默认展开 */
    }
  }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("pp_sidebar_collapsed", c ? "0" : "1");
      } catch {
        /* 仅内存态 */
      }
      return !c;
    });
  }, []);

  const pageTitle = (() => {
    const item = NAV_KEYS.find(({ href }) =>
      href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href)
    );
    return item ? t(item.labelKey) : "";
  })();

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* ===== 侧边栏（桌面） ===== */}
      <aside
        className={cn(
          "relative hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 md:flex",
          collapsed ? "w-[52px]" : "w-56"
        )}
      >
        <div className={cn("flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-3", collapsed && "justify-center px-0")}>
          <ShieldCheck className="h-7 w-7 shrink-0 text-primary" />
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold leading-tight">Privacy Proxy</span>
              </div>
              <div className="truncate text-[10px] font-medium leading-tight text-muted-foreground">
                {t("nav.version")}
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          <SidebarNavItems collapsed={collapsed} />
        </nav>

        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand" : "Collapse"}
          className="flex h-9 shrink-0 items-center justify-center border-t border-sidebar-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <PanelLeft className={cn("h-4 w-4 transition-transform duration-300", collapsed && "rotate-180")} />
        </button>
      </aside>

      {/* ===== 主区 ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-md md:px-5">
          {/* 移动端品牌 */}
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2 md:hidden">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </Link>

          {/* 状态点 + 分隔线 + 页面标题 */}
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span
                className={cn(
                  "inline-flex h-2.5 w-2.5 rounded-full",
                  online
                    ? "bg-success shadow-[0_0_6px_hsl(152_60%_45%/0.5)]"
                    : "bg-destructive shadow-[0_0_8px_hsl(0_72%_51%/0.6)] animate-pulse"
                )}
              />
            </span>
            <span className="hidden text-[13px] font-medium sm:inline">{online ? t("status.online") : t("status.offline")}</span>
            <span className="hidden h-3.5 w-px bg-border/80 sm:inline" />
            <h1 className="hidden truncate text-[15px] font-bold tracking-tight sm:inline">{pageTitle}</h1>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <LangToggle />
            <ThemeToggle dark={dark} toggle={toggle} />
          </div>
        </header>

        {/* 移动端横向导航 */}
        <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1.5 md:hidden">
          <SidebarNavItems collapsed={false} />
        </nav>

        {/* relative:Radix Checkbox 隐藏 bubble input 的包含块,防止其逃逸到 html 撑出第二条滚动条 */}
        <main id="main-content" className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto h-full w-full max-w-[1200px] p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
