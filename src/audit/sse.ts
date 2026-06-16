type AuditSubscriber = (msg: string) => void;

const subscribers = new Set<AuditSubscriber>();

export function subscribeAudit(fn: AuditSubscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function broadcastAudit(event: Record<string, unknown>): void {
  const data = JSON.stringify(event);
  const msg = `event: audit\ndata: ${data}\n\n`;
  for (const fn of subscribers) {
    try {
      fn(msg);
    } catch {
      subscribers.delete(fn);
    }
  }
}
