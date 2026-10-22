/**
 * Part D2: redacting a JSON body member by member (redactLargeJsonText) must
 * never expose more than redacting its whole text (redactSensitiveText) does.
 * Every body below is under the redactor's size limit, so both can run; the
 * member-by-member run is forced to split at every level (containerLimit 1)
 * and at a few sizes in between.
 */
import { type RedactionMode, redactSensitiveText } from "@apty/debug-contract";
import { describe, expect, it } from "vitest";
import { redactLargeJsonText } from "./redaction-mode";

interface Case {
  name: string;
  value: unknown;
  /** Strings that must not survive redaction wherever the whole-text redactor removes them. */
  secrets: string[];
}

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";

const CASES: Case[] = [
  {
    name: "emails",
    value: {
      contact: "jane.doe@example.com",
      list: ["a.b@c.org", "x"],
      nested: { owner: "o.p@q.io" },
    },
    secrets: ["jane.doe@example.com", "a.b@c.org", "o.p@q.io"],
  },
  {
    name: "record numbers",
    value: {
      note: "MRN 4815162342",
      mrn: "4815162342",
      patientId: "P-998877",
      other: 4815162342,
    },
    secrets: ["4815162342", "P-998877"],
  },
  {
    name: "tokens in key/value pairs",
    value: {
      token: "TOK1",
      access_token: "TOK2",
      my_token_x: "TOK3",
      apiKey: "TOK4",
      author: "AUTHORNAME",
      session: "SESS1",
      "csrf-token": "CSRF1",
      password: "hunter2",
      passwd: "pw2",
      sessionid: "SID1",
      nested: {
        auth: "AUTHV",
        deep: { Authorization: "Bearer abc.def.ghi", x_secret_y: "SEC9" },
      },
    },
    secrets: [
      "TOK1",
      "TOK2",
      "TOK3",
      "TOK4",
      "AUTHORNAME",
      "SESS1",
      "CSRF1",
      "hunter2",
      "pw2",
      "SID1",
      "AUTHV",
      "abc.def.ghi",
      "SEC9",
    ],
  },
  {
    name: "sensitive keys with non-string values",
    value: {
      token: 12345678,
      otp: 654321,
      auth: true,
      secret: null,
      signature: ["SIGA", "SIGB"],
      credential: { user: "CREDUSER", pw: "CREDPW" },
      authToken: { x: "AUTHTOKX" },
      session_data: [1, "SESSDATA"],
    },
    secrets: [
      "12345678",
      "654321",
      "SIGA",
      "SIGB",
      "CREDUSER",
      "CREDPW",
      "AUTHTOKX",
      "SESSDATA",
    ],
  },
  {
    name: "urls with credentials and signed params",
    value: {
      link: "https://user1:pw1@host.example/path?token=ABC&x=1&sig=SIG1&X-Amz-Signature=AMZ1",
      cb: "https://cdn.example/x.json?timestamp=1&session=SESS2",
      ftp: "ftp://bob:SECRETPW@files.example/",
    },
    secrets: ["pw1", "user1", "ABC", "SIG1", "AMZ1", "SESS2", "SECRETPW"],
  },
  {
    name: "numbers, nulls, booleans, nested arrays",
    value: {
      a: [1, 2, [3, { b: null }], true],
      c: 1500.5,
      d: { e: [], f: {} },
      g: "",
    },
    secrets: [],
  },
  {
    name: "escapes and unicode",
    value: {
      msg: "line1\nline2 password=ABCDEF\nGHIJKL tail",
      quote: 'say "token=ZNINE" now',
      uni: "\u00e9t\u00e9 jane.roe@ex.com \u2603",
      tab: "a\tb token:\tTABSEC",
      back: "path C:\\\\temp\\\\x password=BACKSEC",
    },
    secrets: [
      "ABCDEF",
      "GHIJKL",
      "ZNINE",
      "jane.roe@ex.com",
      "TABSEC",
      "BACKSEC",
    ],
  },
  {
    name: "credential shapes",
    value: {
      inline: `x ${JWT} tail`,
      pem: "-----BEGIN PRIVATE KEY-----\nPEMBODY\n-----END PRIVATE KEY-----",
      aws: "AKIAIOSFODNN7EXAMPLE",
      gh: "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sk: "sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      bearer: "call with Bearer BEARERSEC now",
    },
    secrets: [
      JWT,
      "PEMBODY",
      "AKIAIOSFODNN7EXAMPLE",
      "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "BEARERSEC",
    ],
  },
  {
    name: "keys that are sensitive text",
    value: {
      "jane@example.com": "v1",
      "Bearer KEYBEARER": "v2",
      "key with token=KEYTOK": "v3",
      "https://u:KEYPW@h/": "v4",
    },
    secrets: ["jane@example.com", "KEYBEARER", "KEYTOK", "KEYPW"],
  },
  {
    name: "header-like text",
    value: {
      headers: "Authorization: Bearer XYZSEC\nCookie: a=COOKA; b=COOKB",
      "set-cookie": "sid=SETCOOK",
    },
    secrets: ["XYZSEC", "COOKA", "COOKB", "SETCOOK"],
  },
  {
    name: "page context and ids",
    value: {
      page_title: "Patient John Smith",
      page_path: "/patients/48151623/view",
      referrer: "https://x.example/y/4815162342",
      user_id: "uid-1",
      userId: "uid-2",
      email: "e@x.org",
      patient_name: "PNAME",
    },
    secrets: [
      "John Smith",
      "48151623",
      "4815162342",
      "uid-1",
      "uid-2",
      "e@x.org",
      "PNAME",
    ],
  },
  {
    name: "cross-leaf: url scheme at the end of one string, userinfo in the next",
    value: ["see http://x", "user:pw@host"],
    secrets: ["user:pw"],
  },
  {
    name: "cross-leaf: PEM begin and end in different strings",
    value: [
      "-----BEGIN PRIVATE KEY-----AAA",
      "MIDDLESECRET",
      "-----END PRIVATE KEY-----",
    ],
    secrets: ["MIDDLESECRET", "AAA"],
  },
  {
    name: "sensitive key over an array of strings and over an object",
    value: {
      tokens: ["TA", "TB"],
      auth: { a: "AA", b: "BB" },
      passwords: { list: ["P1", "P2"] },
    },
    secrets: ["TA", "TB", "AA", "BB", "P1", "P2"],
  },
  {
    name: "quoted values with punctuation",
    value: {
      a: "password: hunter 2 with spaces",
      b: "token = 'QUOTEDTOK' tail",
      c: 'secret="DQSEC"',
      d: "k=v;password=SEMI;next=1",
    },
    secrets: ["hunter 2", "QUOTEDTOK", "DQSEC", "SEMI"],
  },
  {
    name: "array of records",
    value: Array.from({ length: 30 }, (_, i) => ({
      id: i,
      name: `segment-${i}`,
      owner: `owner${i}@corp.example`,
      token: `TKN${i}`,
      rules: [{ field: "email", value: `v${i}@x.org` }],
    })),
    secrets: Array.from({ length: 30 }, (_, i) => [
      `owner${i}@corp.example`,
      `TKN${i}`,
      `v${i}@x.org`,
    ]).flat(),
  },
  {
    name: "name/value pairs",
    value: [
      { name: "password", value: "PAIRPW" },
      { key: "api_key", val: "PAIRKEY" },
    ],
    secrets: ["PAIRPW", "PAIRKEY"],
  },
  {
    name: "sensitive key over an array starting with scalars",
    value: {
      auth_list: [987654, "x"],
      token_flags: [true, 1],
      session_ids: [[55555, 1]],
      "my-secret": [null, 42424242],
    },
    secrets: ["987654", "55555", "42424242"],
  },
  {
    name: "cross-member: a string ending in a sensitive key and '=' before a number",
    value: ["auth=", 900087001, { a: "token='", b: 31337, c: "x" }],
    secrets: ["900087001", "31337"],
  },
  {
    name: "deep nesting",
    value: {
      a: {
        b: { c: { d: { e: { f: { token: "DEEPTOK", mail: "deep@x.org" } } } } },
      },
    },
    secrets: ["DEEPTOK", "deep@x.org"],
  },
];

