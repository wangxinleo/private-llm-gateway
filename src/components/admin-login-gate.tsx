"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { useLocale } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, ShieldCheck } from "lucide-react";

export function AdminLoginGate({ children }: { children: React.ReactNode }) {
  const { authenticated, login } = useAdminAuth();
  const { t } = useLocale();
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (authenticated) return <>{children}</>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const nextKey = key.trim();

    if (!nextKey) {
      setError(t("auth.invalidKey"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/config", { headers: { "x-admin-key": nextKey } });
      if (res.ok) {
        login(nextKey);
        router.refresh();
        return;
      }

      setError(res.status === 401 ? t("auth.invalidKey") : t("auth.notConfigured"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-5 rounded-2xl border border-border/45 bg-card/90 p-7 shadow-[0_24px_80px_oklch(0.07_0.02_175/0.34)] backdrop-blur-xl sm:p-8">
        <div className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 shadow-[inset_0_1px_0_oklch(1_0_0/0.08)]">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold leading-tight tracking-[-0.03em]">{t("auth.title")}</h1>
            <p className="max-w-[34rem] text-sm leading-6 text-muted-foreground">{t("auth.desc")}</p>
          </div>
        </div>
        <label className="block space-y-2 text-sm">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5" />
            {t("auth.adminKeyLabel")}
          </span>
          <Input
            name="adminKey"
            type="password"
            placeholder={t("auth.placeholder")}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoFocus
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "admin-key-error" : undefined}
          />
        </label>
        {error && <p id="admin-key-error" role="alert" className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {t("auth.login")}
        </Button>
      </form>
    </div>
  );
}
