import { describe, it, expect } from "vitest";
import { isJsonContentType, maskJsonBody } from "@/scanner/json-mask";
import { runPipeline } from "@/scanner/pipeline";
import { MaskRegistry } from "@/scanner/mask-registry";

// 确定性 suffix 用于单值精确断言;同类别多值时仅首值拿到 bcdfg,断言用正则
const PHONE_TAG = /\{\{PHONE_bcdfg\}\}/;
const SECRET_TAG = /\{\{SECRET_[bcdfghjkmnpqrstvwxz]{5}\}\}/;

function makeScan() {
  const registry = new MaskRegistry(() => "bcdfg");
  return { registry, scan: (text: string) => runPipeline(text, text.length, [], registry) };
}

describe("isJsonContentType", () => {
  it("returns true for application/json", () => {
    expect(isJsonContentType("application/json")).toBe(true);
  });

  it("returns true for application/json; charset=utf-8", () => {
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
  });

  it("returns true for application/vnd.api+json", () => {
    expect(isJsonContentType("application/vnd.api+json")).toBe(true);
  });

  it("returns false for text/plain", () => {
    expect(isJsonContentType("text/plain")).toBe(false);
  });

  it("returns false for multipart/form-data", () => {
    expect(isJsonContentType("multipart/form-data; boundary=abc")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isJsonContentType("")).toBe(false);
  });
});

describe("maskJsonBody", () => {
  it("S1: masks PII inside JSON string values, output is valid JSON", () => {
    const body = JSON.stringify({
      model: "gpt-4",
      messages: [
        { role: "user", content: "My phone is 13912345678" },
      ],
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);
    expect(result.action).toBe("mask");

    // Must be parseable as valid JSON
    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.model).toBe("gpt-4");
    expect(parsed.messages[0].content).toContain("{{PHONE_bcdfg}}");
    expect(parsed.messages[0].content).not.toContain("13912345678");
  });

  it("S2: does NOT match JSON number values, output is valid JSON", () => {
    const body = JSON.stringify({
      model: "gpt-4",
      max_tokens: 4096,
      user_id: 1234567890123456,
      timestamp: 1648601234567890,
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);

    // Must be parseable as valid JSON
    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.user_id).toBe(1234567890123456);
    expect(parsed.timestamp).toBe(1648601234567890);
    expect(parsed.max_tokens).toBe(4096);
    // No mask tags in the body
    expect(result.maskedBody).not.toContain("{{");
  });

  it("S3: masks PII in deeply nested JSON string values", () => {
    const body = JSON.stringify({
      data: {
        users: [
          {
            profile: {
              contact: "email: user@example.com",
              notes: ["call 13912345678", "safe text"],
            },
          },
        ],
      },
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);
    expect(result.action).toBe("mask");

    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.data.users[0].profile.contact).toContain("{{EMAIL_bcdfg}}");
    expect(parsed.data.users[0].profile.notes[0]).toContain("{{PHONE_bcdfg}}");
    expect(parsed.data.users[0].profile.notes[1]).toBe("safe text");
  });

  it("S4: masks secrets inside JSON string values", () => {
    const body = JSON.stringify({
      messages: [
        {
          role: "system",
          content: "Authorization: Bearer abc123def456ghi789012",
        },
      ],
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);
    expect(result.action).toBe("mask");

    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.messages[0].content).toContain("{{BEARER_bcdfg}}");
    expect(parsed.messages[0].content).not.toContain("abc123def456ghi789");
  });

  it("S5: preserves JSON structure for complex LLM request", () => {
    const body = JSON.stringify({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Analyze this code:\n```\nconst x = 42;\n```" },
      ],
      temperature: 0.7,
      max_tokens: 2048,
      stream: true,
      n: 1,
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);

    // Even if no PII found, result must be valid JSON
    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.model).toBe("gpt-4");
    expect(parsed.temperature).toBe(0.7);
    expect(parsed.stream).toBe(true);
    expect(parsed.n).toBe(1);
    expect(parsed.messages).toHaveLength(2);
  });

  it("S6: handles empty JSON object", () => {
    const { registry, scan } = makeScan();
    const result = maskJsonBody("{}", scan, registry);
    expect(JSON.parse(result.maskedBody)).toEqual({});
  });

  it("S7: handles JSON array at top level", () => {
    const body = JSON.stringify([
      { text: "phone 13912345678" },
      { text: "no pii here" },
    ]);

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);
    const parsed = JSON.parse(result.maskedBody);
    expect(parsed[0].text).toContain("{{PHONE_bcdfg}}");
    expect(parsed[1].text).toBe("no pii here");
  });

  it("S8: falls back to flat scan for invalid JSON", () => {
    const invalidJson = 'not json at all { phone 13912345678';
    const { registry, scan } = makeScan();
    const result = maskJsonBody(invalidJson, scan, registry);
    // Should still produce a result (flat scan fallback)
    expect(result.maskedBody).toBeDefined();
    // Invalid JSON in, flat scan out — should contain mask if PII found
    expect(result.maskedBody).toContain("{{PHONE_bcdfg}}");
  });

  it("S9: does not corrupt JSON with valid PII in string value vs number value", () => {
    // 13912345678 is a valid PHONE that will be masked in string context
    const body = JSON.stringify({
      message: "Call me at 13912345678",
      phone_number: 13912345678,
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);
    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.message).toContain("{{PHONE_bcdfg}}");
    // JSON number value should NOT be matched by digit-based regex
    expect(parsed.phone_number).toBe(13912345678);
  });

  it("S10: preserves JSON numbers alongside string masking", () => {
    const body = JSON.stringify({
      config: {
        email: "user@example.com",
        timeout: 30,
        retries: 5,
      },
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);

    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.config.email).toContain("{{EMAIL_bcdfg}}");
    expect(parsed.config.timeout).toBe(30);
    expect(parsed.config.retries).toBe(5);
  });
  it("detects contextual secrets from JSON field keys without leaking synthetic context", () => {
    const rawSecret = "abc12345_67890";
    const body = JSON.stringify({
      model: "gpt-4o-mini",
      api_key: rawSecret,
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);

    expect(result.action).toBe("mask");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "CONTEXTUAL_SECRET", matched: rawSecret }),
      ])
    );

    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.api_key).toBe("{{SECRET_bcdfg}}");
    expect(result.maskedBody).not.toContain(rawSecret);
    expect(result.maskedBody).not.toContain("api_key=");
  });

  it("detects contextual secrets from nested JSON paths", () => {
    const rawSecret = "nested98765_43210";
    const body = JSON.stringify({
      config: {
        secret: rawSecret,
      },
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);

    expect(result.action).toBe("mask");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "CONTEXTUAL_SECRET", matched: rawSecret }),
      ])
    );

    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.config.secret).toBe("{{SECRET_bcdfg}}");
  });


  it("S10: masks nested apiKey and baseUrl values while preserving valid JSON", () => {
    const body = JSON.stringify({
      providers: {
        openai: {
          apiKey: "demo-key_1234567890",
          baseUrl: "https://api.example.test/v1",
        },
      },
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);
    expect(result.action).toBe("mask");

    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.providers.openai.apiKey).toMatch(SECRET_TAG);
    expect(parsed.providers.openai.baseUrl).toMatch(SECRET_TAG);
  });

  it("S11: masks separator and case variants in JSON", () => {
    const body = JSON.stringify({
      APIKEY: "demo-key_1234567890",
      base_url: "https://api.example.test/v1",
      "api-key": "demo-key_abcdef123456",
      bashUrl: "https://edge.example.test/v1",
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);
    expect(result.action).toBe("mask");

    const parsed = JSON.parse(result.maskedBody);
    expect(parsed.APIKEY).toMatch(SECRET_TAG);
    expect(parsed.base_url).toMatch(SECRET_TAG);
    expect(parsed["api-key"]).toMatch(SECRET_TAG);
    expect(parsed.bashUrl).toMatch(SECRET_TAG);
  });

});

