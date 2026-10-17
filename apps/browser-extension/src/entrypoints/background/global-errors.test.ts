import { afterEach, describe, expect, it, vi } from "vitest";
import { registerGlobalErrorHandlers } from "./global-errors";

afterEach(() => {
  vi.restoreAllMocks();
});

function rejectionEvent(reason: unknown): Event {
  const event = new Event("unhandledrejection", { cancelable: true });
  Object.assign(event, { reason, promise: Promise.resolve() });
  return event;
}

describe("registerGlobalErrorHandlers", () => {
  it("logs an unhandled rejection by type only, never its message", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = new EventTarget();
    registerGlobalErrorHandlers(target);

    const event = rejectionEvent(new TypeError("PATIENT Jane Testpatient"));
    target.dispatchEvent(event);

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain("unhandled_rejection");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("Testpatient");
    expect(event.defaultPrevented).toBe(true);
  });

  it("logs an uncaught error by type only", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = new EventTarget();
    registerGlobalErrorHandlers(target);

    const event = new Event("error");
    Object.assign(event, {
      error: new RangeError("token=abc123"),
      message: "token=abc123",
    });
    target.dispatchEvent(event);

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain("uncaught_error");
    expect(logged).toContain("RangeError");
    expect(logged).not.toContain("abc123");
  });

  it("names a non-Error rejection by its type", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = new EventTarget();
    registerGlobalErrorHandlers(target);
    target.dispatchEvent(rejectionEvent("secret string"));
    expect(JSON.stringify(error.mock.calls)).toContain("string");
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
  });
});
