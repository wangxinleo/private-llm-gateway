import { describe, it, expect } from "vitest";
import {
  matchBypassRule,
  isBypassRuleActive,
  extractRequestModel,
} from "@/bypass/rules";

describe("bypass rules", () => {
  describe("extractRequestModel", () => {
    it("extracts model from JSON object body", () => {
      expect(extractRequestModel('{"model":"gpt-4o-mini","messages":[]}')).toBe("gpt-4o-mini");
    });

    it("returns null for invalid JSON", () => {
      expect(extractRequestModel("not-json")).toBeNull();
    });

    it("returns null when model is absent", () => {
      expect(extractRequestModel('{"messages":[]}')).toBeNull();
    });
  });

  describe("isBypassRuleActive", () => {
    it("returns true inside one-time window", () => {
      expect(
        isBypassRuleActive(
          {
            enabled: 1,
            startAt: "2026-06-22T02:00:00.000Z",
            endAt: "2026-06-22T10:00:00.000Z",
          },
          new Date("2026-06-22T08:00:00.000Z")
        )
      ).toBe(true);
    });

    it("returns false before window starts", () => {
      expect(
        isBypassRuleActive(
          {
            enabled: 1,
            startAt: "2026-06-22T09:00:00.000Z",
            endAt: "2026-06-22T10:00:00.000Z",
          },
          new Date("2026-06-22T08:00:00.000Z")
        )
      ).toBe(false);
    });

    it("returns false after window ends", () => {
      expect(
        isBypassRuleActive(
          {
            enabled: 1,
            startAt: "2026-06-22T06:00:00.000Z",
            endAt: "2026-06-22T07:00:00.000Z",
          },
          new Date("2026-06-22T08:00:00.000Z")
        )
      ).toBe(false);
    });

    it("returns false when rule disabled", () => {
      expect(
        isBypassRuleActive(
          {
            enabled: 0,
            startAt: "2026-06-22T02:00:00.000Z",
            endAt: "2026-06-22T10:00:00.000Z",
          },
          new Date("2026-06-22T08:00:00.000Z")
        )
      ).toBe(false);
    });
  });

  describe("matchBypassRule", () => {
    const activeRule = {
      id: 1,
      enabled: 1,
      pathPrefix: "/v1/chat",
      modelName: "gpt-4o-mini",
      startAt: "2026-06-22T02:00:00.000Z",
      endAt: "2026-06-22T10:00:00.000Z",
      note: "temporary bypass",
      createdAt: "2026-06-22T01:00:00.000Z",
      updatedAt: "2026-06-22T01:00:00.000Z",
    };

    it("matches when path prefix, model, and time window all match", () => {
      const matched = matchBypassRule(
        [activeRule],
        {
          path: "/v1/chat/completions",
          model: "gpt-4o-mini",
        },
        new Date("2026-06-22T08:00:00.000Z")
      );

      expect(matched?.id).toBe(1);
    });

    it("does not match when path prefix mismatches", () => {
      const matched = matchBypassRule(
        [activeRule],
        {
          path: "/v1/embeddings",
          model: "gpt-4o-mini",
        },
        new Date("2026-06-22T08:00:00.000Z")
      );

      expect(matched).toBeNull();
    });

    it("does not match when model mismatches", () => {
      const matched = matchBypassRule(
        [activeRule],
        {
          path: "/v1/chat/completions",
          model: "gpt-4o",
        },
        new Date("2026-06-22T08:00:00.000Z")
      );

      expect(matched).toBeNull();
    });

    it("does not match when model is missing", () => {
      const matched = matchBypassRule(
        [activeRule],
        {
          path: "/v1/chat/completions",
          model: null,
        },
        new Date("2026-06-22T08:00:00.000Z")
      );

      expect(matched).toBeNull();
    });

    it("matches model variant by prefix (gpt-4o-mini matches rule gpt-4o)", () => {
      const prefixRule = {
        ...activeRule,
        modelName: "gpt-4o",
      };
      const matched = matchBypassRule(
        [prefixRule],
        {
          path: "/v1/chat/completions",
          model: "gpt-4o-mini",
        },
        new Date("2026-06-22T08:00:00.000Z")
      );

      expect(matched?.id).toBe(1);
    });

    it("matches exact model name (prefix includes full match)", () => {
      const matched = matchBypassRule(
        [activeRule],
        {
          path: "/v1/chat/completions",
          model: "gpt-4o-mini",
        },
        new Date("2026-06-22T08:00:00.000Z")
      );

      expect(matched?.id).toBe(1);
    });

    it("does not match unrelated model with different prefix", () => {
      const prefixRule = {
        ...activeRule,
        modelName: "gpt-4o",
      };
      const matched = matchBypassRule(
        [prefixRule],
        {
          path: "/v1/chat/completions",
          model: "claude-3-opus",
        },
        new Date("2026-06-22T08:00:00.000Z")
      );

      expect(matched).toBeNull();
    });
  });
});
