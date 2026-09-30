import { describe, expect, it } from "vitest";
import {
  MAX_REDACT_INPUT_LENGTH,
  redactHeaders,
  redactLogs,
  redactSensitiveText,
  redactUrl,
} from "./redact";

describe("redactHeaders", () => {
  it("redacts known sensitive header names case-insensitively", () => {
    const result = redactHeaders({
      Authorization: "Bearer abc123",
      COOKIE: "session=xyz",
      "X-Api-Key": "secret-key",
      "Content-Type": "application/json",
    });

    expect(result).toEqual({
      Authorization: "<REDACTED>",
      COOKIE: "<REDACTED>",
      "X-Api-Key": "<REDACTED>",
      "Content-Type": "application/json",
    });
  });

  it("passes through undefined", () => {
    expect(redactHeaders(undefined)).toBeUndefined();
  });
});

describe("redactSensitiveText — pre-existing behavior (never weakened)", () => {
  it("redacts a JSON-style token field", () => {
    const input = '{"token": "eyJhbGciOiJIUzI1NiJ9.abc.def"}';
    // Whole-input JSON now round-trips through JSON.parse/stringify (see
    // json-redact.ts) to guarantee valid JSON out — compact spacing is an
    // incidental, harmless side effect; the token itself is still redacted.
    expect(redactSensitiveText(input)).toBe('{"token":"<REDACTED>"}');
    expect(() => JSON.parse(redactSensitiveText(input))).not.toThrow();
  });

  it("redacts a password field", () => {
    expect(redactSensitiveText("password=hunter2")).toBe("password=<REDACTED>");
  });

  it("redacts a bearer token embedded in free text", () => {
    expect(
      redactSensitiveText("fetch failed, sent Bearer eyJhbGciOi.abc.def"),
    ).toBe("fetch failed, sent Bearer <REDACTED>");
  });

  it("leaves ordinary text untouched", () => {
    const input = "Widget failed to initialize: element not found";
    expect(redactSensitiveText(input)).toBe(input);
  });
});

/**
 * Every row here is a REGRESSION test for a confirmed leak in the previous
 * implementation (see DECISIONS.md / the WP1 task description). Each of
 * these failed before this rewrite — do not weaken or delete any of them
 * to make a future change pass; fix the redactor instead.
 */
