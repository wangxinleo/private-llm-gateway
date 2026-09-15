import type { FindingCategory } from "@/types";
import { TAG_RE, categoryShortCode, deriveConsonantSuffix, randomConsonant5, type SuffixDeriver } from "./mask-tag";

// 自定义词分类派生的短码须满足占位符文法(字母开头),否则回退类别默认短码
const CUSTOM_SHORTCODE_RE = /^[A-Z][A-Z0-9_]{0,11}$/;
// 冲突链最多尝试的确定性派生次数;仍冲突退回随机重掷(见 mask-tag.ts 的 spec 变更说明)
const MAX_DERIVE_ATTEMPTS = 4;

export class MaskRegistry {
  private readonly keyToTag = new Map<string, string>();
  private readonly tags = new Map<string, string>();

  constructor(private readonly deriveSuffix: SuffixDeriver = deriveConsonantSuffix) {}

  get tagToValue(): ReadonlyMap<string, string> {
    return this.tags;
  }

  get size(): number {
    return this.tags.size;
  }

  tagFor(category: FindingCategory, value: string, shortCode?: string): string {
    if (TAG_RE.test(value)) {
      return this.tags.get(value) ?? value;
    }

    const key = `${category}\0${value}`;
    const existing = this.keyToTag.get(key);
    if (existing) return existing;

    const tag = this.mintTag(category, value, shortCode);
    this.keyToTag.set(key, tag);
    this.tags.set(tag, value);
    return tag;
  }

  private mintTag(category: FindingCategory, value: string, shortCode?: string): string {
    const code = shortCode && CUSTOM_SHORTCODE_RE.test(shortCode) ? shortCode : categoryShortCode(category);
    for (let attempt = 0; attempt < MAX_DERIVE_ATTEMPTS; attempt++) {
      const tag = `{{${code}_${this.deriveSuffix(category, value, attempt)}}}`;
      if (!this.tags.has(tag)) return tag;
    }
    let tag = `{{${code}_${randomConsonant5()}}}`;
    while (this.tags.has(tag)) {
      tag = `{{${code}_${randomConsonant5()}}}`;
    }
    return tag;
  }
}
