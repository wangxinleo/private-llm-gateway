import type { FindingCategory } from "@/types";
import { TAG_RE, categoryShortCode, randomConsonant5 } from "./mask-tag";

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

  tagFor(category: FindingCategory, value: string): string {
    if (TAG_RE.test(value)) {
      return this.tags.get(value) ?? value;
    }

    const key = `${category}\0${value}`;
    const existing = this.keyToTag.get(key);
    if (existing) return existing;

    let tag = this.mintTag(category);
    while (this.tags.has(tag)) {
      tag = this.mintTag(category);
    }
    this.keyToTag.set(key, tag);
    this.tags.set(tag, value);
    return tag;
  }

  private mintTag(category: FindingCategory): string {
    return `{{${categoryShortCode(category)}_${this.rollSuffix()}}}`;
  }
}
