import { describe, it, expect } from "vitest";
import { MaskRegistry } from "@/scanner/mask-registry";
import { TAG_RE, CONSONANTS, createSuffixDeriver, type SuffixDeriver } from "@/scanner/mask-tag";

function suffixOf(tag: string): string {
  const m = /\{\{[A-Z][A-Z0-9_]*_(.{5})\}\}$/.exec(tag);
  if (!m) throw new Error(`not a v3 tag: ${tag}`);
  return m[1]!;
}

describe("MaskRegistry", () => {
  it("dedupes same (category, value) to the same tag", () => {
    const registry = new MaskRegistry();
    const t1 = registry.tagFor("PHONE", "13912345678");
    const t2 = registry.tagFor("PHONE", "13912345678");
    expect(t1).toBe(t2);
    expect(registry.size).toBe(1);
    expect(registry.tagToValue.get(t1)).toBe("13912345678");
  });

  it("same value in different categories gets distinct tags", () => {
    const byCategory: SuffixDeriver = (category) => (category === "PHONE" ? "aaaaa" : "bbbbb");
    const registry = new MaskRegistry(byCategory);
    const phone = registry.tagFor("PHONE", "13912345678");
    const secret = registry.tagFor("CONTEXTUAL_SECRET", "13912345678");
    expect(phone).toBe("{{PHONE_aaaaa}}");
    expect(secret).toBe("{{SECRET_bbbbb}}");
    expect(registry.size).toBe(2);
  });

  it("distinct values get distinct tags with 5-consonant suffixes", () => {
    const registry = new MaskRegistry();
    const t1 = registry.tagFor("EMAIL", "a@example.com");
    const t2 = registry.tagFor("EMAIL", "b@example.com");
    expect(t1).not.toBe(t2);
    for (const tag of [t1, t2]) {
      expect(tag).toMatch(TAG_RE);
      const suffix = suffixOf(tag);
      expect(suffix).toHaveLength(5);
      for (const ch of suffix) {
        expect(CONSONANTS).toContain(ch);
      }
    }
  });

  it("collision chain walks attempt 1 when attempt 0 is taken", () => {
    const byAttempt: SuffixDeriver = (_cat, _value, attempt) => (attempt === 0 ? "aaaaa" : "bbbbb");
    const registry = new MaskRegistry(byAttempt);
    const t1 = registry.tagFor("PHONE", "13912345678");
    const t2 = registry.tagFor("PHONE", "13912345679");
    expect(t1).toBe("{{PHONE_aaaaa}}");
    expect(t2).toBe("{{PHONE_bbbbb}}");
    expect(registry.size).toBe(2);
    expect(registry.tagToValue.get(t1)).toBe("13912345678");
    expect(registry.tagToValue.get(t2)).toBe("13912345679");
  });

  it("exhausted attempt chain falls back to random reroll with bijection kept", () => {
    const alwaysSame: SuffixDeriver = () => "aaaaa";
    const registry = new MaskRegistry(alwaysSame);
    const t1 = registry.tagFor("PHONE", "13912345678");
    const t2 = registry.tagFor("PHONE", "13912345679");
    expect(t1).toBe("{{PHONE_aaaaa}}");
    expect(t2).not.toBe(t1);
    expect(t2).toMatch(TAG_RE);
    expect(registry.tagToValue.get(t1)).toBe("13912345678");
    expect(registry.tagToValue.get(t2)).toBe("13912345679");
  });

  it("anti-recursion: a registered tag maps back to its real value", () => {
    const registry = new MaskRegistry();
    const value = "user@example.com";
    const tag = registry.tagFor("EMAIL", value);
    expect(registry.tagFor("EMAIL", tag)).toBe(value);
    expect(registry.size).toBe(1);
  });

  it("anti-recursion: grammar-shaped value not in registry is returned as-is, never wrapped", () => {
    const registry = new MaskRegistry();
    const value = "{{EMAIL_TRWMQ}}";
    expect(registry.tagFor("EMAIL", value)).toBe(value);
    expect(registry.size).toBe(0);
  });

  it("registries are isolated from each other", () => {
    const r1 = new MaskRegistry(() => "aaaaa");
    const r2 = new MaskRegistry(() => "bbbbb");
    const t1 = r1.tagFor("PHONE", "13912345678");
    const t2 = r2.tagFor("PHONE", "13912345678");
    expect(t1).toBe("{{PHONE_aaaaa}}");
    expect(t2).toBe("{{PHONE_bbbbb}}");
    expect(r1.tagToValue.get(t2)).toBeUndefined();
    expect(r2.tagToValue.get(t1)).toBeUndefined();
    expect(r1.tagFor("PHONE", "13912345678")).toBe(t1);
    expect(r2.tagFor("PHONE", "13912345678")).toBe(t2);
  });

  it("strict tag-to-value bijection holds for 200 distinct values", () => {
    const registry = new MaskRegistry();
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(registry.tagFor("PHONE", `1391234${String(i).padStart(4, "0")}`));
    }
    expect(seen.size).toBe(200);
    expect(registry.size).toBe(200);
  });
});

describe("salted deterministic suffixes (G7)", () => {
  it("cross-request determinism: independent registries map same (category, value) identically", () => {
    const request1 = new MaskRegistry();
    const request2 = new MaskRegistry();
    const a1 = request1.tagFor("PHONE", "13912345678");
    const a2 = request2.tagFor("PHONE", "13912345678");
    expect(a1).toBe(a2);
    // 异值仍异 tag(同一进程、同一密钥)
    const b1 = request1.tagFor("PHONE", "13912345679");
    const b2 = request2.tagFor("PHONE", "13912345679");
    expect(b1).toBe(b2);
    expect(a1).not.toBe(b1);
    // 跨类别仍区分
    expect(request1.tagFor("CONTEXTUAL_SECRET", "13912345678")).not.toBe(a1);
  });

  it("fixed secret yields stable suffixes across deriver instances (restart/replica simulation)", () => {
    const secret = Buffer.from("unit-test-fixed-secret-0123456789", "utf8");
    const d1 = createSuffixDeriver(secret);
    const d2 = createSuffixDeriver(secret);
    expect(d1("PHONE", "13912345678", 0)).toBe(d2("PHONE", "13912345678", 0));
    expect(d1("PHONE", "13912345678", 1)).toBe(d2("PHONE", "13912345678", 1));
    // 不同 attempt 产出不同后缀(冲突链可用)
    expect(d1("PHONE", "13912345678", 0)).not.toBe(d1("PHONE", "13912345678", 1));
  });

  it("different secrets yield different suffixes (oracle closed without secret)", () => {
    const s1 = createSuffixDeriver(Buffer.from("secret-one-0123456789abcdef", "utf8"));
    const s2 = createSuffixDeriver(Buffer.from("secret-two-fedcba9876543210", "utf8"));
    expect(s1("PHONE", "13912345678", 0)).not.toBe(s2("PHONE", "13912345678", 0));
  });

  it("default deriver output is 5 consonants, grammar-compatible", () => {
    const registry = new MaskRegistry();
    const tag = registry.tagFor("PHONE", "13912345678");
    expect(tag).toMatch(TAG_RE);
    for (const ch of suffixOf(tag)) {
      expect(CONSONANTS).toContain(ch);
    }
  });
});
