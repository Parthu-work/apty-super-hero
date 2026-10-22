/**
 * PRIVACY.md's redaction table (Data handling → Redaction) and the lists
 * under it, as the model and MCP clients get a tool result: the outbound
 * sanitizer (chat) and redactToolOutput (what the MCP server runs). If the
 * doc changes, this test changes with it.
 */
import type { AgentInputItem } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import {
  createOutboundSanitizer,
  redactToolOutput,
} from "./outbound-sanitizer.js";

type Mode = "strict" | "standard" | "off";

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const GITHUB_TOKEN = `ghp_${"a1B2c3D4e5".repeat(3)}`;
const MRN = "4815162342";

const HEADER_LINE_NAMES = [
  "Authorization",
  "Proxy-Authorization",
  "Cookie",
  "Set-Cookie",
  "X-Api-Key",
  "X-Auth-Token",
];

const TEXT_KEY_WORDS = [
  "password",
  "passwd",
  "pwd",
  "token",
  "secret",
  "auth",
  "session",
  "api-key",
  "api_key",
  "apikey",
  "csrf",
  "xsrf",
  "jwt",
  "credential",
  "signature",
  "private-key",
  "private_key",
  "otp",
  "bearer",
];

const JSON_KEY_NAMES = [
  "token",
  "id_token",
  "access_token",
  "x_access_token",
  "refresh_token",
  "auth_token",
  "authorization_token",
  "private_token",
  "session_token",
  "x_amz_security_token",
  "csrf_token",
  "x_csrf_token",
  "xsrf_token",
  "x_xsrf_token",
  "api_key",
  "x_api_key",
  "x_auth_token",
  "secret",
  "client_secret",
  "password",
  "passwd",
  "pwd",
  "private_key",
  "signature",
  "credential",
  "cookie",
  "set_cookie",
  "jwt",
  "otp",
  "bearer",
  "authorization",
  "proxy_authorization",
  "session_id",
  "x_session_id",
  "user_session_id",
  // The same names in another case or punctuation.
  "apiKey",
  "authToken",
  "Authorization",
  "Set-Cookie",
  "X-Api-Key",
  "x-auth-token",
  "Proxy-Authorization",
  "access-token",
  "x-access-token",
  "private-token",
  "X-Amz-Security-Token",
  "X-CSRF-Token",
  "x-xsrf-token",
  "X-Auth-Token",
  "clientSecret",
  "set-cookie",
  "X-Session-Id",
];

/** Keys not on the list are sent as is in every mode, even when they contain a credential word. */
const OTHER_KEY_NAMES = [
  "session",
  "session_start_time",
  "time_spent",
  "token_count",
  "tokenizer",
  "name",
  "x-request-id",
  "x-correlation-id",
];

const headerLines = HEADER_LINE_NAMES.map(
  (name, i) => `${name}: line${i}Value`,
);
const textPairs = TEXT_KEY_WORDS.map((word, i) => `${word}=text${i}Value`);

const FIXTURE = {
  jwt: `signed in as ${JWT}`,
  githubToken: `pushed with ${GITHUB_TOKEN}`,
  contact: "jane.doe@example.com",
  headers: { Authorization: "Bearer bearerCred123" },
  headerLines: headerLines.join("\n"),
  log: `login failed ${textPairs.join(" ")} csrf_token: csrfColon123 "authToken":"quotedAuth123"`,
  body: '{"password":"bodyPass123","token":"bodyToken123"}',
  credentials: Object.fromEntries(
    JSON_KEY_NAMES.map((name, i) => [name, `cred${i}Value`]),
  ),
  otherKeys: Object.fromEntries(
    OTHER_KEY_NAMES.map((name, i) => [name, `other${i}Value`]),
  ),
  firstName: "Janeth",
  mrn: MRN,
  note: `Seen today, MRN ${MRN}.`,
  link: `/chart?mrn=${MRN}`,
  userId: "user-12345",
  page_title: "Chart for Janeth Doe",
  url: "https://ehr.example.com/patients/chart?visit=778899",
};

/** A dot path into FIXTURE and the text in that value that masking removes. */
type Row = [path: string, secrets: string[]];

const MASKED_IN_EVERY_MODE: Row[] = [
  ["jwt", [JWT]],
  ["githubToken", [GITHUB_TOKEN]],
  ["contact", ["jane.doe@example.com"]],
  ["headers.Authorization", ["bearerCred123"]],
  ["headerLines", HEADER_LINE_NAMES.map((_, i) => `line${i}Value`)],
  [
    "log",
    [
      ...TEXT_KEY_WORDS.map((_, i) => `text${i}Value`),
      "csrfColon123",
      "quotedAuth123",
    ],
  ],
  ["body", ["bodyPass123", "bodyToken123"]],
];

