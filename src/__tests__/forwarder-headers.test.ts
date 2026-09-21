import { describe, expect, it } from "vitest";
import http from "node:http";
import { forwardRequest } from "@/proxy/forwarder";

// 2026-09-21 1MB 压测发现:curl 对大体积 POST(>1KB)默认带 Expect: 100-continue,
// 透传后 undici 抛 UND_ERR_NOT_SUPPORTED → 所有大请求 502。以下锁定头净化契约。

function startEcho(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let len = 0;
      req.on("data", (c) => (len += c.length));
      req.on("end", () => {
        const body = JSON.stringify({ headers: req.headers, bodyLen: len });
        res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
        res.end(body);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

describe("forwardRequest 请求头净化", () => {
  it("Expect 与逐跳头不透传,业务头（Authorization/自定义）照常", async () => {
    const echo = await startEcho();
    const saved = process.env.UPSTREAM_URL;
    process.env.UPSTREAM_URL = echo.url;
    try {
      const request = new Request("http://gateway.local/v1/chat/completions", {
        method: "POST",
        duplex: "half",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer sk-test-123",
          expect: "100-continue",
          upgrade: "websocket",
          te: "trailers",
          "x-custom": "keep-me",
        },
        body: JSON.stringify({ hello: "world" }),
      });

      // 与路由调用一致:显式传体(路由始终传 maskedBody/原文,流分支不在此用例覆盖)
      const upstream = await forwardRequest("/v1/chat/completions", request, JSON.stringify({ hello: "world" }));
      const seen = (await upstream.json()) as { headers: Record<string, string>; bodyLen: number };

      expect(seen.headers.expect).toBeUndefined();
      expect(seen.headers.upgrade).toBeUndefined();
      expect(seen.headers.te).toBeUndefined();
      expect(seen.headers.authorization).toBe("Bearer sk-test-123");
      expect(seen.headers["content-type"]).toBe("application/json");
      expect(seen.headers["x-custom"]).toBe("keep-me");
      expect(seen.bodyLen).toBeGreaterThan(0);
    } finally {
      if (saved === undefined) delete process.env.UPSTREAM_URL;
      else process.env.UPSTREAM_URL = saved;
      await echo.close();
    }
  });
});