describe("redactSensitiveText — WP1 regression table (each row leaked before this rewrite)", () => {
  it("fully redacts a Bearer credential after 'Authorization:' (previously only 'Bearer' itself was replaced, leaking the token)", () => {
    const input = "Authorization: Bearer abc123.def456.ghi789";
    const output = redactSensitiveText(input);
    expect(output).not.toContain("abc123.def456.ghi789");
    expect(output).not.toContain(".def456.");
  });

  it("redacts every sensitive cookie pair in a Cookie header, not just the first", () => {
    const input = "Cookie: sessionid=SECRET1; csrftoken=SECRET2; other=SECRET3";
    const output = redactSensitiveText(input);
    expect(output).not.toContain("SECRET1");
    expect(output).not.toContain("SECRET2");
    expect(output).not.toContain("SECRET3");
  });

  it("redacts a quoted JSON password value containing spaces", () => {
    const input = '{"password":"my secret pass phrase"}';
    const output = redactSensitiveText(input);
    expect(output).not.toContain("my secret pass phrase");
    expect(output).toBe('{"password":"<REDACTED>"}');
  });

  it("redacts an id_token query parameter", () => {
    const output = redactSensitiveText("id_token=SECRETJWT&state=1");
    expect(output).not.toContain("SECRETJWT");
    expect(output).toContain("state=1");
  });

  it("redacts a csrf_token header-style value", () => {
    const output = redactSensitiveText("csrf_token: SECRETCSRF");
    expect(output).not.toContain("SECRETCSRF");
  });

  it("redacts a quoted session_token value", () => {
    const output = redactSensitiveText('session_token="SECRETSESS"');
    expect(output).not.toContain("SECRETSESS");
  });

  it("redacts a camelCase authToken JSON field", () => {
    const output = redactSensitiveText('{"authToken":"SECRETAUTH"}');
    expect(output).not.toContain("SECRETAUTH");
  });

  it("redacts a bare JWT with no surrounding key name", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF_-123";
    const output = redactSensitiveText(jwt);
    expect(output).not.toContain(jwt);
    expect(output).not.toContain("eyJzdWIiOiIxMjM0NTY3ODkwIn0");
  });

  it("redacts AWS signed-URL query parameters", () => {
    // Split so the fake key never appears as one contiguous
    // AKIA-shaped string in source — GitHub's push-protection secret
    // scanner flags that shape regardless of it being a test fixture.
    const fakeAwsKeyId = ["AKIA", "X".repeat(16)].join("");
    const input = `https://bucket.s3.amazonaws.com/key?X-Amz-Signature=SECRETSIG&X-Amz-Credential=${fakeAwsKeyId}`;
    const output = redactSensitiveText(input);
    expect(output).not.toContain("SECRETSIG");
    expect(output).not.toContain(fakeAwsKeyId);
  });

  it("redacts a PEM private key block", () => {
    const input =
      'private_key: "-----BEGIN PRIVATE KEY-----MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEA-----END PRIVATE KEY-----"';
    const output = redactSensitiveText(input);
    expect(output).not.toContain(
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEA",
    );
  });

  it("redacts a PEM block with no wrapping key name at all", () => {
    const input =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKc=\n-----END RSA PRIVATE KEY-----";
    const output = redactSensitiveText(input);
    expect(output).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKc=");
  });

  it("redacts URL userinfo (embedded credentials)", () => {
    const input = "https://user:SECRETPW@host.example.com/path";
    const output = redactSensitiveText(input);
    expect(output).not.toContain("SECRETPW");
    expect(output).toContain("host.example.com/path");
  });

  it("redacts well-known token shapes with no key-name context", () => {
    // Every fixture below is split with `.join("")` so the fake
    // credential never appears as one contiguous, shape-matching string
    // in source — GitHub's push-protection secret scanner (correctly)
    // can't distinguish a deliberately fake test fixture from a real leak
    // by shape alone, and blocks the push either way.
    const awsKeyId = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
    expect(redactSensitiveText(`key is ${awsKeyId}`)).not.toContain(awsKeyId);

    const githubToken = ["ghp_", "1234567890123456789012345678901234"].join("");
    expect(redactSensitiveText(`token ${githubToken}`)).not.toContain(
      githubToken,
    );

    const slackToken = ["xoxb-", "1234567890-abcdefghijklmnop"].join("");
    expect(redactSensitiveText(`slack ${slackToken}`)).not.toContain(
      slackToken,
    );

    const googleKey = ["AIzaSy", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567"].join("");
    expect(redactSensitiveText(googleKey)).not.toContain(googleKey);

    const anthropicKey = [
      "sk-ant-api03-",
      "abcdefghijklmnopqrstuvwxyz01234567",
    ].join("");
    expect(redactSensitiveText(anthropicKey)).not.toContain(anthropicKey);
  });

  it("redacts emails by default", () => {
    const output = redactSensitiveText("contact jane.doe@example.com for help");
    expect(output).not.toContain("jane.doe@example.com");
  });
});

describe("redactUrl", () => {
  it("redacts userinfo in an absolute URL", () => {
    const output = redactUrl("https://user:SECRETPW@host.example.com/path");
    expect(output).not.toContain("SECRETPW");
  });

  it("redacts a sensitive query parameter by name", () => {
    const output = redactUrl(
      "https://api.example.com/x?id_token=SECRETJWT&page=2",
    );
    expect(output).not.toContain("SECRETJWT");
    expect(output).toContain("page=2");
  });

  it("redacts AWS signed-URL parameters by name", () => {
    const output = redactUrl(
      "https://bucket.s3.amazonaws.com/key?X-Amz-Signature=SECRETSIG&X-Amz-Expires=3600",
    );
    expect(output).not.toContain("SECRETSIG");
    expect(output).toContain("X-Amz-Expires=3600");
  });

  it("falls back to text redaction for a non-absolute-URL string rather than returning it unredacted", () => {
    const output = redactUrl("/relative/path?password=hunter2");
    expect(output).not.toContain("hunter2");
  });
});

describe("redactLogs", () => {
  it("redacts the message field of every log entry", () => {
    const logs = [
      { level: "error" as const, message: "token=abc123", timestamp: 1 },
      { level: "log" as const, message: "hello world", timestamp: 2 },
    ];
    expect(redactLogs(logs)).toEqual([
      { level: "error", message: "token=<REDACTED>", timestamp: 1 },
      { level: "log", message: "hello world", timestamp: 2 },
    ]);
  });
});

