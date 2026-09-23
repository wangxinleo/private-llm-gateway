// 上游/流式失败的诊断字段(借鉴 maskit v0.4.0 `c7dc3ca` 的 err/resp/req/ms 设计,不复制代码):
// resp=0 表示回包前连接已死(典型=复用的空闲连接被上游关掉),resp=1 表示上游已开始回包、
// 中途断开——两者现象都是 connection closed 但修法不同。只承载类型名/错误码/数字,
// 绝不携带错误消息与上游地址(502 响应体与日志前缀的零泄漏契约)。
// 用 type 而非 interface:审计信号 detail 需要 Record<string, unknown> 的隐式索引签名
// (interface 不满足该赋值,type 别名满足)
export type UpstreamErrorTrace = {
  err: string;
  code?: string;
  resp: 0 | 1;
  req?: number;
  out?: number;
  ms: number;
};

export interface UpstreamErrorContext {
  resp: 0 | 1;
  req?: number;
  out?: number;
  ms: number;
}

// undici 的 fetch 失败外层恒为 TypeError("fetch failed"),有诊断价值的是 cause 的类型名
function errorName(err: unknown): string {
  if (err instanceof Error) {
    const cause = "cause" in err ? (err as { cause?: unknown }).cause : undefined;
    if (cause instanceof Error) return cause.name;
    return err.name;
  }
  return typeof err;
}

// 错误码先在 cause 上找(fetch 失败的外层 TypeError 无码),再退到错误自身
// (流式 body 出错时 undici 直接抛带 code 的 SocketError)
function errorCode(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const cause = "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  for (const candidate of [cause, err]) {
    if (candidate && typeof candidate === "object" && "code" in candidate) {
      const code = (candidate as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
  }
  return undefined;
}

export function describeUpstreamError(err: unknown, ctx: UpstreamErrorContext): UpstreamErrorTrace {
  const trace: UpstreamErrorTrace = {
    err: errorName(err),
    resp: ctx.resp,
    ms: Number(ctx.ms.toFixed(1)),
  };
  const code = errorCode(err);
  if (code) trace.code = code;
  if (ctx.req !== undefined) trace.req = ctx.req;
  if (ctx.out !== undefined) trace.out = ctx.out;
  return trace;
}

export function formatUpstreamError(trace: UpstreamErrorTrace): string {
  const parts = [`err=${trace.err}`];
  if (trace.code) parts.push(`code=${trace.code}`);
  parts.push(`resp=${trace.resp}`);
  if (trace.req !== undefined) parts.push(`req=${trace.req}B`);
  if (trace.out !== undefined) parts.push(`out=${trace.out}B`);
  parts.push(`ms=${trace.ms}`);
  return `[${parts.join(" ")}]`;
}
