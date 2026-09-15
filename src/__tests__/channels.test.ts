import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config")>();
  return { ...actual, DB_PATH: join(tmpdir(), `channels-test-${process.pid}`, "audit.sqlite") };
});

import { getDb } from "@/audit/store";
import { createUpstream, deleteUpstream, getUpstreamsVersion, listUpstreams, updateUpstream } from "@/upstreams/store";
import { resolveChannel, RESERVED_CHANNEL_SEGMENTS, EXTRA_HEADER_BLACKLIST } from "@/proxy/channels";

const tmpDir = join(tmpdir(), `channels-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  getDb().exec("DELETE FROM upstreams");
});

describe("upstreams store", () => {
  it("CRUD bumps version; enabled filter works", () => {
    const v0 = getUpstreamsVersion();
    const created = createUpstream({ name: "openai", target: "https://api.example.test" });
    expect(created.id).toBeGreaterThan(0);
    expect(getUpstreamsVersion()).not.toBe(v0);

    const disabled = createUpstream({ name: "anthropic", target: "https://api.anthropic.test", enabled: false });
    expect(listUpstreams().length).toBe(2);
    updateUpstream(disabled.id, { enabled: true });
    expect(listUpstreams().every((r) => r.enabled === 1)).toBe(true);
    expect(deleteUpstream(created.id)).toBe(true);
    expect(listUpstreams().length).toBe(1);
  });
});

describe("resolveChannel", () => {
  it("matches enabled channel and strips prefix, preserving query", () => {
    createUpstream({ name: "relay", target: "https://relay.example.test", extraHeaders: { "x-org": "acme" } });
    const channel = resolveChannel("/relay/v1/chat/completions?x=1");
    expect(channel).toEqual({
      name: "relay",
      target: "https://relay.example.test",
      forwardPath: "/v1/chat/completions?x=1",
      extraHeaders: { "x-org": "acme" },
    });
  });

  it("falls back (null) for unknown / disabled / reserved / malformed names", () => {
    createUpstream({ name: "off", target: "https://off.example.test", enabled: false });
    expect(resolveChannel("/off/v1/messages")).toBeNull();
    expect(resolveChannel("/nope/v1/messages")).toBeNull();
    for (const reserved of RESERVED_CHANNEL_SEGMENTS) {
      expect(resolveChannel(`/${reserved}/x`)).toBeNull();
    }
    expect(resolveChannel("/UPPER/x")).toBeNull();
    expect(resolveChannel("/")).toBeNull();
    expect(resolveChannel("/v1/messages")).toBeNull();
  });

  it("exact channel root path forwards to '/'", () => {
    createUpstream({ name: "root2", target: "https://root2.example.test" });
    expect(resolveChannel("/root2")?.forwardPath).toBe("/");
  });

  it("accepts long random-looking prefixes up to 64 chars, rejects 65", () => {
    const random24 = "k7m2x9q4w8e3r6t1y5u0p2a4";
    createUpstream({ name: random24, target: "https://rand.example.test" });
    expect(resolveChannel(`/${random24}/v1/chat/completions`)?.name).toBe(random24);

    const tooLong = "a".repeat(65);
    createUpstream({ name: "a".repeat(64), target: "https://max.example.test" });
    expect(resolveChannel(`/${"a".repeat(64)}/v1`)?.name).toBe("a".repeat(64));
    expect(resolveChannel(`/${tooLong}/v1`)).toBeNull();
  });

  it("hot reload: disabling a channel takes effect immediately (version cache)", () => {
    const created = createUpstream({ name: "hot", target: "https://hot.example.test" });
    expect(resolveChannel("/hot/v1")).not.toBeNull();
    updateUpstream(created.id, { enabled: false });
    expect(resolveChannel("/hot/v1")).toBeNull();
  });

  it("blacklist covers credential and protocol-critical headers", () => {
    for (const key of ["authorization", "x-api-key", "cookie", "host", "content-type"]) {
      expect(EXTRA_HEADER_BLACKLIST.has(key)).toBe(true);
    }
  });
});
