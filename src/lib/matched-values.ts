export function maskMatchedValue(value: string): string {
  if (value.length === 0) return "";
  if (value.length <= 4) return "**";
  if (value.length <= 8) return `${value.slice(0, 2)}**${value.slice(-2)}`;
  return `${value.slice(0, 4)}**${value.slice(-4)}`;
}