const MASKED_UNLESS_OFF: Row[] = [
  ...JSON_KEY_NAMES.map(
    (name, i): Row => [`credentials.${name}`, [`cred${i}Value`]],
  ),
  ["firstName", ["Janeth"]],
  ["mrn", [MRN]],
  ["note", [MRN]],
  ["link", [MRN]],
  ["userId", ["user-12345"]],
];

const MASKED_IN_STRICT_ONLY: Row = ["page_title", ["Janeth"]];

function valueAt(object: unknown, path: string): string {
  let value = object;
  for (const key of path.split(".")) {
    value = (value as Record<string, unknown>)[key];
  }
  return String(value);
}

/** The fixture as the chat model and as an MCP client get it in `mode`. */
async function asSent(
  mode: Mode,
  output: unknown = JSON.stringify(FIXTURE),
): Promise<Record<"chat" | "mcp", unknown>> {
  const [item] = await createOutboundSanitizer({ getMode: () => mode })([
    {
      type: "function_call_result",
      name: "get_page_metadata",
      callId: `call-${mode}`,
      output,
    } as AgentInputItem,
  ]);
  const parse = (v: unknown) =>
    JSON.parse(typeof v === "string" ? v : JSON.stringify(v));
  return {
    chat: parse((item as { output: unknown }).output),
    mcp: parse(redactToolOutput(output, mode)),
  };
}

function expectMasked(result: unknown, [path, secrets]: Row, layer: string) {
  for (const secret of secrets) {
    expect(valueAt(result, path), `${layer} ${path}`).not.toContain(secret);
  }
}

function expectSentAsIs(result: unknown, path: string, layer: string) {
  expect(valueAt(result, path), `${layer} ${path}`).toBe(
    valueAt(FIXTURE, path),
  );
}

describe("PRIVACY.md redaction table, at the model layer", () => {
  it.each([
    "strict",
    "standard",
    "off",
  ] as const)("%s: shape-recognised secrets, header lines and credential words in text are masked", async (mode) => {
    for (const [layer, result] of Object.entries(await asSent(mode))) {
      for (const row of MASKED_IN_EVERY_MODE) expectMasked(result, row, layer);
    }
  });

  it.each([
    "strict",
    "standard",
  ] as const)("%s: values of credential and person keys and MRNs in text are masked (the control for Off)", async (mode) => {
    for (const [layer, result] of Object.entries(await asSent(mode))) {
      for (const row of MASKED_UNLESS_OFF) expectMasked(result, row, layer);
    }
  });

  it("off: values of credential and person keys, MRNs in text, page titles and URL query values are sent as is", async () => {
    for (const [layer, result] of Object.entries(await asSent("off"))) {
      for (const [path] of [...MASKED_UNLESS_OFF, MASKED_IN_STRICT_ONLY]) {
        expectSentAsIs(result, path, layer);
      }
      expectSentAsIs(result, "url", layer);
    }
  });

  it.each([
    "strict",
    "standard",
    "off",
  ] as const)("%s: values of JSON keys not on the list are sent as is, even when the key contains a credential word", async (mode) => {
    for (const [layer, result] of Object.entries(await asSent(mode))) {
      for (const name of OTHER_KEY_NAMES) {
        expectSentAsIs(result, `otherKeys.${name}`, layer);
      }
    }
  });

  it("masks page titles in Strict only", async () => {
    for (const [layer, result] of Object.entries(await asSent("strict"))) {
      expectMasked(result, MASKED_IN_STRICT_ONLY, layer);
    }
    for (const [layer, result] of Object.entries(await asSent("standard"))) {
      expectSentAsIs(result, "page_title", layer);
    }
  });

  it.each([
    "strict",
    "standard",
    "off",
  ] as const)("%s: a JSON result over 100,000 characters is masked the same way", async (mode) => {
    const large = JSON.stringify({ ...FIXTURE, pad: "x".repeat(100_000) });
    const [small, big] = [await asSent(mode), await asSent(mode, large)];
    for (const layer of ["chat", "mcp"] as const) {
      const { pad: _pad, ...rest } = big[layer] as Record<string, unknown>;
      expect(rest, layer).toEqual(small[layer]);
    }
  });
});
