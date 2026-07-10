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

  it("injects text prefix for plain text content type", () => {
    const result = makeMaskResult(["EMAIL"], "Contact <<PRIVACY_MASK:EMAIL>> for details");
    const output = applyDisambiguation({
      contentType: "text/plain",
      maskedBody: result.maskedBody,
      scanResult: result,
    });
    expect(output).toContain("[Privacy notice]");
    expect(output).toContain("Contact <<PRIVACY_MASK:EMAIL>> for details");
  });

  it("injects notice into system message for chat JSON", () => {
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
    expect(parsed.messages[0].content).toContain("[Privacy notice]");
    expect(parsed.messages[0].content).toContain("You are helpful.");
    expect(parsed.messages[1].content).toBe("My email is <<PRIVACY_MASK:EMAIL>>");
    assertNoCustomMeta(parsed);
  });

  it("prefers top-level system field over messages for Anthropic-style payloads", () => {
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
    expect(parsed.system).toContain("[Privacy notice]");
    expect(parsed.system).toContain("You are careful.");
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

  it("falls back to text prefix for invalid JSON in application/json content type", () => {
    const result = makeMaskResult(["PHONE"], "call <<PRIVACY_MASK:PHONE>>");
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: "not valid json",
      scanResult: result,
    });
    expect(output).toContain("[Privacy notice]");
    expect(output).toContain("not valid json");
  });

  it("injects notice into prompt field without adding custom JSON properties", () => {
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

  it("prepends a system message when only a user multimodal message exists", () => {
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
    expect(parsed.messages[0].role).toBe("system");
    expect(parsed.messages[0].content).toContain("[Privacy notice]");
    expect(parsed.messages[1].content[0].text).toBe("hello <<PRIVACY_MASK:EMAIL>>");
    expect(parsed.messages[1].content[1].type).toBe("image_url");
    assertNoCustomMeta(parsed);
  });

  it("prepends a system message when chat messages have no writable text content", () => {
    const body = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }],
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
    expect(parsed.messages[0].role).toBe("system");
    expect(parsed.messages[0].content).toContain("[Privacy notice]");
    expect(parsed.messages[1].role).toBe("user");
    assertNoCustomMeta(parsed);
  });

  it("preserves user content when prepending a system notice", () => {
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
    expect(parsed.messages[0].role).toBe("system");
    expect(parsed.messages[0].content).toContain("[Privacy notice]");
    expect(parsed.messages[1].content).toBe("Hello world");
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

  it("injects notice into Anthropic-style system field array", () => {
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
    expect(parsed.system[0].text).toContain("[Privacy notice]");
    expect(parsed.system[0].text).toContain("You are careful.");
    expect(parsed.system[1].text).toBe("Additional context.");
    expect(parsed.messages[0].content).toBe("email <<PRIVACY_MASK:EMAIL>>");
    assertNoCustomMeta(parsed);
  });

  it("injects notice into developer role message", () => {
    const body = JSON.stringify({
      model: "o1",
      messages: [
        { role: "developer", content: "Follow these rules." },
        { role: "user", content: "data <<PRIVACY_MASK:PHONE>>" },
      ],
    });
    const result = makeMaskResult(["PHONE"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed.messages[0].content).toContain("[Privacy notice]");
    expect(parsed.messages[0].content).toContain("Follow these rules.");
    expect(parsed.messages[1].content).toBe("data <<PRIVACY_MASK:PHONE>>");
    assertNoCustomMeta(parsed);
  });

  it("does not duplicate notice when body already starts with notice prefix", () => {
    const body = JSON.stringify({
      messages: [
        { role: "system", content: "[Privacy notice] existing notice\n\nYou are helpful." },
        { role: "user", content: "<<PRIVACY_MASK:EMAIL>>" },
      ],
    });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    const count = (parsed.messages[0].content.match(/\[Privacy notice\]/g) || []).length;
    expect(count).toBe(1);
    assertNoCustomMeta(parsed);
  });

  it("does not duplicate notice on repeated text prefix injection", () => {
    const result = makeMaskResult(["EMAIL"], "<<PRIVACY_MASK:EMAIL>>");
    const firstOutput = applyDisambiguation({
      contentType: "text/plain",
      maskedBody: result.maskedBody,
      scanResult: result,
    });
    const secondOutput = applyDisambiguation({
      contentType: "text/plain",
      maskedBody: firstOutput,
      scanResult: result,
    });
    const count = (secondOutput.match(/\[Privacy notice\]/g) || []).length;
    expect(count).toBe(1);
  });
});
