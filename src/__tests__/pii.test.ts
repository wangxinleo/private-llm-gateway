import { describe, it, expect } from "vitest";
import { scanPii, applyMasks } from "@/scanner/pii";
import type { Finding } from "@/types";

describe("scanPii — PII detection", () => {
  describe("Chinese mobile phone", () => {
    it("detects valid mobile numbers", () => {
      const f = scanPii("Contact me at 13912345678 or 18800001111");
      expect(f.filter((x) => x.category === "PHONE")).toHaveLength(2);
    });

    it("detects all valid prefixes (13-19)", () => {
      for (const prefix of ["130", "150", "170", "180", "199"]) {
        const f = scanPii(`number: ${prefix}12345678`);
        expect(f.some((x) => x.category === "PHONE")).toBe(true);
      }
    });

    it("maskTag is [PHONE]", () => {
      const f = scanPii("13912345678");
      const phone = f.find((x) => x.category === "PHONE");
      expect(phone?.maskTag).toBe("[PHONE]");
    });
  });

  describe("Email", () => {
    it("detects standard email", () => {
      const f = scanPii("send to user@example.com please");
      expect(f.some((x) => x.category === "EMAIL")).toBe(true);
    });

    it("detects email with subdomain", () => {
      const f = scanPii("admin@mail.company.co.jp");
      expect(f.some((x) => x.category === "EMAIL")).toBe(true);
    });

    it("maskTag is [EMAIL]", () => {
      const f = scanPii("test@gmail.com");
      expect(f.find((x) => x.category === "EMAIL")?.maskTag).toBe("[EMAIL]");
    });
  });

  describe("Chinese ID card", () => {
    it("detects 18-digit ID", () => {
      const f = scanPii("身份证号：110101199001011234");
      expect(f.some((x) => x.category === "ID_CARD")).toBe(true);
    });

    it("detects ID with X suffix", () => {
      const f = scanPii("ID: 11010119900101123X");
      expect(f.some((x) => x.category === "ID_CARD")).toBe(true);
    });

    it("maskTag is [ID_CARD]", () => {
      const f = scanPii("110101199001011234");
      expect(f.find((x) => x.category === "ID_CARD")?.maskTag).toBe("[ID_CARD]");
    });
  });

  describe("Bank card (Luhn validated)", () => {
    it("detects valid bank card (passes Luhn)", () => {
      const f = scanPii("card: 4111111111111111");
      expect(f.some((x) => x.category === "BANK_CARD")).toBe(true);
    });

    it("rejects invalid bank card (fails Luhn)", () => {
      const f = scanPii("card: 1234567890123456");
      expect(f.some((x) => x.category === "BANK_CARD")).toBe(false);
    });
  });

  it("returns empty for text without PII", () => {
    const f = scanPii("Hello world, no PII here.");
    expect(f).toHaveLength(0);
  });

  it("action is always 'mask'", () => {
    const f = scanPii("phone: 13912345678, email: a@b.com");
    expect(f.every((x) => x.action === "mask")).toBe(true);
  });
});

describe("applyMasks", () => {
  it("replaces phone with [PHONE]", () => {
    const text = "call 13912345678 later";
    const findings = scanPii(text);
    const result = applyMasks(text, findings);
    expect(result).toBe("call [PHONE] later");
  });

  it("replaces email with [EMAIL]", () => {
    const text = "send to user@example.com please";
    const findings = scanPii(text);
    const result = applyMasks(text, findings);
    expect(result).toBe("send to [EMAIL] please");
  });

  it("replaces ID card with [ID_CARD]", () => {
    const text = "ID: 330106200002020012";
    const findings = scanPii(text);
    const result = applyMasks(text, findings);
    expect(result).toBe("ID: [ID_CARD]");
  });

  it("replaces multiple PII types in same text", () => {
    const text = "phone 13912345678 email a@b.com ID 330106200002020012";
    const findings = scanPii(text);
    const result = applyMasks(text, findings);
    expect(result).toBe("phone [PHONE] email [EMAIL] ID [ID_CARD]");
  });

  it("ignores non-mask findings", () => {
    const text = "some text";
    const fakeFindings: Finding[] = [
      { category: "PRIVATE_KEY", action: "block", matched: "PRIVATE_KEY" },
    ];
    const result = applyMasks(text, fakeFindings);
    expect(result).toBe(text);
  });
});