const MODES: RedactionMode[] = ["strict", "standard", "off"];
const LIMITS = [1, 40, 200, 100_000];

type Verdict = "equal" | "stricter" | "weaker" | "different-same-exposure";

function leaks(text: string, secrets: string[]): string[] {
  return secrets.filter(
    (s) => text.includes(s) || text.includes(JSON.stringify(s).slice(1, -1)),
  );
}

function compare(
  whole: string,
  candidate: string,
  secrets: string[],
): { verdict: Verdict; detail: string } {
  const wholeLeaks = leaks(whole, secrets);
  const candidateLeaks = leaks(candidate, secrets);
  const extra = candidateLeaks.filter((s) => !wholeLeaks.includes(s));
  const fewer = wholeLeaks.filter((s) => !candidateLeaks.includes(s));
  let sameParsed = false;
  try {
    sameParsed =
      JSON.stringify(JSON.parse(whole)) ===
      JSON.stringify(JSON.parse(candidate));
  } catch {
    sameParsed = false;
  }
  if (extra.length > 0)
    return {
      verdict: "weaker",
      detail: `candidate also shows ${JSON.stringify(extra)}`,
    };
  if (fewer.length > 0)
    return {
      verdict: "stricter",
      detail: `candidate hides ${JSON.stringify(fewer)}`,
    };
  if (sameParsed) return { verdict: "equal", detail: "" };
  return { verdict: "different-same-exposure", detail: "" };
}

