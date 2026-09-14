import type { FindingCategory } from "@/types";
import { TAG_RE, categoryShortCode, randomConsonant5 } from "./mask-tag";

// 自定义词分类派生的短码须满足占位符文法(字母开头),否则回退类别默认短码
const CUSTOM_SHORTCODE_RE = /^[A-Z][A-Z0-9_]{0,11}$/;

export class MaskRegistry {
  private readonly keyToTag = new Map<string, string>();
  private readonly tags = new Map<string, string>();

  constructor(private readonly rollSuffix: () => string = randomConsonant5) {}

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

    let tag = this.mintTag(category, shortCode);
    while (this.tags.has(tag)) {
      tag = this.mintTag(category, shortCode);
    }
    this.keyToTag.set(key, tag);
    this.tags.set(tag, value);
    return tag;
  }

  private mintTag(category: FindingCategory, shortCode?: string): string {
    const code = shortCode && CUSTOM_SHORTCODE_RE.test(shortCode) ? shortCode : categoryShortCode(category);
    return `{{${code}_${this.rollSuffix()}}}`;
  }
}
