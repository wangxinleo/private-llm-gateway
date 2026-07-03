import { beforeEach, describe, expect, it, vi } from "vitest";
import { logAudit } from "@/audit/logger";
import { insertAudit } from "@/audit/store";
import { broadcastAudit } from "@/audit/sse";

vi.mock("@/audit/store", () => ({
  insertAudit: vi.fn(),
}));

vi.mock("@/audit/sse", () => ({
  broadcastAudit: vi.fn(),
}));

const mockInsertAudit = vi.mocked(insertAudit);
const mockBroadcastAudit = vi.mocked(broadcastAudit);

describe("logAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertAudit.mockReturnValue(42);
  });

  it("persists raw matched values while omitting them from live broadcasts", () => {
    logAudit({
      path: "/v1/chat/completions",
      method: "POST",
      contentType: "application/json",
      bodySize: 64,
      model: "gpt-4o-mini",
      filenames: [],
      findings: [
        {
          category: "BEARER_TOKEN",
          action: "mask",
          matched: "Bearer sample-token-for-test",
          maskTag: "<<PRIVACY_MASK:BEARER_TOKEN>>",
        },
      ],
      action: "allow",
      bypassApplied: true,
      duration: 12.34,
    });

    const inserted = mockInsertAudit.mock.calls[0]?.[0] ?? {};
    expect(inserted).toEqual(
      expect.objectContaining({
        matchedValues: { BEARER_TOKEN: ["Bearer sample-token-for-test"] },
        bypassApplied: true,
        duration: 12.34,
      })
    );

    const event = mockBroadcastAudit.mock.calls[0]?.[0] ?? {};
    expect(event).toEqual(
      expect.objectContaining({
        id: 42,
        findings: ["BEARER_TOKEN"],
        action: "allow",
        bypassApplied: true,
        duration: 12.34,
      })
    );
    expect(event).not.toHaveProperty("matchedValues");
    expect(JSON.stringify(event)).not.toContain("sample-token-for-test");
  });
});
