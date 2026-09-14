import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config")>();
  return { ...actual, DB_PATH: join(tmpdir(), `words-test-${process.pid}`, "audit.sqlite") };
});

import { getDb } from "@/audit/store";
import { bulkCreateWords, createWord, deleteWord, getWordsVersion, listWords, updateWord, validateRegex } from "@/words/store";
import { safeLabelShortCode, scanCustomWords } from "@/scanner/custom-words";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";
import { parseEnvContent } from "@/lib/env-import";
import { SCANNER_RULES, DEFAULT_RULE_TOGGLES } from "@/config";

const tmpDir = join(tmpdir(), `words-test-${process.pid}`);

function seed(items: Array<{ label: string; value: string; kind?: "word" | "regex"; wholeWord?: boolean }>) {
  bulkCreateWords(items.map((i) => ({ label: i.label, value: i.value, kind: i.kind ?? "word", wholeWord: i.wholeWord })));
}

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  getDb().exec("DELETE FROM custom_words");
});

describe("words store", () => {
  it("CRUD bumps the content version on every write", () => {
    const v0 = getWordsVersion();
    const created = createWord({ label: "代号", value: "凤凰计划", kind: "word" });
    expect(created.id).toBeGreaterThan(0);
    const v1 = getWordsVersion();
    expect(v1).not.toBe(v0);

    updateWord(created.id, { wholeWord: true });
    expect(getWordsVersion()).not.toBe(v1);

    expect(deleteWord(created.id)).toBe(true);
    expect(listWords()).toEqual([]);
  });

  it("bulk create inserts all items and bumps version once observable", () => {
    const before = getWordsVersion();
    const created = bulkCreateWords([
      { label: "ENV", value: "sk-aaaabbbb", kind: "word" },
      { label: "ENV", value: "p@ssw0rd", kind: "word" },
    ]);
    expect(created).toBe(2);
    expect(getWordsVersion()).not.toBe(before);
    expect(listWords().length).toBe(2);
  });

  it("validateRegex rejects broken patterns", () => {
    expect(validateRegex("^abc$")).toBe(true);
    expect(validateRegex("a(")).toBe(false);
  });
});

describe("scanCustomWords", () => {
  it("matches words full-text and derives safe-label shortcodes", () => {
    seed([{ label: "PROJ", value: "凤凰计划" }]);
    const findings = scanCustomWords("启动 凤凰计划 阶段二");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("CUSTOM_TERM");
    expect(findings[0]?.matched).toBe("凤凰计划");
    expect(findings[0]?.shortCode).toBe("PROJ");
  });

  it("single-char words match CJK adjacency but not inside latin words", () => {
    seed([{ label: "TERM", value: "密" }]);
    expect(scanCustomWords("这是机密文件")[0]?.matched).toBe("密");
    expect(scanCustomWords("dirk密arker")).toHaveLength(0);
  });

  it("whole_word boundary constrains latin adjacency, CJK substring still hits (documented deviation)", () => {
    seed([
      { label: "TERM", value: "foo", wholeWord: true },
      { label: "TERM", value: "张三", wholeWord: true },
    ]);
    expect(scanCustomWords("foobar and foo")[0]?.matched).toBe("foo");
    expect(scanCustomWords("张三丰出场").filter((f) => f.matched === "张三")).toHaveLength(1);
  });

  it("longer words win over shorter overlapping entries", () => {
    seed([
      { label: "A", value: "项目" },
      { label: "B", value: "保密项目" },
    ]);
    const findings = scanCustomWords("这是保密项目文件");
    expect(findings.map((f) => f.matched)).toEqual(["保密项目"]);
  });

  it("regex entries compile and invalid regex entries are skipped without throwing", () => {
    bulkCreateWords([
      { label: "CODE", value: "NOPE-\\d{4}", kind: "regex" },
      { label: "BAD", value: "a(", kind: "regex" },
    ]);
    const findings = scanCustomWords("单号 NOPE-1234 试试");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.matched).toBe("NOPE-1234");
    expect(findings[0]?.shortCode).toBe("CODE");
  });

  it("cache invalidates by content version, not size (equal-length swap)", () => {
    seed([
      { label: "P", value: "张三丰" },
      { label: "P", value: "李四" },
    ]);
    expect(scanCustomWords("张三丰和李四")).toHaveLength(2);

    // 等长换词:张三丰→王五麻,李四→赵六(总长度不变)
    const rows = listWords();
    updateWord(rows[0]!.id, { value: "王五麻" });
    updateWord(rows[1]!.id, { value: "赵六" });
    const after = scanCustomWords("张三丰和李四 王五麻与赵六");
    expect(after.map((f) => f.matched).sort()).toEqual(["赵六", "王五麻"].sort());
  });

  it("disabled rows do not match", () => {
    const created = createWord({ label: "T", value: "绝密", kind: "word" });
    expect(scanCustomWords("绝密文件")).toHaveLength(1);
    updateWord(created.id, { enabled: false });
    expect(scanCustomWords("绝密文件")).toHaveLength(0);
  });

  it("non-letter-leading labels fall back to TERM shortcode", () => {
    expect(safeLabelShortCode("客户名单")).toBe("TERM");
    expect(safeLabelShortCode("3D项目")).toBe("TERM");
    expect(safeLabelShortCode("proj-alpha")).toBe("PROJALPHA");
    expect(safeLabelShortCode("极长标签超出十二个字符宽度会被截断")).toBe("TERM");
  });
});

