import { beforeEach, describe, expect, it } from "vitest";
import { scanPii } from "@/scanner/pii";
import { scanSecretPrefixes } from "@/scanner/secrets";
import { scanFilename } from "@/scanner/filename";
import { runPipeline } from "@/scanner/pipeline";
import { SCANNER_RULES, RUNTIME, DEFAULT_RULE_TOGGLES } from "@/config";

function categories(text: string): string[] {
  return scanPii(text).map((f) => f.category);
}

function values(text: string, category: string): string[] {
  return scanPii(text).filter((f) => f.category === category).map((f) => f.matched);
}

describe("new PII categories (R2.2)", () => {
  beforeEach(() => {
    Object.assign(SCANNER_RULES, DEFAULT_RULE_TOGGLES);
  });

  it("LANDLINE: valid landlines with area code and extension", () => {
    expect(values("拨打 010-65552338 或 021-6555234-12", "LANDLINE")).toEqual(["010-65552338", "021-6555234-12"]);
  });

  it("LANDLINE: rejects mobile-like and leading-1 locals", () => {
    expect(values("手机 13800138000 附近", "LANDLINE")).toEqual([]);
    expect(values("假座机 010-12345678", "LANDLINE")).toEqual([]);
  });

  it("PLATE: valid plates incl. new-energy, rejects digit-less sequences", () => {
    expect(values("车牌 京A12345 开过", "PLATE")).toEqual(["京A12345"]);
    expect(values("新能源 粤BD12345 停车", "PLATE")).toEqual(["粤BD12345"]);
    expect(values("新README 与 沪ABCDEF", "PLATE")).toEqual([]);
  });

  it("IP_PRIVATE: 192.168/169.254/CGNAT enabled by default", () => {
    expect(values("网关 192.168.1.50 和 100.64.0.1 与 169.254.9.9", "IP_PRIVATE").length).toBe(3);
  });

  it("IP_INTERNAL: 10.x/172.16-31 default off, enable via toggle", () => {
    expect(values("内网 10.2.3.4", "IP_INTERNAL")).toEqual([]);
    SCANNER_RULES.IP_INTERNAL = true;
    expect(values("内网 10.2.3.4 与 172.16.0.1", "IP_INTERNAL").length).toBe(2);
    SCANNER_RULES.IP_INTERNAL = false;
    expect(values("版本号 10.2.3.4 不该命中", "IP_INTERNAL")).toEqual([]);
  });

  it("IP boundaries: five-segment sequences are not truncated into an IP", () => {
    expect(values("1.2.3.4.5 版本串", "IP_PRIVATE")).toEqual([]);
    SCANNER_RULES.IP_INTERNAL = true;
    expect(values("1.2.3.4.5 版本串", "IP_INTERNAL")).toEqual([]);
  });

  it("IBAN: mod-97 checksum enforced", () => {
    expect(values("IBAN GB82WEST12345698765432 到账", "IBAN")).toEqual(["GB82WEST12345698765432"]);
    expect(values("坏 IBAN GB82WEST12345698765431 拒绝", "IBAN")).toEqual([]);
  });

  it("USCC: 18-digit charset with excluded letters and check digit", () => {
    SCANNER_RULES.USCC = true;
    expect(values("统一社会信用代码 91350100M000100Y43", "USCC").length).toBe(1);
    expect(values("含排除字 91350100M000100Y4I", "USCC")).toEqual([]);
  });

  it("MAC: consistent separator enforced", () => {
    SCANNER_RULES.MAC = true;
    expect(values("网卡 aa:bb:cc:dd:ee:ff 在线", "MAC")).toEqual(["aa:bb:cc:dd:ee:ff"]);
    expect(values("网卡 aa-bb:cc:dd:ee:ff 混分隔", "MAC")).toEqual([]);
  });

  it("HKID: letter(s)+6 digits+check, default off", () => {
    expect(values("HKID A123456(7)", "HKID")).toEqual([]);
    SCANNER_RULES.HKID = true;
    expect(values("HKID A123456(7)", "HKID")).toEqual(["A123456(7)"]);
  });
});

describe("rule toggles (R2.1)", () => {
  beforeEach(() => {
    Object.assign(SCANNER_RULES, DEFAULT_RULE_TOGGLES);
  });

  it("disabling a category stops producing findings", () => {
    expect(values("call 13800138000 now", "PHONE")).toHaveLength(1);
    SCANNER_RULES.PHONE = false;
    expect(scanPii("call 13800138000 now")).toEqual([]);
  });

  it("filename block rule can be disabled", () => {
    expect(scanFilename("server.pem")?.category).toBe("SENSITIVE_FILENAME");
    SCANNER_RULES.SENSITIVE_FILENAME = false;
    expect(scanFilename("server.pem")).toBeNull();
  });

  it("pipeline honors disabled secret categories", () => {
    // secrets 仅在敏感键值对/资产锚点窗口内扫描,需构造锚点
    const body = JSON.stringify({ messages: [{ role: "user", content: "password: Bearer abcdefghijklmnopqrst1234" }] });
    const enabled = runPipeline(body, body.length, []);
    expect(enabled.findings.some((f) => f.category === "BEARER_TOKEN")).toBe(true);
    SCANNER_RULES.BEARER_TOKEN = false;
    const disabled = runPipeline(body, body.length, []);
    expect(disabled.findings.some((f) => f.category === "BEARER_TOKEN")).toBe(false);
    SCANNER_RULES.BEARER_TOKEN = true;
  });
});

describe("secret prefixes (R2.3)", () => {
  beforeEach(() => {
    Object.assign(SCANNER_RULES, DEFAULT_RULE_TOGGLES);
    RUNTIME.secretPrefixes = ["sk-"];
    RUNTIME.secretPrefixMinLen = 8;
  });

  it("matches 8-char short keys after configured prefix", () => {
    expect(scanSecretPrefixes("our key is sk-abc12345 here")).toEqual([
      expect.objectContaining({ category: "CONTEXTUAL_SECRET", matched: "sk-abc12345" }),
    ]);
  });

  it("does not match demo-like values shorter than the minimum", () => {
    expect(scanSecretPrefixes("use sk-demo locally")).toEqual([]);
  });

  it("supports custom prefixes and configurable min length", () => {
    RUNTIME.secretPrefixes = ["ah-"];
    expect(scanSecretPrefixes("internal: ah-x7k2m9q4")).toEqual([
      expect.objectContaining({ matched: "ah-x7k2m9q4" }),
    ]);
  });

  it("left word boundary prevents partial hits attached to preceding tokens", () => {
    expect(scanSecretPrefixes("token xsk-abc12345")).toEqual([]);
  });
});
