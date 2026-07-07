export interface ItemSummary<T extends string = string> {
  item: T;
  count: number;
}

export function summarizeItems<T extends string>(items: T[]): ItemSummary<T>[] {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return Array.from(counts, ([item, count]) => ({ item, count }));
}

export function formatSummaryLabel({ item, count }: ItemSummary): string {
  return count > 1 ? `${item} × ${count}` : item;
}

export function getFindingVariant(finding: string): "destructive" | "warning" | "outline" {
  if (finding === "SENSITIVE_FILENAME") return "destructive";
  return ["PHONE", "EMAIL", "ID_CARD", "BANK_CARD"].includes(finding) ? "warning" : "outline";
}
