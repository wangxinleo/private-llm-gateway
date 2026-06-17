import { describe, it, expect } from "vitest";
import { resolveAction, blockedResponse } from "@/engine/policy";
import type { Finding } from "@/types";

describe("resolveAction", () => {
  it("returns 'block' only for SENSITIVE_FILENAME", () => {
    const findings: Finding[] = [
      {
        category: "SENSITIVE_FILENAME",
        action: "block",
        matched: "id_rsa",
      },
      { category: "PHONE", action: "mask", matched: "13912345678", maskTag: "<<PRIVACY_MASK:PHONE>>" },
    ];
    expect(resolveAction(findings)).toBe("block");
  });

  it("returns 'mask' for secret findings (not block)", () => {
    const findings: Finding[] = [
      {
        category: "PRIVATE_KEY",
        action: "mask",
        matched: "-----BEGIN PRIVATE KEY-----...",
        maskTag: "<<PRIVACY_MASK:PRIVATE_KEY>>",
      },
      { category: "PHONE", action: "mask", matched: "13912345678", maskTag: "<<PRIVACY_MASK:PHONE>>" },
    ];
    expect(resolveAction(findings)).toBe("mask");
  });

  it("returns 'mask' for Bearer token findings", () => {
    const findings: Finding[] = [
      {
        category: "BEARER_TOKEN",
        action: "mask",
        matched: "Bearer abc123",
        maskTag: "<<PRIVACY_MASK:BEARER_TOKEN>>",
      },
    ];
    expect(resolveAction(findings)).toBe("mask");
  });

  it("returns 'mask' when only mask findings exist", () => {
    const findings: Finding[] = [
      { category: "PHONE", action: "mask", matched: "13912345678", maskTag: "<<PRIVACY_MASK:PHONE>>" },
      { category: "EMAIL", action: "mask", matched: "a@b.com", maskTag: "<<PRIVACY_MASK:EMAIL>>" },
    ];
    expect(resolveAction(findings)).toBe("mask");
  });

  it("returns 'allow' for empty findings", () => {
    expect(resolveAction([])).toBe("allow");
  });
});

describe("blockedResponse", () => {
  it("returns 403 with correct error format for filename block", () => {
    const findings: Finding[] = [
      {
        category: "SENSITIVE_FILENAME",
        action: "block",
        matched: "id_rsa",
      },
    ];
    const resp = blockedResponse(findings);
    expect(resp.status).toBe(403);
    expect(resp.body.error).toBe("blocked_by_privacy_proxy");
    expect(resp.body.blocked_types).toContain("SENSITIVE_FILENAME");
  });

  it("deduplicates blocked_types", () => {
    const findings: Finding[] = [
      {
        category: "SENSITIVE_FILENAME",
        action: "block",
        matched: "id_rsa",
      },
      {
        category: "SENSITIVE_FILENAME",
        action: "block",
        matched: "config.pem",
      },
    ];
    const resp = blockedResponse(findings);
    expect((resp.body.blocked_types as string[]).length).toBe(1);
  });

  it("only includes block-category findings in blocked_types", () => {
    const findings: Finding[] = [
      {
        category: "SENSITIVE_FILENAME",
        action: "block",
        matched: "id_rsa",
      },
      { category: "PHONE", action: "mask", matched: "13912345678", maskTag: "<<PRIVACY_MASK:PHONE>>" },
    ];
    const resp = blockedResponse(findings);
    expect(resp.body.blocked_types).toEqual(["SENSITIVE_FILENAME"]);
  });
});
