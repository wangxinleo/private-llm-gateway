import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "@/log";

describe("Logger", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("debug mode outputs all levels", () => {
    const logger = new Logger("test", true);
    logger.error("err");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("production mode suppresses debug", () => {
    const logger = new Logger("test", false);
    logger.error("err");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(0);
  });

  it("format includes local timestamp", () => {
    const logger = new Logger("svc", true);
    logger.info("msg");
    const out = infoSpy.mock.calls[0][0] as string;
    expect(out).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it("format includes tag", () => {
    const logger = new Logger("mytag", true);
    logger.warn("hi");
    const out = warnSpy.mock.calls[0][0] as string;
    expect(out).toContain("[mytag]");
  });

  it("format includes level label", () => {
    const logger = new Logger("t", true);
    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");
    expect(errorSpy.mock.calls[0][0] as string).toContain("ERROR");
    expect(warnSpy.mock.calls[0][0] as string).toContain("WARN ");
    expect(infoSpy.mock.calls[0][0] as string).toContain("INFO ");
    expect(logSpy.mock.calls[0][0] as string).toContain("DEBUG");
  });

  it("format includes message", () => {
    const logger = new Logger("t", true);
    logger.info("hello world");
    const out = infoSpy.mock.calls[0][0] as string;
    expect(out).toContain("hello world");
  });

  it("multiple args concatenated", () => {
    const logger = new Logger("t", true);
    logger.info("a", "b", 123);
    const out = infoSpy.mock.calls[0][0] as string;
    expect(out).toContain("a b 123");
  });

  it("error level always outputs even in production", () => {
    const logger = new Logger("t", false);
    logger.error("fatal");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("warn level outputs in production", () => {
    const logger = new Logger("t", false);
    logger.warn("caution");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("non-string args are JSON stringified", () => {
    const logger = new Logger("t", true);
    logger.info({ key: "val" });
    const out = infoSpy.mock.calls[0][0] as string;
    expect(out).toContain('{"key":"val"}');
  });
});