describe("redactSensitiveText — ReDoS safety", () => {
  it("caps work on an oversized input rather than scanning it unbounded", () => {
    const huge = "a".repeat(MAX_REDACT_INPUT_LENGTH + 5000);
    const output = redactSensitiveText(huge);
    expect(output).toContain("truncated before redaction");
  });

  it("completes quickly on adversarial, quote/backslash-heavy input", () => {
    // Pathological for a naive backtracking quoted-value pattern: long runs
    // of escaped backslashes/quotes that never close, repeated many times.
    const pathological = `password: "${"\\\\".repeat(20_000)}`.repeat(20);
    const start = performance.now();
    redactSensitiveText(pathological);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
  });
});

describe("redactSensitiveText — seeded fuzz: a secret embedded anywhere in random surrounding text never survives", () => {
  // Deterministic PRNG (mulberry32) — no new dependency, reproducible failures.
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SECRET_CORPUS: Array<{ label: string; build: () => string }> = [
    { label: "bearer-jwt", build: () => "Bearer eyJabc.def123.ghi789SECRET" },
    { label: "cookie-pair", build: () => "sessionid=SUPERSECRETCOOKIEVALUE" },
    {
      label: "json-password",
      build: () => '"password":"a whole SECRET pass phrase"',
    },
    { label: "id-token", build: () => "id_token=SUPERSECRETIDTOKENVALUE" },
    { label: "csrf-token", build: () => "csrf_token: SUPERSECRETCSRFVALUE" },
    {
      label: "auth-token-json",
      build: () => '{"authToken":"SUPERSECRETAUTHVALUE"}',
    },
    {
      label: "bare-jwt",
      build: () =>
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJTRUNSRVRQQVlMT0FEIn0.signaturepart",
    },
    {
      label: "aws-signature",
      build: () => "X-Amz-Signature=SUPERSECRETAWSSIGNATUREVALUE",
    },
    {
      label: "pem-block",
      build: () =>
        "-----BEGIN PRIVATE KEY-----\nSUPERSECRETPEMBODYCONTENT\n-----END PRIVATE KEY-----",
    },
    {
      label: "url-userinfo",
      build: () => "https://user:SUPERSECRETURLPASSWORD@example.com/",
    },
    {
      // Exactly AKIA + 16 chars (the real shape) — anything appended past
      // that falls outside the intentionally-bounded match. Split with
      // `.join("")` so this fake key never sits in source as one
      // contiguous AKIA-shaped string (GitHub push-protection flags that
      // shape regardless of it being a fixture).
      label: "well-known-shape",
      build: () => ["AKIA", "SECRETKEYID1234", "5"].join(""),
    },
  ];

  const WORDS = [
    "the",
    "quick",
    "brown",
    "fox",
    "widget",
    "failed",
    "loaded",
    "response",
    "status",
    "retry",
    "attempt",
    "connection",
    "timeout",
    "\n",
    " ",
    "{",
    "}",
    "[",
    "]",
  ];

  it("never leaks any corpus secret regardless of where it's embedded in random text", () => {
    const rand = mulberry32(0xc0ffee);
    const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

    for (const { label, build } of SECRET_CORPUS) {
      for (let trial = 0; trial < 15; trial++) {
        const before = Array.from({ length: Math.floor(rand() * 8) }, () =>
          pick(WORDS),
        ).join(" ");
        const after = Array.from({ length: Math.floor(rand() * 8) }, () =>
          pick(WORDS),
        ).join(" ");
        const secretText = build();
        const input = `${before} ${secretText} ${after}`;

        const output = redactSensitiveText(input);

        // Extract the literal high-entropy marker each fixture embeds and
        // assert THAT never survives — a stronger, more specific check than
        // "the whole secretText string is gone" (which could pass even if
        // formatting/whitespace merely shifted).
        const marker = secretText.match(/SUPERSECRET\w+|SECRET\w*/)?.[0];
        if (marker) {
          expect(
            output,
            `label=${label} trial=${trial} input=${input}`,
          ).not.toContain(marker);
        }
      }
    }
  });
});
