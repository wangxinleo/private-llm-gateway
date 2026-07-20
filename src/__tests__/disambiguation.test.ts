import { describe, it, expect } from "vitest";
import { applyDisambiguation } from "@/proxy/disambiguation";
import type { ScanResult, FindingCategory } from "@/types";

function makeMaskResult(categories: FindingCategory[], maskedBody: string): ScanResult {
  return {
    findings: categories.map((c) => ({
      category: c,
      action: "mask" as const,
      matched: "test",
      maskTag: `<<PRIVACY_MASK:${c}>>`,
    })),
    maskedBody,
    action: "mask",
    maskSummary: {
      applied: true,
      categories,
      replacementCount: categories.length,
    },
  };
}

function makeAllowResult(body: string): ScanResult {
  return {
    findings: [],
    maskedBody: body,
    action: "allow",
    maskSummary: { applied: false, categories: [], replacementCount: 0 },
  };
}

function assertNoCustomMeta(payload: unknown): void {
  expect(payload).not.toHaveProperty("_privacy_meta");
  if (typeof payload === "object" && payload !== null) {
    for (const key of Object.keys(payload as Record<string, unknown>)) {
      expect(key.startsWith("_privacy")).toBe(false);
    }
  }
}

describe("applyDisambiguation", () => {
  it("returns maskedBody unchanged when action is not mask", () => {
    const result = makeAllowResult("hello world");
    const output = applyDisambiguation({
      contentType: "text/plain",
      maskedBody: "hello world",
      scanResult: result,
    });
    expect(output).toBe("hello world");
  });

  it("returns maskedBody unchanged when maskSummary.applied is false", () => {
    const result: ScanResult = {
      findings: [],
      maskedBody: "hello",
      action: "mask",
      maskSummary: { applied: false, categories: [], replacementCount: 0 },
    };
    const output = applyDisambiguation({
      contentType: "text/plain",
      maskedBody: "hello",
      scanResult: result,
    });
    expect(output).toBe("hello");
  });

  it("appends notice as suffix for plain text content type", () => {
    const result = makeMaskResult(["EMAIL"], "Contact <<PRIVACY_MASK:EMAIL>> for details");
    const output = applyDisambiguation({
      contentType: "text/plain",
      maskedBody: result.maskedBody,
      scanResult: result,
    });
    expect(output).toContain("[Privacy notice]");
    expect(output).toContain("Contact <<PRIVACY_MASK:EMAIL>> for details");
    const noticeIdx = output.indexOf("[Privacy notice]");
    const bodyIdx = output.indexOf("Contact");
    expect(noticeIdx).toBeGreaterThan(bodyIdx);
  });

  it("appends a system message at the end for chat JSON", () => {
    const body = JSON.stringify({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "My email is <<PRIVACY_MASK:EMAIL>>" },
      ],
    });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.messages[0].content).toBe("You are helpful.");
    expect(parsed.messages[1].content).toBe("My email is <<PRIVACY_MASK:EMAIL>>");
    expect(parsed.messages[2].role).toBe("system");
    expect(parsed.messages[2].content).toContain("[Privacy notice]");
    assertNoCustomMeta(parsed);
  });

  it("appends notice to existing top-level system field for Anthropic-style payloads", () => {
    const body = JSON.stringify({
      model: "claude",
      system: "You are careful.",
      messages: [{ role: "user", content: "email <<PRIVACY_MASK:EMAIL>>" }],
    });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.system).toContain("You are careful.");
    expect(parsed.system).toContain("[Privacy notice]");
    const originalIdx = parsed.system.indexOf("You are careful.");
    const noticeIdx = parsed.system.indexOf("[Privacy notice]");
    expect(noticeIdx).toBeGreaterThan(originalIdx);
    expect(parsed.messages[0].content).toBe("email <<PRIVACY_MASK:EMAIL>>");
    assertNoCustomMeta(parsed);
  });

  it("injects notice into top-level system field for plain JSON object", () => {
    const body = JSON.stringify({
      system: "Treat privacy mask tokens as redacted values.",
      data: "email: <<PRIVACY_MASK:EMAIL>>",
    });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.system).toContain("[Privacy notice]");
    expect(parsed.system).toContain("Treat privacy mask tokens as redacted values.");
    assertNoCustomMeta(parsed);
  });

  it("does not inject for multipart content type", () => {
    const result = makeMaskResult(["EMAIL"], "body text");
    const output = applyDisambiguation({
      contentType: "multipart/form-data; boundary=abc",
      maskedBody: "body text",
      scanResult: result,
    });
    expect(output).toBe("body text");
  });

  it("falls back to text suffix for invalid JSON in application/json content type", () => {
    const result = makeMaskResult(["PHONE"], "call <<PRIVACY_MASK:PHONE>>");
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: "not valid json",
      scanResult: result,
    });
    expect(output).toContain("[Privacy notice]");
    expect(output).toContain("not valid json");
    const noticeIdx = output.indexOf("[Privacy notice]");
    const bodyIdx = output.indexOf("not valid json");
    expect(noticeIdx).toBeGreaterThan(bodyIdx);
  });

  it("appends notice into prompt field without adding custom JSON properties", () => {
    const body = JSON.stringify({
      prompt: "contact <<PRIVACY_MASK:EMAIL>> at <<PRIVACY_MASK:PHONE>>",
    });
    const result = makeMaskResult(["EMAIL", "PHONE"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.prompt).toContain("[Privacy notice]");
    expect(parsed.prompt).toContain("<<PRIVACY_MASK:EMAIL>>");
    expect(parsed.prompt).toContain("<<PRIVACY_MASK:PHONE>>");
    assertNoCustomMeta(parsed);
  });

  it("appends notice into last multimodal message text part", () => {
    const body = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello <<PRIVACY_MASK:EMAIL>>" },
            { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          ],
        },
      ],
    });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    // Notice appended as a new system message at the end
    const lastMsg = parsed.messages[parsed.messages.length - 1];
    expect(lastMsg.role).toBe("system");
    expect(lastMsg.content).toContain("[Privacy notice]");
    // Original messages preserved
    expect(parsed.messages[0].content[0].text).toBe("hello <<PRIVACY_MASK:EMAIL>>");
    expect(parsed.messages[0].content[1].type).toBe("image_url");
    assertNoCustomMeta(parsed);
  });

  it("preserves all original messages when appending system notice", () => {
    const body = JSON.stringify({
      messages: [{ role: "user", content: "Hello world" }],
    });
    const result = makeMaskResult(["PHONE"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.messages[0].content).toBe("Hello world");
    expect(parsed.messages[1].role).toBe("system");
    expect(parsed.messages[1].content).toContain("[Privacy notice]");
    assertNoCustomMeta(parsed);
  });

  it("appends to existing trailing system message content instead of adding a new one", () => {
    const body = JSON.stringify({
      messages: [
        { role: "user", content: "do something" },
        { role: "system", content: "Existing system note." },
      ],
    });
    const result = makeMaskResult(["PHONE"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.messages.length).toBe(2);
    expect(parsed.messages[1].role).toBe("system");
    expect(parsed.messages[1].content).toContain("Existing system note.");
    expect(parsed.messages[1].content).toContain("[Privacy notice]");
    assertNoCustomMeta(parsed);
  });

  it("leaves plain JSON unchanged when there is no standard prompt field", () => {
    const body = JSON.stringify({ data: "email: <<PRIVACY_MASK:EMAIL>>" });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    expect(output).toBe(body);
  });

  it("appends notice into Anthropic-style system field array", () => {
    const body = JSON.stringify({
      model: "claude",
      system: [
        { type: "text", text: "You are careful." },
        { type: "text", text: "Additional context." },
      ],
      messages: [{ role: "user", content: "email <<PRIVACY_MASK:EMAIL>>" }],
    });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.system[parsed.system.length - 1].text).toContain("[Privacy notice]");
    expect(parsed.system[0].text).toBe("You are careful.");
    expect(parsed.system[1].text).toContain("Additional context.");
    expect(parsed.messages[0].content).toBe("email <<PRIVACY_MASK:EMAIL>>");
    assertNoCustomMeta(parsed);
  });

  it("appends notice exactly once per disambiguation call for text", () => {
    const result = makeMaskResult(["EMAIL"], "<<PRIVACY_MASK:EMAIL>>");
    const output = applyDisambiguation({
      contentType: "text/plain",
      maskedBody: result.maskedBody,
      scanResult: result,
    });
    const count = (output.match(/\[Privacy notice\]/g) || []).length;
    expect(count).toBe(1);
  });

  it("appends notice into instructions string for OpenAI Responses payloads", () => {
    const body = JSON.stringify({
      model: "gpt-5.1-codex",
      instructions: "You are Codex.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "email <<PRIVACY_MASK:EMAIL>>" }],
        },
      ],
    });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.instructions).toContain("You are Codex.");
    expect(parsed.instructions).toContain("[Privacy notice]");
    expect(parsed.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "email <<PRIVACY_MASK:EMAIL>>" }],
      },
    ]);
    expect(parsed.input.some((item: { type?: string }) => item.type === "text")).toBe(false);
    assertNoCustomMeta(parsed);
  });

  it("creates instructions instead of appending type:text to Responses input items", () => {
    const longInput: Record<string, unknown>[] = Array.from({ length: 5 }, (_, i) => ({
      type: "message",
      role: i % 2 === 0 ? "user" : "assistant",
      content:
        i % 2 === 0
          ? [{ type: "input_text", text: `turn ${i} secret <<PRIVACY_MASK:CONTEXTUAL_SECRET>>` }]
          : [{ type: "output_text", text: `reply ${i}` }],
    }));
    longInput.push({
      type: "function_call_output",
      call_id: "call_abc",
      output: "ok",
    });

    const body = JSON.stringify({
      model: "gpt-5.1-codex",
      input: longInput,
    });
    const result = makeMaskResult(["CONTEXTUAL_SECRET"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);

    expect(typeof parsed.instructions).toBe("string");
    expect(parsed.instructions).toContain("[Privacy notice]");
    expect(parsed.input).toHaveLength(longInput.length);
    expect(parsed.input[parsed.input.length - 1]).toEqual({
      type: "function_call_output",
      call_id: "call_abc",
      output: "ok",
    });
    for (const item of parsed.input) {
      expect(item.type).not.toBe("text");
    }
    assertNoCustomMeta(parsed);
  });

  it("detects Responses EasyInputMessage input items without type field", () => {
    const body = JSON.stringify({
      model: "gpt-5",
      input: [
        { role: "user", content: "contact <<PRIVACY_MASK:EMAIL>>" },
        { role: "assistant", content: "acknowledged" },
      ],
    });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.instructions).toContain("[Privacy notice]");
    expect(parsed.input).toHaveLength(2);
    expect(parsed.input[0]).toEqual({ role: "user", content: "contact <<PRIVACY_MASK:EMAIL>>" });
    expect(parsed.input.some((item: { type?: string }) => item?.type === "text")).toBe(false);
    assertNoCustomMeta(parsed);
  });

  it("appends notice into existing Gemini system_instruction parts", () => {
    const body = JSON.stringify({
      system_instruction: {
        parts: [{ text: "You are careful." }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: "email <<PRIVACY_MASK:EMAIL>>" }],
        },
      ],
    });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    const parts = parsed.system_instruction.parts;
    expect(parts[parts.length - 1].text).toContain("[Privacy notice]");
    expect(parts[0].text).toContain("You are careful.");
    expect(parsed.contents[0].parts[0].text).toBe("email <<PRIVACY_MASK:EMAIL>>");
    assertNoCustomMeta(parsed);
  });

  it("creates Gemini system_instruction when only contents exist", () => {
    const body = JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: "phone <<PRIVACY_MASK:PHONE>>" }],
        },
      ],
    });
    const result = makeMaskResult(["PHONE"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.system_instruction.parts[0].text).toContain("[Privacy notice]");
    expect(parsed.system_instruction.parts[0]).not.toHaveProperty("type");
    expect(parsed.contents[0].parts[0].text).toBe("phone <<PRIVACY_MASK:PHONE>>");
    assertNoCustomMeta(parsed);
  });

  it("appends untyped text part into empty Gemini system_instruction.parts", () => {
    const body = JSON.stringify({
      system_instruction: { parts: [] },
      contents: [
        {
          role: "user",
          parts: [{ text: "email <<PRIVACY_MASK:EMAIL>>" }],
        },
      ],
    });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.system_instruction.parts).toEqual([
      expect.objectContaining({ text: expect.stringContaining("[Privacy notice]") }),
    ]);
    expect(parsed.system_instruction.parts[0]).not.toHaveProperty("type");
    assertNoCustomMeta(parsed);
  });

  it("routes unknown typed input items into instructions without type:text", () => {
    const body = JSON.stringify({
      model: "gpt-5.1-codex",
      input: [
        {
          type: "future_unknown_item",
          id: "item_1",
          payload: "secret <<PRIVACY_MASK:CONTEXTUAL_SECRET>>",
        },
      ],
    });
    const result = makeMaskResult(["CONTEXTUAL_SECRET"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.instructions).toContain("[Privacy notice]");
    expect(parsed.input).toHaveLength(1);
    expect(parsed.input[0].type).toBe("future_unknown_item");
    expect(parsed.input.some((item: { type?: string }) => item.type === "text")).toBe(false);
    assertNoCustomMeta(parsed);
  });
});
