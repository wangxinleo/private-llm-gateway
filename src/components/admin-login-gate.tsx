"use client";

import { useState } from "react";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { useLocale } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck } from "lucide-react";

export function AdminLoginGate({ children }: { children: React.ReactNode }) {
  const { authenticated, login } = useAdminAuth();
  const { t } = useLocale();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  if (authenticated) return <>{children}</>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/config", { headers: { "x-admin-key": key } });
    if (res.ok) {
      login(key);
    } else {
      setError(res.status === 401 ? t("auth.invalidKey") : t("auth.notConfigured"));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-border/50 bg-card p-8">
        <div className="flex flex-col items-center gap-2">
          <ShieldCheck className="h-8 w-8 text-primary" />
          <h1 className="font-mono text-lg font-bold tracking-tight">{t("auth.title")}</h1>
          <p className="text-center text-sm text-muted-foreground">{t("auth.desc")}</p>
        </div>
        <Input
          type="password"
          placeholder={t("auth.placeholder")}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
        />
        {error && <p className="text-center text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={!key.trim()}>
          {t("auth.login")}
        </Button>
      </form>
    </div>
  );
}