/** A small seeded generator, so the random corpus is the same on every run. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const KEYS = [
  "id",
  "name",
  "note",
  "token",
  "access_token",
  "my_token_x",
  "author",
  "auth",
  "session",
  "sessionid",
  "password",
  "pwd",
  "secret",
  "api-key",
  "email",
  "user_id",
  "mrn",
  "patientName",
  "page_title",
  "page_path",
  "referrer",
  "rules",
  "items",
  "url",
  "headers",
  "credential",
  "x@y.org",
  "Bearer KEYS",
  "otp",
  "signature",
  "value",
  "data",
  "csrf_token",
  "set-cookie",
];

/** Text fragments that redaction acts on; `S` is replaced by a unique sentinel. */
const TEMPLATES = [
  "S",
  "S@corp.example",
  "token=S",
  "password: S",
  "Bearer S",
  "https://user:S@h.example/p",
  "https://h.example/x?sig=S&a=1",
  "a=1;session=S;b=2",
  "line\nAuthorization: S",
  'x "token=S" y',
  "eyJhbGciOiJIUzI1NiJ9.eyJTIjoiUyJ9.S",
  "AKIAS",
  "ghp_Saaaaaaaaaaaaaaaaaaaaa",
  "sk-Saaaaaaaaaaaaaaaaaaaa",
  "MRN S",
  "-----BEGIN KEY-----S-----END KEY-----",
  "see http://",
  "S:pw@",
  "\u00e9t\u00e9 S",
  "tab\tsecret=S",
  "/patients/S/view",
  "token",
  "auth=",
  "path C:\\S",
  "",
];

function randomCase(seed: number): Case {
  const rand = prng(seed);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)] as T;
  const secrets: string[] = [];
  let n = 0;
  const sentinel = () => {
    const value = `Z${seed}q${n++}Q`;
    secrets.push(value);
    return value;
  };
  const leaf = (): unknown => {
    const roll = rand();
    if (roll < 0.55) {
      return pick(TEMPLATES).replace("S", sentinel());
    }
    if (roll < 0.7) {
      const digits = 900000000 + seed * 1000 + n++;
      secrets.push(String(digits));
      return digits;
    }
    if (roll < 0.8) return rand() < 0.5;
    if (roll < 0.9) return null;
    return pick(KEYS);
  };
  const node = (depth: number): unknown => {
    const roll = rand();
    if (depth > 3 || roll < 0.4) return leaf();
    if (roll < 0.7) {
      return Array.from({ length: Math.floor(rand() * 4) }, () =>
        node(depth + 1),
      );
    }
    return Object.fromEntries(
      Array.from({ length: 1 + Math.floor(rand() * 4) }, () => [
        rand() < 0.15 ? `${pick(KEYS)} ${sentinel()}` : pick(KEYS),
        node(depth + 1),
      ]),
    );
  };
  const root =
    rand() < 0.5
      ? [node(1), node(1), node(1)]
      : { a: node(1), b: node(1), [pick(KEYS)]: node(1) };
  return { name: `random #${seed}`, value: root, secrets };
}

