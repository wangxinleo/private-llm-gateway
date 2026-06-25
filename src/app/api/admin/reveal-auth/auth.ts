const REVEAL_TTL_MS = 30 * 60 * 1000;

export const REVEAL_MAX_AGE = 1800;
export const revealTokens = new Map<string, number>();

export function getRevealExpiry(now: number): number {
  return now + REVEAL_TTL_MS;
}

export function cleanupExpiredTokens(now: number): void {
  for (const [token, expiresAt] of revealTokens) {
    if (expiresAt < now) revealTokens.delete(token);
  }
}

function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const prefix = `${name}=`;
  const part = cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : null;
}

export function checkRevealAuth(request: Request): boolean {
  const now = Date.now();
  cleanupExpiredTokens(now);
  const token = getCookie(request, "reveal_token");
  if (!token) return false;
  const expiresAt = revealTokens.get(token);
  return expiresAt !== undefined && expiresAt >= now;
}
