import { describe, it, expect } from "vitest";
import { buildMaskTag } from "@/scanner/mask-tag";

describe("buildMaskTag (explicit format)", () => {
  it("EMAIL -> <<PRIVACY_MASK:EMAIL>>", () => {
    expect(buildMaskTag("EMAIL")).toBe("<<PRIVACY_MASK:EMAIL>>");
  });

  it("PHONE -> <<PRIVACY_MASK:PHONE>>", () => {
    expect(buildMaskTag("PHONE")).toBe("<<PRIVACY_MASK:PHONE>>");
  });

  it("ID_CARD -> <<PRIVACY_MASK:ID_CARD>>", () => {
    expect(buildMaskTag("ID_CARD")).toBe("<<PRIVACY_MASK:ID_CARD>>");
  });

  it("BANK_CARD -> <<PRIVACY_MASK:BANK_CARD>>", () => {
    expect(buildMaskTag("BANK_CARD")).toBe("<<PRIVACY_MASK:BANK_CARD>>");
  });

  it("PRIVATE_KEY -> <<PRIVACY_MASK:PRIVATE_KEY>>", () => {
    expect(buildMaskTag("PRIVATE_KEY")).toBe("<<PRIVACY_MASK:PRIVATE_KEY>>");
  });

  it("BEARER_TOKEN -> <<PRIVACY_MASK:BEARER_TOKEN>>", () => {
    expect(buildMaskTag("BEARER_TOKEN")).toBe("<<PRIVACY_MASK:BEARER_TOKEN>>");
  });

  it("CONTEXTUAL_SECRET -> <<PRIVACY_MASK:CONTEXTUAL_SECRET>>", () => {
    expect(buildMaskTag("CONTEXTUAL_SECRET")).toBe("<<PRIVACY_MASK:CONTEXTUAL_SECRET>>");
  });

  it("JWT -> <<PRIVACY_MASK:JWT>>", () => {
    expect(buildMaskTag("JWT")).toBe("<<PRIVACY_MASK:JWT>>");
  });

  it("AWS_ACCESS_KEY -> <<PRIVACY_MASK:AWS_ACCESS_KEY>>", () => {
    expect(buildMaskTag("AWS_ACCESS_KEY")).toBe("<<PRIVACY_MASK:AWS_ACCESS_KEY>>");
  });

  it("GITHUB_TOKEN -> <<PRIVACY_MASK:GITHUB_TOKEN>>", () => {
    expect(buildMaskTag("GITHUB_TOKEN")).toBe("<<PRIVACY_MASK:GITHUB_TOKEN>>");
  });
});