describe("maskJsonBody — expanded compound config masking", () => {
  it("masks Azure client identifiers when sibling clientSecret exists", () => {
    const body = JSON.stringify({
      azure: {
        clientId: "11111111-2222-4333-8444-555555555555",
        tenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        clientSecret: "azure-secret_1234567890",
      },
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);
    const parsed = JSON.parse(result.maskedBody);

    expect(parsed.azure.clientId).toMatch(SECRET_TAG);
    expect(parsed.azure.tenantId).toMatch(SECRET_TAG);
    expect(parsed.azure.clientSecret).toMatch(SECRET_TAG);
    expect(result.maskedBody).not.toContain("azure-secret_1234567890");
  });

  it("masks GCP service-account identity metadata around private key id", () => {
    const body = JSON.stringify({
      type: "service_account",
      project_id: "gateway-prod-123",
      private_key_id: "a1b2c3d4e5f678901234567890abcdef12345678",
      client_email: "svc-gateway-123@example.iam.gserviceaccount.com",
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);
    const parsed = JSON.parse(result.maskedBody);

    expect(parsed.project_id).toMatch(SECRET_TAG);
    expect(parsed.private_key_id).toMatch(SECRET_TAG);
    expect(parsed.client_email).not.toContain("svc-gateway-123");
  });

  it("masks Docker auth and kubeconfig token values", () => {
    const body = JSON.stringify({
      auths: {
        "registry.example.test": {
          auth: Buffer.from("user:pa55w0rd", "utf8").toString("base64"),
          identitytoken: "R8".repeat(20),
        },
      },
      users: [{ name: "cluster", user: { token: "K9".repeat(20) } }],
    });

    const { registry, scan } = makeScan();
    const result = maskJsonBody(body, scan, registry);
    const parsed = JSON.parse(result.maskedBody);

    expect(parsed.auths["registry.example.test"].auth).toMatch(SECRET_TAG);
    expect(parsed.auths["registry.example.test"].identitytoken).toMatch(SECRET_TAG);
    expect(parsed.users[0].user.token).toMatch(SECRET_TAG);
  });
});

describe("maskJsonBody — registry threading", () => {
  it("masks JSON strings with instance tags from the shared registry", () => {
    const registry = new MaskRegistry();
    const scan = (text: string) => runPipeline(text, text.length, [], registry);
    const body = JSON.stringify({
      messages: [
        { role: "user", content: "phone 13912345678" },
        { role: "user", content: "again 13912345678" },
      ],
    });

    const result = maskJsonBody(body, scan, registry);
    expect(result.registry).toBe(registry);

    const parsed = JSON.parse(result.maskedBody);
    const tag = parsed.messages[0].content.replace("phone ", "");
    expect(tag).toMatch(/^\{\{PHONE_[bcdfghjkmnpqrstvwxz]{5}\}\}$/);
    expect(parsed.messages[1].content).toBe(`again ${tag}`);
    expect(registry.tagToValue.get(tag)).toBe("13912345678");
    expect(registry.size).toBe(1);
    expect(result.maskedBody).not.toContain("13912345678");
  });

  it("threads registry through the flat-scan fallback for invalid JSON", () => {
    const { registry, scan } = makeScan();
    const result = maskJsonBody("phone 13912345678", scan, registry);

    expect(result.registry).toBe(registry);
    expect(result.maskedBody).toMatch(PHONE_TAG);
    expect(registry.size).toBe(1);
  });
});
