import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, getLogLevel, setLogLevel } from "./logger";

describe("createLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLogLevel("debug");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel("debug");
  });

  it("prefixes every call with the namespace", () => {
    const log = createLogger("QuickJS");
    log.debug("loaded", "foo.js");
    expect(console.debug).toHaveBeenCalledWith("[QuickJS]", "loaded", "foo.js");
  });

  it("routes each level to the matching console method", () => {
    const log = createLogger("Test");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(console.debug).toHaveBeenCalledWith("[Test]", "d");
    expect(console.info).toHaveBeenCalledWith("[Test]", "i");
    expect(console.warn).toHaveBeenCalledWith("[Test]", "w");
    expect(console.error).toHaveBeenCalledWith("[Test]", "e");
  });

  it("defaults to debug — logging everything, same volume as plain console.*", () => {
    expect(getLogLevel()).toBe("debug");
  });

  it("suppresses levels below the configured minimum", () => {
    setLogLevel("warn");
    const log = createLogger("Test");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith("[Test]", "w");
    expect(console.error).toHaveBeenCalledWith("[Test]", "e");
  });

  it("suppresses everything at silent", () => {
    setLogLevel("silent");
    const log = createLogger("Test");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("applies the level change to loggers created before the change too", () => {
    const log = createLogger("Test");
    setLogLevel("error");
    log.warn("should be suppressed");
    log.error("should log");

    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[Test]", "should log");
  });
});