const RANDOM_CASES = Array.from(
  { length: Number(process.env.RANDOM_BODIES ?? 400) },
  (_, i) => randomCase(i + 1),
);

describe("member-by-member redaction against whole-text redaction", () => {
  it("never shows a secret the whole-text redactor hides, on random bodies (RANDOM_BODIES, default 400)", () => {
    const weaker: string[] = [];
    for (const mode of MODES) {
      for (const c of RANDOM_CASES) {
        const body = JSON.stringify(c.value);
        const whole = redactSensitiveText(body, mode);
        for (const limit of [1, 60, 100_000]) {
          const out = redactLargeJsonText(body, mode, limit);
          if (!out.ok) continue;
          const { verdict, detail } = compare(whole, out.text, c.secrets);
          if (verdict === "weaker") {
            weaker.push(
              `${mode} | ${c.name} | limit ${limit}: ${detail} | ${body}`,
            );
          }
        }
      }
    }
    expect(weaker).toEqual([]);
  });

  it("never shows a secret the whole-text redactor hides, on the corpus, and refuses only cross-member bodies", () => {
    const weaker: string[] = [];
    const refused = new Set<string>();
    for (const mode of MODES) {
      for (const c of CASES) {
        for (const pretty of [false, true]) {
          const body = pretty
            ? JSON.stringify(c.value, null, 2)
            : JSON.stringify(c.value);
          const whole = redactSensitiveText(body, mode);
          for (const limit of LIMITS) {
            const out = redactLargeJsonText(body, mode, limit);
            if (!out.ok) {
              refused.add(`${c.name}: ${out.reason}`);
              continue;
            }
            const { verdict, detail } = compare(whole, out.text, c.secrets);
            if (verdict === "weaker") {
              weaker.push(`${mode} | ${c.name} | limit ${limit}: ${detail}`);
            }
          }
        }
      }
    }
    expect(weaker).toEqual([]);
    expect([...refused].sort()).toEqual([
      "cross-leaf: PEM begin and end in different strings: crosses-members",
      "cross-leaf: url scheme at the end of one string, userinfo in the next: crosses-members",
      "cross-member: a string ending in a sensitive key and '=' before a number: crosses-members",
    ]);
  });
});

describe("redactLargeJsonText refuses what it can't redact value by value", () => {
  it.each([
    ["text that is not JSON", "password=hunter2 and more", "not-json"],
    ["JSON-looking text that does not parse", '{"a": 1,', "not-json"],
    [
      "a string over the redactor's limit",
      JSON.stringify({ a: "x".repeat(100_001) }),
      "string-too-large",
    ],
    [
      "a key over the redactor's limit",
      JSON.stringify({ ["k".repeat(100_001)]: [1, 2] }),
      "string-too-large",
    ],
    [
      "a body over the overall cap",
      JSON.stringify(["x".repeat(1_000_000), "y".repeat(1_000_000)]),
      "too-large",
    ],
  ])("%s", (_label, body, reason) => {
    expect(redactLargeJsonText(body, "strict")).toEqual({ ok: false, reason });
  });

  it("redacts a body of many values over the limit, in Strict and Standard, with nothing cut off", () => {
    const records = Array.from({ length: 2000 }, (_, i) => ({
      id: i,
      owner: `owner${i}@corp.example`,
      token: `tok${i}`,
    }));
    const body = JSON.stringify(records);
    expect(body.length).toBeGreaterThan(100_000);
    for (const mode of ["strict", "standard"] as const) {
      const out = redactLargeJsonText(body, mode);
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      const parsed = JSON.parse(out.text) as Array<Record<string, unknown>>;
      expect(parsed).toHaveLength(2000);
      // Each record reads as whole-text redaction of that record alone.
      expect(parsed[1999]).toEqual(
        JSON.parse(redactSensitiveText(JSON.stringify(records[1999]), mode)),
      );
      expect(out.text).not.toMatch(/@corp\.example|tok\d/);
    }
  });
});
