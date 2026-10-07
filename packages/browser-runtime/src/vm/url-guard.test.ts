import { describe, expect, it } from "vitest";
import {
  assertSkillFetchUrlAllowed,
  isIPv4,
  isPrivateIPv4,
  isPrivateIPv6,
  SsrfBlockedError,
} from "./url-guard";

describe("isIPv4", () => {
  it("accepts well-formed dotted-decimal addresses", () => {
    expect(isIPv4("127.0.0.1")).toBe(true);
    expect(isIPv4("0.0.0.0")).toBe(true);
    expect(isIPv4("255.255.255.255")).toBe(true);
    expect(isIPv4("192.168.1.1")).toBe(true);
  });

  it("rejects non-IPv4 hostnames", () => {
    expect(isIPv4("example.com")).toBe(false);
    expect(isIPv4("localhost")).toBe(false);
    expect(isIPv4("::1")).toBe(false);
    expect(isIPv4("1.2.3")).toBe(false);
    expect(isIPv4("1.2.3.4.5")).toBe(false);
    expect(isIPv4("1.2.3.256")).toBe(false);
    expect(isIPv4("1.2.3.-1")).toBe(false);
  });
});

describe("isPrivateIPv4", () => {
  it("flags loopback (127.0.0.0/8)", () => {
    expect(isPrivateIPv4("127.0.0.1")).toBe(true);
    expect(isPrivateIPv4("127.255.255.255")).toBe(true);
  });

  it("flags RFC1918 private ranges", () => {
    expect(isPrivateIPv4("10.0.0.1")).toBe(true);
    expect(isPrivateIPv4("172.16.0.1")).toBe(true);
    expect(isPrivateIPv4("172.31.255.255")).toBe(true);
    expect(isPrivateIPv4("192.168.0.1")).toBe(true);
  });

  it("does not flag the adjacent public 172.x ranges", () => {
    expect(isPrivateIPv4("172.15.255.255")).toBe(false);
    expect(isPrivateIPv4("172.32.0.0")).toBe(false);
  });

  it("flags link-local and cloud metadata (169.254.0.0/16)", () => {
    expect(isPrivateIPv4("169.254.169.254")).toBe(true);
    expect(isPrivateIPv4("169.254.0.1")).toBe(true);
  });

  it("flags 0.0.0.0/8, benchmarking, documentation, multicast, and reserved ranges", () => {
    expect(isPrivateIPv4("0.0.0.0")).toBe(true);
    expect(isPrivateIPv4("198.18.0.1")).toBe(true);
    expect(isPrivateIPv4("198.19.255.255")).toBe(true);
    expect(isPrivateIPv4("198.51.100.1")).toBe(true);
    expect(isPrivateIPv4("203.0.113.1")).toBe(true);
    expect(isPrivateIPv4("224.0.0.1")).toBe(true);
    expect(isPrivateIPv4("239.255.255.255")).toBe(true);
    expect(isPrivateIPv4("240.0.0.1")).toBe(true);
    expect(isPrivateIPv4("255.255.255.255")).toBe(true);
  });

  it("does not flag ordinary public addresses", () => {
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateIPv4("1.1.1.1")).toBe(false);
    expect(isPrivateIPv4("93.184.216.34")).toBe(false);
  });

  it("returns false for non-IPv4 input", () => {
    expect(isPrivateIPv4("example.com")).toBe(false);
  });
});

describe("isPrivateIPv6", () => {
  it("flags loopback and unspecified", () => {
    expect(isPrivateIPv6("::1")).toBe(true);
    expect(isPrivateIPv6("::")).toBe(true);
    expect(isPrivateIPv6("[::1]")).toBe(true);
  });

  it("flags link-local (fe80::/10) and unique-local (fc00::/7)", () => {
    expect(isPrivateIPv6("fe80::1")).toBe(true);
    expect(isPrivateIPv6("fc00::1")).toBe(true);
    expect(isPrivateIPv6("fd12:3456:789a::1")).toBe(true);
  });

  it("flags multicast (ff00::/8)", () => {
    expect(isPrivateIPv6("ff02::1")).toBe(true);
  });

  it("flags IPv4-mapped private addresses, dotted and hex forms", () => {
    expect(isPrivateIPv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIPv6("::ffff:10.0.0.1")).toBe(true);
    // ::ffff:7f00:1 == ::ffff:127.0.0.1
    expect(isPrivateIPv6("::ffff:7f00:1")).toBe(true);
  });

  it("does not flag an IPv4-mapped public address", () => {
    expect(isPrivateIPv6("::ffff:8.8.8.8")).toBe(false);
  });

  it("returns false for a non-IPv6 hostname", () => {
    expect(isPrivateIPv6("example.com")).toBe(false);
    expect(isPrivateIPv6("127.0.0.1")).toBe(false);
  });
});

describe("assertSkillFetchUrlAllowed", () => {
  it("allows ordinary public https/http URLs", () => {
    expect(assertSkillFetchUrlAllowed("https://example.com/api").href).toBe(
      "https://example.com/api",
    );
    expect(assertSkillFetchUrlAllowed("http://example.com/api").href).toBe(
      "http://example.com/api",
    );
  });

  it("rejects an invalid URL", () => {
    expect(() => assertSkillFetchUrlAllowed("not a url")).toThrow(
      SsrfBlockedError,
    );
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => assertSkillFetchUrlAllowed("file:///etc/passwd")).toThrow(
      SsrfBlockedError,
    );
    expect(() =>
      // eslint-disable-next-line no-script-url
      assertSkillFetchUrlAllowed("javascript:alert(1)"),
    ).toThrow(SsrfBlockedError);
  });

  it("rejects localhost and reserved hostname suffixes", () => {
    expect(() => assertSkillFetchUrlAllowed("http://localhost/")).toThrow(
      SsrfBlockedError,
    );
    expect(() => assertSkillFetchUrlAllowed("http://foo.localhost/")).toThrow(
      SsrfBlockedError,
    );
    expect(() => assertSkillFetchUrlAllowed("http://printer.local/")).toThrow(
      SsrfBlockedError,
    );
    expect(() =>
      assertSkillFetchUrlAllowed("http://metadata.internal/"),
    ).toThrow(SsrfBlockedError);
  });

  it("rejects private IPv4 literals, including loopback (no exception here)", () => {
    expect(() => assertSkillFetchUrlAllowed("http://127.0.0.1/")).toThrow(
      SsrfBlockedError,
    );
    expect(() => assertSkillFetchUrlAllowed("http://10.0.0.5/")).toThrow(
      SsrfBlockedError,
    );
    expect(() => assertSkillFetchUrlAllowed("http://169.254.169.254/")).toThrow(
      SsrfBlockedError,
    );
  });

  it("rejects private IPv6 literals", () => {
    expect(() => assertSkillFetchUrlAllowed("http://[::1]/")).toThrow(
      SsrfBlockedError,
    );
    expect(() => assertSkillFetchUrlAllowed("http://[fe80::1]/")).toThrow(
      SsrfBlockedError,
    );
  });

  it("normalizes IP-literal obfuscation forms and still rejects the private target", () => {
    // 2130706433 === 127.0.0.1; the WHATWG URL parser itself normalizes this
    // before assertSkillFetchUrlAllowed ever reads parsed.hostname.
    expect(() => assertSkillFetchUrlAllowed("http://2130706433/")).toThrow(
      SsrfBlockedError,
    );
  });
});