describe("pipeline integration", () => {
  beforeEach(() => {
    Object.assign(SCANNER_RULES, DEFAULT_RULE_TOGGLES);
  });

  it("masks custom words into registry tags and restores them back", () => {
    seed([{ label: "PROJ", value: "凤凰计划" }]);
    const registry = new MaskRegistry();
    const body = JSON.stringify({ messages: [{ role: "user", content: "推进凤凰计划落地" }] });
    const result = runPipeline(body, body.length, [], registry);
    expect(result.action).toBe("mask");
    expect(result.maskedBody).not.toContain("凤凰计划");
    expect(result.maskedBody).toMatch(/\{\{PROJ_[bcdfghjkmnpqrstvwxz]{5}\}\}/);

    // 还原:占位符 → 原文(双向映射)
    const tag = result.maskedBody.match(/\{\{PROJ_[bcdfghjkmnpqrstvwxz]{5}\}\}/)?.[0] ?? "";
    expect(registry.tagToValue.get(tag)).toBe("凤凰计划");
  });

  it("disabling CUSTOM_TERM stops custom findings", () => {
    seed([{ label: "T", value: "凤凰计划" }]);
    const body = JSON.stringify({ messages: [{ role: "user", content: "推进凤凰计划" }] });
    expect(runPipeline(body, body.length, []).action).toBe("mask");
    SCANNER_RULES.CUSTOM_TERM = false;
    const result = runPipeline(body, body.length, []);
    expect(result.findings.some((f) => f.category === "CUSTOM_TERM")).toBe(false);
    SCANNER_RULES.CUSTOM_TERM = true;
  });
});

describe("parseEnvContent", () => {
  it("parses KEY=VALUE lines, strips quotes, skips comments and empties", () => {
    const content = [
      "# comment",
      "",
      "OPENAI_API_KEY=sk-xxx123",
      'DB_PASSWORD="p@ssw0rd"',
      "export SECRET='abc def'",
      "EMPTY=",
      "not a pair",
    ].join("\n");
    const entries = parseEnvContent(content);
    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ["OPENAI_API_KEY", "sk-xxx123"],
      ["DB_PASSWORD", "p@ssw0rd"],
      ["SECRET", "abc def"],
    ]);
    expect(entries.every((e) => e.selected)).toBe(true);
  });
});
