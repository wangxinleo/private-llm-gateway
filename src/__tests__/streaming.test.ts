import { describe, it, expect } from "vitest";
import { createStreamingResponse } from "@/proxy/streaming";

describe("createStreamingResponse", () => {
  it("creates a ReadableStream from upstream body", async () => {
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
        controller.enqueue(new TextEncoder().encode("data: world\n\n"));
        controller.close();
      },
    });

    const upstream = new Response(upstreamBody, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "content-encoding": "gzip",
        "content-length": "100",
      },
    });

    const result = createStreamingResponse(upstream);

    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("text/event-stream");
    expect(result.headers.get("content-encoding")).toBeNull();
    expect(result.headers.get("content-length")).toBeNull();

    const reader = result.body!.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const text = chunks.map((c) => new TextDecoder().decode(c)).join("");
    expect(text).toBe("data: hello\n\ndata: world\n\n");
  });

  it("handles null upstream body", () => {
    const upstream = new Response(null, { status: 204 });
    const result = createStreamingResponse(upstream);
    expect(result.status).toBe(204);
    expect(result.body).toBeNull();
  });

  it("handles stream cancellation", async () => {
    let cancelled = false;
    const upstreamBody = new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("data: chunk1\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });

    const upstream = new Response(upstreamBody, { status: 200 });
    const result = createStreamingResponse(upstream);
    const reader = result.body!.getReader();

    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toBe("data: chunk1\n\n");

    await reader.cancel();
    expect(cancelled).toBe(true);
  });
});
