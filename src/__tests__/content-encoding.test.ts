import { afterAll, describe, expect, it } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import {
  classifyContentEncoding,
  decodeZstdBuffer,
  filterAcceptEncoding,
  stripDecodedContentEncoding,
} from "@/proxy/content-encoding";
import { createStreamingResponse } from "@/proxy/streaming";
import { forwardRequest } from "@/proxy/forwarder";

const SSE_PAYLOAD = 'data: {"choices":[{"delta":{"content":"{{EMAIL_abcde}} ok"}}]}\n\n';

function startServer(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

describe("filterAcceptEncoding", () => {
  it("剔除 zstd,保留可解码编码与 q 参数", () => {
    expect(filterAcceptEncoding("gzip, deflate, br, zstd")).toBe("gzip, deflate, br");
    expect(filterAcceptEncoding("gzip;q=1.0, zstd;q=0.5")).toBe("gzip;q=1.0");
    expect(filterAcceptEncoding("br, gzip")).toBe("br, gzip");
    expect(filterAcceptEncoding("GZIP, ZSTD")).toBe("GZIP");
  });

  it("只剩不可解码编码时回退 identity(缺头语义=任意编码,不能裸交给上游)", () => {
    expect(filterAcceptEncoding("zstd")).toBe("identity");
    expect(filterAcceptEncoding("compress, zstd")).toBe("identity");
    expect(filterAcceptEncoding("*")).toBe("identity");
  });

  it("identity 原样保留", () => {
    expect(filterAcceptEncoding("identity")).toBe("identity");
    expect(filterAcceptEncoding("identity;q=0.5, zstd")).toBe("identity;q=0.5");
  });
});

describe("classifyContentEncoding / stripDecodedContentEncoding", () => {
  const headersWith = (value: string | null) => {
    const h = new Headers();
    if (value) h.set("content-encoding", value);
    return h;
  };

  it("分类: none / decoded / zstd / unknown", () => {
    expect(classifyContentEncoding(headersWith(null))).toBe("none");
    expect(classifyContentEncoding(headersWith("identity"))).toBe("none");
    expect(classifyContentEncoding(headersWith("gzip"))).toBe("decoded");
    expect(classifyContentEncoding(headersWith("gzip, br"))).toBe("decoded");
    expect(classifyContentEncoding(headersWith("ZSTD"))).toBe("zstd");
    expect(classifyContentEncoding(headersWith("zstd, gzip"))).toBe("unknown");
    expect(classifyContentEncoding(headersWith("compress"))).toBe("unknown");
  });

  it("只对 decoded 摘头", () => {
    const decoded = headersWith("gzip");
    stripDecodedContentEncoding(decoded);
    expect(decoded.get("content-encoding")).toBeNull();

    const zstd = headersWith("zstd");
    stripDecodedContentEncoding(zstd);
    expect(zstd.get("content-encoding")).toBe("zstd");
  });
});

describe("压缩响应实链(本地服务器 + undici fetch)", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  async function serve(handler: http.RequestListener) {
    const s = await startServer(handler);
    servers.push(s);
    return `http://127.0.0.1:${s.port}/`;
  }

  it("gzip SSE:重发头无 content-encoding,文本完整(旧实现头体错配)", async () => {
    const url = await serve((_req, res) => {
      const body = zlib.gzipSync(Buffer.from(SSE_PAYLOAD));
      res.writeHead(200, { "content-type": "text/event-stream", "content-encoding": "gzip" });
      res.end(body);
    });
    const upstream = await fetch(url);
    const wrapped = createStreamingResponse(upstream);
    expect(wrapped.headers.get("content-encoding")).toBeNull();
    expect(await readAll(wrapped.body!)).toBe(SSE_PAYLOAD);
  });

  it("zstd SSE:自行解压后输出明文且摘头", async () => {
    const url = await serve((_req, res) => {
      const body = zlib.zstdCompressSync(Buffer.from(SSE_PAYLOAD));
      res.writeHead(200, { "content-type": "text/event-stream", "content-encoding": "zstd" });
      res.end(body);
    });
    const upstream = await fetch(url);
    expect(classifyContentEncoding(upstream.headers)).toBe("zstd");
    const wrapped = createStreamingResponse(upstream);
    expect(wrapped.headers.get("content-encoding")).toBeNull();
    expect(await readAll(wrapped.body!)).toBe(SSE_PAYLOAD);
  });

  it("zstd 非流式:decodeZstdBuffer 得明文", async () => {
    const url = await serve((_req, res) => {
      const body = zlib.zstdCompressSync(Buffer.from(JSON.stringify({ ok: "{{PHONE_abcde}}" })));
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "zstd" });
      res.end(body);
    });
    const upstream = await fetch(url);
    const text = decodeZstdBuffer(new Uint8Array(await upstream.arrayBuffer()));
    expect(JSON.parse(text)).toEqual({ ok: "{{PHONE_abcde}}" });
  });

  it("forwardRequest 向上游宣告的 accept-encoding 已剔除 zstd", async () => {
    const url = await serve((req, res) => {
      const body = JSON.stringify({ acceptEncoding: req.headers["accept-encoding"] ?? null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    });
    const saved = process.env.UPSTREAM_URL;
    process.env.UPSTREAM_URL = url;
    try {
      const request = new Request("http://gateway.local/v1/chat/completions", {
        method: "POST",
        headers: { "accept-encoding": "gzip, deflate, br, zstd" },
      });
      const upstream = await forwardRequest("/v1/chat/completions", request);
      const echoed = (await upstream.json()) as { acceptEncoding: string | null };
      expect(echoed.acceptEncoding).toBe("gzip, deflate, br");
    } finally {
      process.env.UPSTREAM_URL = saved;
    }
  });
});
