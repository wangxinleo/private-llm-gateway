type AuditSubscriber = (msg: string) => void;

const subscribers = new Set<AuditSubscriber>();

export function subscribeAudit(fn: AuditSubscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function dispatch(msg: string): void {
  for (const fn of subscribers) {
    try {
      fn(msg);
    } catch {
      subscribers.delete(fn);
    }
  }
}

export function broadcastAudit(event: Record<string, unknown>): void {
  dispatch(`event: audit\ndata: ${JSON.stringify(event)}\n\n`);
}

// 既有行的字段回填(如响应侧还原统计):客户端按 id 就地合并,不重复插入
export function broadcastAuditUpdate(event: Record<string, unknown>): void {
  dispatch(`event: audit_update\ndata: ${JSON.stringify(event)}\n\n`);
}
