import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import zlib from "node:zlib";

vi.mock("@/config-loader", () => ({ initializeConfigs: vi.fn() }));
vi.mock("@/audit/retention", () => ({ initRetentionScheduler: vi.fn() }));
vi.mock("@/proxy/channels", () => ({ resolveChannel: vi.fn(() => null) }));
vi.mock("@/proxy/forwarder", () => ({ forwardRequest: vi.fn() }));
vi.mock("@/audit/logger", () => ({ logAudit: vi.fn(() => 1) }));
vi.mock("@/bypass/store", () => ({ findMatchingBypassRule: vi.fn(() => null) }));

import { POST } from "@/app/[...path]/route";
import { forwardRequest } from "@/proxy/forwarder";

const mockForward = vi.mocked(forwardRequest);
const PHONE = "13812345678";

function chatRequest() {
  return new NextRequest("http://localhost:3000/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: `我的手机 ${PHONE}` }] }),
  });
}

const cleanRequest = () =>
  new NextRequest("http://localhost:3000/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hello" }] }),
  });

// 模拟 undici 行为:body 已解压、content-encoding 头保留;并从转发的脱敏体里取回真实占位符
function echoPlaceholderResponse(encodingHeaders: Record<string, string>, wrap: (s: string) => Buffer | string) {
  mockForward.mockImplementation(async (_path, _request, body) => {
    const masked = typeof body === "string" ? body : "";
    const tag = masked.match(/\{\{PHONE_[bcdfghjkmnpqrstvwxz]+\}\}/)?.[0] ?? "{{PHONE_missing}}";
    const payload = JSON.stringify({ choices: [{ message: { content: `已记录 ${tag}` } }] });
    return new Response(wrap(payload), {
      status: 200,
      headers: { "content-type": "application/json", ...encodingHeaders },
    });
  });
}

describe("route: 压缩响应头体一致性", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gzip 非流式:重发摘 content-encoding,占位符还原为原文", async () => {
    echoPlaceholderResponse({ "content-encoding": "gzip" }, (s) => s);

    const res = await POST(chatRequest());

    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toContain(PHONE);
  });

  it("zstd 非流式:网关自解压后还原,摘 content-encoding", async () => {
    echoPlaceholderResponse({ "content-encoding": "zstd" }, (s) => zlib.zstdCompressSync(Buffer.from(s)));

    const res = await POST(chatRequest());

    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toContain(PHONE);
  });

  it("二进制透传路径:gzip 已解压时同样摘头,字节不变", async () => {
    mockForward.mockResolvedValue(
      new Response("BINARY-DATA", {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-encoding": "gzip" },
      })
    );

    const res = await POST(cleanRequest());

    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("BINARY-DATA");
  });

  it("未知编码(compress)透传:保留原头与字节,不做还原", async () => {
    mockForward.mockResolvedValue(
      new Response("opaque", {
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "compress" },
      })
    );

    const res = await POST(cleanRequest());

    expect(res.headers.get("content-encoding")).toBe("compress");
    expect(await res.text()).toBe("opaque");
  });
});
