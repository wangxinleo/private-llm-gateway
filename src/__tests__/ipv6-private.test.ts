import { beforeEach, describe, expect, it } from "vitest";
import { scanPii } from "@/scanner/pii";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";
import { SCANNER_RULES, DEFAULT_RULE_TOGGLES } from "@/config";

function values(text: string, category: string): string[] {
  return scanPii(text)
    .filter((f) => f.category === category)
    .map((f) => f.matched);
}

describe("IPV6_PRIVATE 规则（fe80::/10 链路本地 + fc00::/7 ULA，默认关）", () => {
  beforeEach(() => {
    Object.assign(SCANNER_RULES, DEFAULT_RULE_TOGGLES);
  });

  it("默认关：不开开关不产生 findings", () => {
    expect(values("节点 fe80::1 与 fd00::5", "IPV6_PRIVATE")).toEqual([]);
    expect(DEFAULT_RULE_TOGGLES.IPV6_PRIVATE).toBe(false);
  });

  it("开启后命中：链路本地与 ULA 基础形态", () => {
    SCANNER_RULES.IPV6_PRIVATE = true;
    expect(values("节点 fe80::1 掉了", "IPV6_PRIVATE")).toEqual(["fe80::1"]);
    expect(values("ULA fc00::5 与 fd12:3456:789a::1", "IPV6_PRIVATE")).toEqual(["fc00::5", "fd12:3456:789a::1"]);
    expect(values("边界 febf:ffff::1 与 fdff::1", "IPV6_PRIVATE")).toEqual(["febf:ffff::1", "fdff::1"]);
  });

  it("开启后命中：大小写混合 / zone id / 方括号 / 键值形态", () => {
    SCANNER_RULES.IPV6_PRIVATE = true;
    expect(values("混合大小写 Fe80::1 也命中", "IPV6_PRIVATE")).toEqual(["Fe80::1"]);
    expect(values("带 zone 的 fe80::1%eth0 命中", "IPV6_PRIVATE")).toEqual(["fe80::1%eth0"]);
    expect(values("方括号 [fd00::5] 命中", "IPV6_PRIVATE")).toEqual(["fd00::5"]);
    expect(values("IPV6:fe80::1", "IPV6_PRIVATE")).toEqual(["fe80::1"]);
    expect(values("gateway:fd00::5", "IPV6_PRIVATE")).toEqual(["fd00::5"]);
  });

  it("不命中：文档段 / 环回 / 公网 / MAC / 无冒号 / 版本串", () => {
    SCANNER_RULES.IPV6_PRIVATE = true;
    expect(values("文档段 2001:db8::1 放行", "IPV6_PRIVATE")).toEqual([]);
    expect(values("环回 ::1 放行", "IPV6_PRIVATE")).toEqual([]);
    expect(values("公网 2606:4700::1111 放行", "IPV6_PRIVATE")).toEqual([]);
    expect(values("全零 :: 放行", "IPV6_PRIVATE")).toEqual([]);
    expect(values("MAC aa:bb:cc:dd:ee:ff 放行", "IPV6_PRIVATE")).toEqual([]);
    expect(values("无冒号 fc00 不成地址", "IPV6_PRIVATE")).toEqual([]);
    expect(values("8 组公网 1:2:3:4:5:6:7:8", "IPV6_PRIVATE")).toEqual([]);
    expect(values("端口 8080 与时间 12:30", "IPV6_PRIVATE")).toEqual([]);
  });

  it("端到端：命中经管线脱敏为 IPV6PRIV 占位符", () => {
    SCANNER_RULES.IPV6_PRIVATE = true;
    const registry = new MaskRegistry();
    const result = runPipeline("内网地址 fe80::1 请勿外传", 26, [], registry);
    expect(result.action).toBe("mask");
    expect(result.maskedBody).toContain("{{IPV6PRIV_");
    expect(result.maskedBody).not.toContain("fe80::1");
    expect(registry.size).toBe(1);
  });
});
