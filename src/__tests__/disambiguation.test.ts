import { describe, it, expect } from "vitest";
import { applyDisambiguation } from "@/proxy/disambiguation";
import type { ScanResult, FindingCategory } from "@/types";

function makeMaskResult(categories: FindingCategory[], maskedBody: string): ScanResult {
  return {
    findings: categories.map(c => ({
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

  it("injects notice into first message for chat JSON", () => {
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
  });

  it("injects _privacy_meta for plain JSON object without messages", () => {
    const body = JSON.stringify({ data: "email: <<PRIVACY_MASK:EMAIL>>" });
    const result = makeMaskResult(["EMAIL"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed._privacy_meta).toBeDefined();
    expect(parsed._privacy_meta.masked).toBe(true);
    expect(parsed._privacy_meta.mask_types).toContain("EMAIL");
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

  it("includes multiple categories in mask_types for _privacy_meta", () => {
    const body = JSON.stringify({
      info: "contact <<PRIVACY_MASK:EMAIL>> at <<PRIVACY_MASK:PHONE>>",
    });
    const result = makeMaskResult(["EMAIL", "PHONE"], body);
    const output = applyDisambiguation({
      contentType: "application/json",
      maskedBody: body,
      scanResult: result,
    });
    const parsed = JSON.parse(output);
    expect(parsed._privacy_meta.mask_types).toEqual(
      expect.arrayContaining(["EMAIL", "PHONE"])
    );
  });

  it("preserves original content in JSON message prefix injection", () => {
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
    expect(parsed.messages[0].content).toContain("Hello world");
    expect(parsed.messages[0].content).toContain("[Privacy notice]");
  });
});
