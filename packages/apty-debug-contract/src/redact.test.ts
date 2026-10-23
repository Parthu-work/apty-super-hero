import { describe, expect, it } from "vitest";
import {
  MAX_REDACT_INPUT_LENGTH,
  redactHeaders,
  redactLogs,
  redactSensitiveText,
  redactUrl,
  unboundedPatternMatches,
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
  it("applies the given mode to every message", () => {
    const logs = [
      { level: "log", message: '{"page_title":"Chart for Jane Doe"}' },
    ];
    expect(redactLogs(logs)[0]?.message).not.toContain("Jane Doe");
    expect(redactLogs(logs, "standard")[0]?.message).toContain("Jane Doe");
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

  // Emails, URL userinfo and JWTs were found with regexes that scanned the
  // rest of runs like these from every word boundary in them: seconds each.
  const longRun = (unit: string, prefix = "") =>
    (prefix + unit.repeat(MAX_REDACT_INPUT_LENGTH)).slice(
      0,
      MAX_REDACT_INPUT_LENGTH,
    );

  it.each([
    ["a-a-a-…", longRun("a-")],
    ["a.a.a.…", longRun("a.")],
    ["a+a+a+…", longRun("a+")],
    ["1-1-1-…", longRun("1-")],
    ["http://a-a-a-…", longRun("a-", "http://")],
    ["a@a@a@…", longRun("a@")],
    ["a:a:a:…", longRun("a:")],
    ["aaa…", longRun("a")],
    ["@@@…", longRun("@")],
    ["eyJ-eyJ-…", longRun("eyJ-")],
  ])("redacts 100,000 characters of %s in under 500 ms in each mode", (_label, text) => {
    for (const mode of ["strict", "standard", "off"] as const) {
      const started = performance.now();
      redactSensitiveText(text, mode);
      expect(performance.now() - started, mode).toBeLessThan(500);
    }
  });

  it("finds URL userinfo in 100,000 characters of a-a-a-… in under 500 ms", () => {
    const started = performance.now();
    expect(unboundedPatternMatches(longRun("a-"))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("emails, URL userinfo and JWTs, against the regexes they replace", () => {
  const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
  const URL_USERINFO = /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s@]+)@/g;

  // No other pass can match text made of these: they spell no credential
  // word, header name, token prefix or PEM line, and hold no `=` or quote.
  const PIECES = [
    "a",
    "bc",
    "x1",
    "y.z",
    "c-a",
    "b+x",
    "_",
    "9",
    "-",
    ".",
    "+",
    ":",
    "/",
    "://",
    "://",
    "@",
    "@",
    " ",
    "\t",
    "\n",
    "\u00a0",
    "\u2028",
  ];
  let state = 7;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const texts = [
    "a@b.c@d.e",
    "x@y.z-",
    "x@y.z.-",
    "x@a-.b",
    "..a@b.c",
    "1abc://u@h",
    "x+y.z-1://u:p@h",
    "a://b://c@d",
    "a://u\u00a0v@h",
    "abc://x@y.z@q",
    ...Array.from({ length: 3000 }, () =>
      Array.from(
        { length: 1 + Math.floor(rand() * 40) },
        () => PIECES[Math.floor(rand() * PIECES.length)],
      ).join(""),
    ),
  ];

  it("redacts each text as replacing with those regexes did, in every mode", () => {
    for (const text of texts) {
      const expected = text
        .replace(URL_USERINFO, "$1<REDACTED>@")
        .replace(EMAIL, "<REDACTED-EMAIL>");
      for (const mode of ["strict", "standard", "off"] as const) {
        expect(redactSensitiveText(text, mode), JSON.stringify(text)).toBe(
          expected,
        );
      }
    }
  });

  it("reports the same URL userinfo matches", () => {
    for (const text of texts) {
      expect(unboundedPatternMatches(text), JSON.stringify(text)).toEqual(
        [...text.matchAll(URL_USERINFO)].map((match) => match[0]),
      );
    }
  });

  it("ends URL userinfo where `[^/\\s@]` does, for every UTF-16 code unit", () => {
    for (let code = 0; code <= 0xffff; code++) {
      const text = `a://u${String.fromCharCode(code)}v@h`;
      expect(unboundedPatternMatches(text), `U+${code.toString(16)}`).toEqual(
        [...text.matchAll(URL_USERINFO)].map((match) => match[0]),
      );
    }
  });

  it("redacts JWT-shaped text as replacing with that regex did, in every mode", () => {
    const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
    // As above, and with no `@`, `:` or `/` either.
    const jwtPieces = [
      "eyJ",
      "eyJ",
      "a",
      "x1",
      "Ab",
      "J",
      "9",
      "-",
      "_",
      ".",
      ".",
      " ",
      "\t",
      "\u00a0",
    ];
    const jwtTexts = [
      "eyJa.b.c",
      "eyJa.b.c-",
      "eyJa.b.-",
      "x-eyJa.b.c",
      "eyJeyJa.b.c",
      "eyJa.b.c.d.eyJe.f.g",
      "eyJa.b.c-eyJd.e.f",
      ...Array.from({ length: 3000 }, () =>
        Array.from(
          { length: 1 + Math.floor(rand() * 40) },
          () => jwtPieces[Math.floor(rand() * jwtPieces.length)],
        ).join(""),
      ),
    ];
    for (const text of jwtTexts) {
      const expected = text.replace(JWT, "<REDACTED>");
      for (const mode of ["strict", "standard", "off"] as const) {
        expect(redactSensitiveText(text, mode), JSON.stringify(text)).toBe(
          expected,
        );
      }
    }
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

describe("redactSensitiveText — truncated JSON", () => {
  it.each([
    ['{"password":"hunter2', "hunter2"],
    ['{"data":{"access_token":"abc', "abc"],
    ['{"client_secret": "s3cr', "s3cr"],
  ])("never returns the secret in a truncated body: %s", (input, secret) => {
    for (const mode of ["strict", "standard"] as const) {
      expect(redactSensitiveText(input, mode)).not.toContain(secret);
    }
  });

  it("masks an object under a hyphenated sensitive key whole", () => {
    for (const mode of ["strict", "standard"] as const) {
      expect(
        redactSensitiveText('{"X-Api-Key": {"v":"S6"}, "next": 1', mode),
      ).toBe('{"X-Api-Key": "<REDACTED>", "next": 1');
    }
  });

  // Masking the value whole would cut these matches short of the secret.
  it.each([
    [
      '{"X-Api-Key": ["-----BEGIN KEY-----"], "x": "SECRETPEM-----END KEY-----"}, "t": 1',
      "SECRETPEM",
    ],
    ['{"X-Api-Key": ["see http://x"],"user:SECRETPW@host"]', "SECRETPW"],
    ['{"X-Api-Key": [token=abc]SECRETRUN, "n": 1', "SECRETRUN"],
    ['{"X-Api-Key": [sig=abc]SECRETSIG, "n": 1', "SECRETSIG"],
    ['{"X-Api-Key": [\nCookie: abc] SECRETLINE\n, "n": 1', "SECRETLINE"],
  ])("still masks what a later pass matches across a hyphenated key's value: %j", (input, secret) => {
    for (const mode of ["strict", "standard"] as const) {
      expect(redactSensitiveText(input, mode)).not.toContain(secret);
    }
  });
});

describe("medical record numbers in free text", () => {
  it.each([
    ["MRN 4815162342", "MRN <REDACTED>"],
    ["patient MRN: 4815162342 admitted", "patient MRN: <REDACTED> admitted"],
    ["mrn#A-123456", "mrn#<REDACTED>"],
    ["mrn=99887766&x=1", "mrn=<REDACTED>&x=1"],
    ["Medical Record Number 12345", "Medical Record Number <REDACTED>"],
    ["medical record no. 5550123", "medical record no. <REDACTED>"],
    ["MRN4815162342", "MRN<REDACTED>"],
  ])("masks the number in %s, in strict and standard", (text, expected) => {
    expect(redactSensitiveText(text, "strict")).toBe(expected);
    expect(redactSensitiveText(text, "standard")).toBe(expected);
  });

  it("leaves it in off mode, as it does every PII profile", () => {
    expect(redactSensitiveText("MRN 4815162342", "off")).toBe("MRN 4815162342");
  });

  it("keeps JSON valid and leaves words that only contain the letters alone", () => {
    const json = '{"note":"MRN 4815162342 seen","mrnFormat":"digits"}';
    const out = redactSensitiveText(json, "strict");
    expect(JSON.parse(out)).toEqual({
      note: "MRN <REDACTED> seen",
      mrnFormat: "digits",
    });
    expect(
      redactSensitiveText("SMRN 1234, MRN ab, MRN format, mrnFormat", "strict"),
    ).toBe("SMRN 1234, MRN ab, MRN format, mrnFormat");
  });
});

describe("a JSON object or array stays JSON", () => {
  const parsed = (
    text: string,
    mode: "strict" | "standard" | "off" = "strict",
  ) => JSON.parse(redactSensitiveText(text, mode));

  it.each([
    "strict",
    "standard",
    "off",
  ] as const)("%s: a number, boolean or null under a sensitive key name is replaced with a string", (mode) => {
    expect(
      parsed(
        '{"auth":true,"session_count":12345,"my_token":null,"id":7}',
        mode,
      ),
    ).toEqual({
      auth: "<REDACTED>",
      session_count: "<REDACTED>",
      my_token: "<REDACTED>",
      id: 7,
    });
  });

  it("an object or array under a sensitive key name is replaced whole, not just its first character", () => {
    expect(
      parsed(
        '{"auth_list":[987654,"x"],"session":{"user":"u","pw":"p"},"ok":[1]}',
      ),
    ).toEqual({ auth_list: "<REDACTED>", session: "<REDACTED>", ok: [1] });
  });

  it("a string ending in a key and '=' no longer masks the values after it", () => {
    expect(parsed('["auth=",900087001,{"a":"token=\'","b":31337}]')).toEqual([
      "auth=",
      900087001,
      { a: "token='<REDACTED>'", b: 31337 },
    ]);
  });

  it("still redacts inside every string and key, and keeps everything else", () => {
    expect(
      parsed(
        '{"jane@example.com":"x","note":"call Bearer abc.def with token=T1","url":"https://u:pw@h/p?sig=S1","list":["a.b@c.org",4,false]}',
      ),
    ).toEqual({
      "<REDACTED-EMAIL>": "x",
      note: "call Bearer <REDACTED> with token=<REDACTED>",
      url: "https://<REDACTED>@h/p?sig=<REDACTED>",
      list: ["<REDACTED-EMAIL>", 4, false],
    });
  });

  it("falls back to redacting the whole text when a match runs from one value into the next", () => {
    const out = redactSensitiveText('["see http://x","user:pw@host"]');
    expect(out).not.toContain("user:pw");
  });

  it("leaves text that is not a JSON object or array to the text passes", () => {
    expect(redactSensitiveText("auth: true, session=12345")).toBe(
      "auth: <REDACTED>, session=<REDACTED>",
    );
    expect(redactSensitiveText('{"auth": 1, broken')).toBe(
      '{"auth": <REDACTED>, broken',
    );
  });
});

describe("PEM blocks", () => {
  // What the scanner replaced; it must match exactly what this matched.
  const REFERENCE = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g;
  const reference = (text: string) =>
    [...text.matchAll(REFERENCE)].map((m) => m[0]);
  const pemOnly = (text: string) =>
    unboundedPatternMatches(text).filter((m) => m.startsWith("-----BEGIN "));

  it.each([
    "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
    "a -----BEGIN X-----1-----END X----- b -----BEGIN Y-----2-----END Y-----",
    "-----BEGIN A-----x-----END B----- -----BEGIN B-----y-----END B-----",
    "-----BEGIN A----------BEGIN A-----x-----END A-----",
    "------BEGIN  -----x------END  ------",
    "-----BEGIN A B-----x-----END A B----------END A B-----",
    "-----BEGIN -----x-----END -----",
    "-----BEGIN a-----x-----END a-----",
    "-----BEGIN A-----x-----END AB----- -----END A-----",
  ])("finds what the regex found in %j", (text) => {
    expect(pemOnly(text)).toEqual(reference(text));
  });

  it("finds what the regex found on 2,000 seeded random texts", () => {
    let state = 7;
    const rand = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const parts = [
      "-----BEGIN ",
      "-----END ",
      "-----",
      "A",
      "B",
      " ",
      "x",
      "\n",
      "-",
    ];
    for (let n = 0; n < 2000; n++) {
      const text = Array.from(
        { length: 5 + Math.floor(rand() * 40) },
        () => parts[Math.floor(rand() * parts.length)],
      ).join("");
      expect(pemOnly(text), JSON.stringify(text)).toEqual(reference(text));
    }
  });

  it("stays linear on many BEGIN lines without an END", () => {
    const text = "-----BEGIN X-----".repeat(60_000);
    const started = Date.now();
    expect(unboundedPatternMatches(text)).toEqual([]);
    expect(redactSensitiveText(text.slice(0, 99_000))).toBe(
      text.slice(0, 99_000),
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("unboundedPatternMatches", () => {
  it("finds PEM blocks and URL userinfo as redactSensitiveText would, including across JSON strings", () => {
    expect(unboundedPatternMatches('["see http://x","user:pw@host"]')).toEqual([
      'http://x","user:pw@',
    ]);
    expect(
      unboundedPatternMatches(
        '["-----BEGIN KEY-----a","b","-----END KEY-----"]',
      ),
    ).toEqual(['-----BEGIN KEY-----a","b","-----END KEY-----']);
    expect(unboundedPatternMatches('{"u":"https://u:p@h/"}')).toEqual([
      "https://u:p@",
    ]);
    expect(unboundedPatternMatches('{"a":"nothing here"}')).toEqual([]);
  });
});
