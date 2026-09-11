import { describe, it, expect } from "vitest";
import { MaskRegistry } from "@/scanner/mask-registry";
import { TAG_RE, CONSONANTS } from "@/scanner/mask-tag";

function seqGen(...suffixes: string[]): () => string {
  const queue = [...suffixes];
  return () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("suffix sequence exhausted");
    return next;
  };
}

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
    const registry = new MaskRegistry(seqGen("aaaaa", "bbbbb"));
    const phone = registry.tagFor("PHONE", "13912345678");
    const secret = registry.tagFor("CONTEXTUAL_SECRET", "13912345678");
    expect(phone).toBe("{{PHONE_aaaaa}}");
    expect(secret).toBe("{{SECRET_bbbbb}}");
    expect(registry.size).toBe(2);
  });

  it("distinct values get distinct tags with random consonant suffixes", () => {
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

  it("re-rolls on collision with an existing tag in the same request", () => {
    const registry = new MaskRegistry(seqGen("aaaaa", "aaaaa", "bbbbb"));
    const t1 = registry.tagFor("PHONE", "13912345678");
    const t2 = registry.tagFor("PHONE", "13912345679");
    expect(t1).toBe("{{PHONE_aaaaa}}");
    expect(t2).toBe("{{PHONE_bbbbb}}");
    expect(registry.size).toBe(2);
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
    const r1 = new MaskRegistry(seqGen("aaaaa"));
    const r2 = new MaskRegistry(seqGen("bbbbb"));
    const t1 = r1.tagFor("PHONE", "13912345678");
    const t2 = r2.tagFor("PHONE", "13912345678");
    expect(t1).toBe("{{PHONE_aaaaa}}");
    expect(t2).toBe("{{PHONE_bbbbb}}");
    expect(r1.tagToValue.get(t2)).toBeUndefined();
    expect(r2.tagToValue.get(t1)).toBeUndefined();
    expect(r1.tagFor("PHONE", "13912345678")).toBe(t1);
    expect(r2.tagFor("PHONE", "13912345678")).toBe(t2);
  });

  it("re-roll guarantees a strict tag-to-value bijection under random suffixes", () => {
    const registry = new MaskRegistry();
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(registry.tagFor("PHONE", `1391234${String(i).padStart(4, "0")}`));
    }
    expect(seen.size).toBe(200);
    expect(registry.size).toBe(200);
  });
});
