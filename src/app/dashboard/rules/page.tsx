"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useLocale } from "@/i18n";

const SECRET_CATEGORIES = [
  "PRIVATE_KEY", "BEARER_TOKEN", "BASIC_AUTH", "JWT",
  "COOKIE_HEADER", "SET_COOKIE_HEADER", "DB_URI",
  "AWS_ACCESS_KEY", "GITHUB_TOKEN", "SLACK_TOKEN", "GOOGLE_API_KEY",
];

const PII_RULES = [
  { category: "PHONE", tag: "<<PRIVACY_MASK:PHONE>>", validationKey: "rules.validation.cnMobile" },
  { category: "EMAIL", tag: "<<PRIVACY_MASK:EMAIL>>", validationKey: "rules.validation.email" },
  { category: "ID_CARD", tag: "<<PRIVACY_MASK:ID_CARD>>", validationKey: "rules.validation.idCard" },
  { category: "BANK_CARD", tag: "<<PRIVACY_MASK:BANK_CARD>>", validationKey: "rules.validation.bankCard" },
];

const BLOCKED_EXTENSIONS = [".env", ".pem", ".key", ".p12", ".pfx", ".npmrc", ".pypirc"];
const BLOCKED_NAMES = ["id_rsa", "id_dsa", "authorized_keys", "known_hosts", "credentials.json", "service-account.json", "secrets.yaml", "secrets.yml", "prod.env", "config.prod"];

const HIGH_RISK_KEYWORDS_PREVIEW = [
  "key", "api_key", "apikey", "secret", "secret_key", "client_secret",
  "token", "access_token", "refresh_token", "authorization", "password",
  "cookie", "x-api-key", "service_account", "clientid", "clientsecret",
];

function ActionBadge({ action, label }: { action: "mask" | "block" | "allow"; label: string }) {
  const variant = action === "block" ? "destructive" : action === "mask" ? "warning" : "success";
  return <Badge variant={variant} className="font-mono text-[10px]">{label}</Badge>;
}

export default function RulesPage() {
  const { t } = useLocale();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-bold tracking-tight">{t("rules.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("rules.desc")}</p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-sm tracking-wide">
            <Badge variant="destructive" className="font-mono text-[10px]">11 RULES</Badge>
            {t("rules.credentialStrong")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {SECRET_CATEGORIES.map((cat) => (
              <div key={cat} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
                <div className="flex items-center gap-3">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{cat}</code>
                  <span className="text-sm text-muted-foreground">{t(`rules.desc.${cat}`)}</span>
                </div>
                <ActionBadge action="mask" label={t("action.mask")} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-sm tracking-wide">
            <Badge variant="warning" className="font-mono text-[10px]">64 KEYWORDS</Badge>
            {t("rules.contextKey")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("rules.contextKeyDesc")}</p>
          <div className="flex flex-wrap gap-1.5">
            {HIGH_RISK_KEYWORDS_PREVIEW.map((kw) => (
              <code key={kw} className="rounded border border-border/30 bg-muted/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{kw}</code>
            ))}
            <code className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">{t("rules.moreKeywords")}</code>
          </div>
          <Separator />
          <div className="grid grid-cols-3 gap-4 font-mono text-xs">
            <div><span className="text-muted-foreground">{t("rules.length")}: </span><span className="text-foreground">8–200</span></div>
            <div><span className="text-muted-foreground">{t("rules.charset")}: </span><span className="text-foreground">[A-Za-z0-9._=-]</span></div>
            <div><span className="text-muted-foreground">{t("rules.maxSpaces")}: </span><span className="text-foreground">2</span></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("rules.action")}:</span>
            <ActionBadge action="mask" label={t("action.mask")} />
            <span className="font-mono text-xs text-muted-foreground">→ &lt;&lt;PRIVACY_MASK:CONTEXTUAL_SECRET&gt;&gt;</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-sm tracking-wide">
            <Badge variant="warning" className="font-mono text-[10px]">4 RULES</Badge>
            {t("rules.piiMasking")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {PII_RULES.map((rule) => (
              <div key={rule.category} className="flex items-center justify-between rounded-md border border-border/30 px-3 py-2">
                <div className="flex items-center gap-3">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{rule.category}</code>
                  <span className="font-mono text-xs text-muted-foreground">→ {rule.tag}</span>
                </div>
                <span className="text-sm text-muted-foreground">{t(rule.validationKey)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("rules.action")}:</span>
            <ActionBadge action="mask" label={t("action.mask")} />
            <span className="text-sm text-muted-foreground">{t("rules.replacedForwarded")}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-sm tracking-wide">
            <Badge variant="destructive" className="font-mono text-[10px]">BLOCK</Badge>
            {t("rules.filename")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("rules.blockedExtensions")}</p>
            <div className="flex flex-wrap gap-1.5">
              {BLOCKED_EXTENSIONS.map((ext) => (<code key={ext} className="rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 font-mono text-xs text-destructive">{ext}</code>))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("rules.blockedFilenames")}</p>
            <div className="flex flex-wrap gap-1.5">
              {BLOCKED_NAMES.map((name) => (<code key={name} className="rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 font-mono text-xs text-destructive">{name}</code>))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("rules.action")}:</span>
            <ActionBadge action="block" label={t("action.block")} />
            <span className="text-sm text-muted-foreground">{t("rules.requestRejected")}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="font-mono text-sm tracking-wide">{t("rules.actionPolicy")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-3"><ActionBadge action="block" label={t("action.block")} /><span className="text-muted-foreground">{t("rules.policy.block")}</span></div>
            <div className="flex items-center gap-3"><ActionBadge action="mask" label={t("action.mask")} /><span className="text-muted-foreground">{t("rules.policy.mask")}</span></div>
            <div className="flex items-center gap-3"><ActionBadge action="allow" label={t("action.allow")} /><span className="text-muted-foreground">{t("rules.policy.allow")}</span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
