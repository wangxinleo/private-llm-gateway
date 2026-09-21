import { Readable, Transform } from "node:stream";
import zlib from "node:zlib";

// undici 内置 fetch 自动解压的编码集合(实测:gzip/deflate/br 解压但保留响应头;
// zstd 完全不处理)。转发侧据此过滤 accept-encoding,再发出侧据此归一 content-encoding。
const DECODED_BY_HTTP_CLIENT: ReadonlySet<string> = new Set(["gzip", "x-gzip", "deflate", "br"]);

// @types/node(20.x)尚未收录 zstd API,运行时(Node ≥22.15)已可用 → 特性检测 + 类型断言;
// 运行时不支持时 zstd 归类为 unknown(原样透传),绝不因解压能力缺失而破坏响应。
interface ZstdCapableZlib {
  zstdDecompressSync?: (buf: Uint8Array) => Buffer;
  createZstdDecompress?: () => Transform;
}
const zstd = zlib as unknown as ZstdCapableZlib;

export function hasZstdSupport(): boolean {
  return typeof zstd.zstdDecompressSync === "function" && typeof zstd.createZstdDecompress === "function";
}

function codingName(token: string): string {
  return token.split(";")[0]?.trim().toLowerCase() ?? "";
}

// 保留网关可解码的编码(连同 q 参数原样),剔除 zstd 与未知编码;
// 过滤后为空时显式 identity(缺头语义=任意编码,不能裸交给上游)。
export function filterAcceptEncoding(value: string): string {
  const kept = value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => {
      const name = codingName(token);
      return DECODED_BY_HTTP_CLIENT.has(name) || name === "identity";
    });
  return kept.length > 0 ? kept.join(", ") : "identity";
}

export type ContentEncodingKind = "none" | "decoded" | "zstd" | "unknown";

export function classifyContentEncoding(headers: Headers): ContentEncodingKind {
  const raw = headers.get("content-encoding");
  if (!raw) return "none";
  const tokens = raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return "none";
  if (tokens.every((token) => token === "identity")) return "none";
  if (tokens.every((token) => DECODED_BY_HTTP_CLIENT.has(token))) return "decoded";
  if (tokens.every((token) => token === "zstd")) return hasZstdSupport() ? "zstd" : "unknown";
  return "unknown";
}

// 头体一致性:客户端已解压的编码必须摘头,否则客户端会二次解压明文而失败
export function stripDecodedContentEncoding(headers: Headers): void {
  if (classifyContentEncoding(headers) === "decoded") headers.delete("content-encoding");
}

export function decodeZstdBuffer(buf: Uint8Array): string {
  const decompress = zstd.zstdDecompressSync;
  if (!decompress) throw new Error("zstd decompression unavailable in this Node runtime");
  return decompress(buf).toString("utf8");
}

export function decodeZstdStream(
  body: ReadableStream<Uint8Array<ArrayBuffer>>
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const makeDecompressor = zstd.createZstdDecompress;
  if (!makeDecompressor) throw new Error("zstd decompression unavailable in this Node runtime");
  const node = Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
  return Readable.toWeb(node.pipe(makeDecompressor())) as unknown as ReadableStream<Uint8Array<ArrayBuffer>>;
}
