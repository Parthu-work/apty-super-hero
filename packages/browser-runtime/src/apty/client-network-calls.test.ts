import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const AGENT_ID = "bpiondflhhdplemamgggcdajclmoeple";

const mockSendMessage = vi.hoisted(() => vi.fn());
const settings = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

(globalThis as { chrome?: unknown }).chrome = {
  runtime: {
    id: AGENT_ID,
    sendMessage: mockSendMessage,
    lastError: undefined as { message: string } | undefined,
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: settings.value })),
    },
    onChanged: { addListener: vi.fn() },
  },
};

import { resetRedactionModeForTests } from "../runtime/redaction-mode";
import {
  listClientNetworkCalls,
  readClientNetworkCallBody,
  readClientResourceBody,
} from "./client-network-calls";
import { groupByResource } from "./network-resource-groups";

const CALLS = [
  {
    requestId: "r1",
    url: "https://cdn.apty.example/segments.json?token=abc123",
    method: "GET",
    status: 200,
    mimeType: "application/json",
    timestamp: 1,
  },
  {
    requestId: "r2",
    url: "https://cdn.apty.example/users/4815162342.json",
    method: "GET",
    status: 200,
    mimeType: "application/json",
    timestamp: 2,
  },
  {
    requestId: "r3",
    url: "https://cdn.apty.example/missing.json",
    method: "GET",
    status: 404,
    mimeType: "application/json",
    timestamp: 3,
  },
  {
    requestId: "r4",
    url: "https://cdn.apty.example/flows.json",
    method: "POST",
    failed: true,
    errorText: "net::ERR_CONNECTION_RESET",
    timestamp: 4,
  },
  {
    requestId: "r5",
    url: "https://cdn.apty.example/slow.json",
    method: "GET",
    timestamp: 5,
  },
];

const BODIES: Record<string, string> = {
  r1: JSON.stringify([{ id: 4385, name: "sales-team", password: "hunter2" }]),
  r2: JSON.stringify({ locale: "en-GB" }),
  r3: JSON.stringify({ error: "not found" }),
};

interface ClientMessage {
  type: string;
  requestId?: string;
}

type Reply = unknown | ((message: ClientMessage) => unknown);

/** Answers each message type like a Client would; `lastError` simulates a Chrome-level failure. */
function client(
  replies: Record<string, Reply>,
  lastError?: string,
): { bodyRequests: string[] } {
  const bodyRequests: string[] = [];
  mockSendMessage.mockImplementation(
    (_id: string, message: ClientMessage, callback: (r: unknown) => void) => {
      if (message.type === "apty-debug-agent:get-resource-body") {
        bodyRequests.push(message.requestId);
      }
      if (lastError) {
        chrome.runtime.lastError = { message: lastError };
        callback(undefined);
        chrome.runtime.lastError = undefined;
        return;
      }
      const reply = replies[message.type];
      if (reply === "never") return;
      callback(typeof reply === "function" ? reply(message) : reply);
    },
  );
  return { bodyRequests };
}

const working = () =>
  client({
    "apty-debug-agent:list-observed-resources": { resources: CALLS },
    "apty-debug-agent:get-resource-body": (m: { requestId: string }) =>
      BODIES[m.requestId] !== undefined
        ? { found: true, body: BODIES[m.requestId] }
        : { found: false },
  });

beforeEach(() => {
  mockSendMessage.mockReset();
  chrome.runtime.lastError = undefined;
  settings.value = {
    redactionMode: "strict",
    networkBodyCaptureDenyList: ["/users/"],
  };
  resetRedactionModeForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("listClientNetworkCalls", () => {
  it("lists every call with its name, under the URL policy of the redaction mode", async () => {
    working();
    const result = await listClientNetworkCalls(EXT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.calls.map((c) => c.resourceName)).toEqual([
      "segments.json",
      ":id.json",
      "missing.json",
      "flows.json",
      "slow.json",
    ]);
    expect(result.calls[0]?.url).toBe("https://cdn.apty.example/segments.json");
    expect(result.calls[1]?.url).toBe(
      "https://cdn.apty.example/users/:id.json",
    );
    expect(result.calls[3]).toMatchObject({
      failed: true,
      errorText: "net::ERR_CONNECTION_RESET",
    });
    expect(result.mayBeBounded).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/abc123|4815162342/);
  });

  it("keeps the path in Standard and says when the Client's list may be cut off", async () => {
    settings.value = { redactionMode: "standard" };
    const many = Array.from({ length: 1000 }, (_, i) => ({
      requestId: `r${i}`,
      url: `https://cdn.apty.example/users/4815162342/${i}.json`,
      method: "GET",
      status: 200,
      timestamp: i,
    }));
    client({ "apty-debug-agent:list-observed-resources": { resources: many } });

    const result = await listClientNetworkCalls(EXT_ID);

    expect(result).toMatchObject({ ok: true, mayBeBounded: true });
    if (result.ok) {
      expect(result.calls[0]?.url).toContain("/users/4815162342/0.json");
    }
  });

  it("lists the newest 1000 of a longer list and says it may be cut off", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      requestId: `r${i}`,
      url: `https://cdn.apty.example/${i}.json`,
      method: "GET",
      status: 200,
      timestamp: i,
    }));
    client({ "apty-debug-agent:list-observed-resources": { resources: many } });

    const result = await listClientNetworkCalls(EXT_ID);

    expect(result).toMatchObject({ ok: true, mayBeBounded: true });
    if (result.ok) {
      expect(result.calls).toHaveLength(1000);
      expect(result.calls[0]?.requestId).toBe("r200");
    }
  });

  it("names a missing ID instead of sending anything", async () => {
    const result = await listClientNetworkCalls(undefined);

    expect(result).toMatchObject({ ok: false, failure: "not_configured" });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("names a Client that doesn't allow-list this Agent, with the fix and this Agent's ID", async () => {
    client({}, "Could not establish connection. Receiving end does not exist.");

    const result = await listClientNetworkCalls(EXT_ID);

    expect(result).toMatchObject({ ok: false, failure: "no_receiver" });
    if (!result.ok) {
      expect(result.message).toMatch(/externally_connectable\.ids/);
      expect(result.fix).toContain(AGENT_ID);
    }
  });

  it("names a Client that doesn't implement the list message", async () => {
    client({}, "The message port closed before a response was received.");

    const result = await listClientNetworkCalls(EXT_ID);

    expect(result).toMatchObject({ ok: false, failure: "no_response" });
    if (!result.ok) {
      expect(result.message).toContain(
        "apty-debug-agent:list-observed-resources",
      );
      expect(result.fix).toBeUndefined();
    }
  });

  it("names a Client that never answers, after the retry", async () => {
    vi.useFakeTimers();
    client({ "apty-debug-agent:list-observed-resources": "never" });

    const pending = listClientNetworkCalls(EXT_ID);
    await vi.advanceTimersByTimeAsync(14_000);

    expect(await pending).toMatchObject({ ok: false, failure: "timeout" });
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });

  it("names an answer of the wrong shape", async () => {
    client({
      "apty-debug-agent:list-observed-resources": { resources: "lots" },
    });

    const result = await listClientNetworkCalls(EXT_ID);

    expect(result).toMatchObject({ ok: false, failure: "malformed_response" });
    if (!result.ok) expect(result.message).toMatch(/unexpected shape/);
  });

  it("reports an empty list as an empty list, not a failure", async () => {
    client({ "apty-debug-agent:list-observed-resources": { resources: [] } });

    expect(await listClientNetworkCalls(EXT_ID)).toEqual({
      ok: true,
      calls: [],
      mayBeBounded: false,
    });
  });
});

describe("readClientNetworkCallBody", () => {
  it("returns the whole body, redacted, with the call it belongs to", async () => {
    working();
    const result = await readClientNetworkCallBody(EXT_ID, "r1");

    expect(result).toMatchObject({
      status: "ok",
      call: { requestId: "r1", resourceName: "segments.json" },
    });
    if ("body" in result && result.body) {
      expect(result.body.text).toContain("sales-team");
      expect(result.body.text).not.toContain("hunter2");
      expect(result.body.fullLength).toBe(result.body.text.length);
    }
  });

  it("never asks the Client for a body on the deny list", async () => {
    const { bodyRequests } = working();
    const result = await readClientNetworkCallBody(EXT_ID, "r2");

    expect(result).toMatchObject({
      status: "body_denied",
      deniedBy: "/users/",
    });
    expect(bodyRequests).toEqual([]);
  });

  it("returns an HTTP error's body, and names failed, pending and dropped calls", async () => {
    working();

    const notFound = await readClientNetworkCallBody(EXT_ID, "r3");
    expect(notFound).toMatchObject({ status: "http_error" });
    expect("body" in notFound && notFound.body?.text).toContain("not found");
    expect(await readClientNetworkCallBody(EXT_ID, "r4")).toMatchObject({
      status: "failed",
    });
    expect(await readClientNetworkCallBody(EXT_ID, "r5")).toMatchObject({
      status: "pending",
    });
    expect(await readClientNetworkCallBody(EXT_ID, "gone")).toEqual({
      status: "not_observed",
    });
  });

  it("names why the Client couldn't be read", async () => {
    client({}, "Could not establish connection. Receiving end does not exist.");

    expect(await readClientNetworkCallBody(EXT_ID, "r1")).toMatchObject({
      status: "not_connected",
      failure: "no_receiver",
    });
  });
});

describe("a relative URL the Client reports", () => {
  const ID = "4815162342";
  const DOB = "1980-01-01";
  const RELATIVE = [
    {
      requestId: "rel",
      url: `/api/users/${ID}.json?dob=${DOB}`,
      method: "GET",
      status: 200,
      mimeType: "application/json",
      timestamp: 1,
    },
    {
      requestId: "bad",
      url: `http://[${ID}?dob=${DOB}`,
      method: "GET",
      status: 200,
      mimeType: "application/json",
      timestamp: 2,
    },
  ];

  function setMode(mode: "strict" | "standard") {
    settings.value = { redactionMode: mode };
    resetRedactionModeForTests();
  }

  beforeEach(() => {
    client({
      "apty-debug-agent:list-observed-resources": { resources: RELATIVE },
      "apty-debug-agent:get-resource-body": { found: true, body: "{}" },
    });
  });

  it("in Strict shows neither the record number nor the query value, in the list or with a body", async () => {
    setMode("strict");
    const list = await listClientNetworkCalls(EXT_ID);
    const body = await readClientNetworkCallBody(EXT_ID, "rel");

    expect(list.ok && list.calls[0]).toMatchObject({
      url: "/api/users/:id.json",
      resourceName: ":id.json",
    });
    expect(body).toMatchObject({
      status: "ok",
      call: { resourceName: ":id.json" },
    });
    expect(JSON.stringify([list, body])).not.toMatch(
      new RegExp(`${ID}|${DOB}`),
    );
  });

  it("in Standard keeps the path but never the query value", async () => {
    setMode("standard");
    const list = await listClientNetworkCalls(EXT_ID);
    const body = await readClientNetworkCallBody(EXT_ID, "rel");

    expect(list.ok && list.calls[0]?.url).toContain(`/api/users/${ID}.json`);
    expect(JSON.stringify([list, body])).not.toContain(DOB);
  });

  it("follows the mode current when it is shown, either way round", async () => {
    setMode("standard");
    expect(JSON.stringify(await listClientNetworkCalls(EXT_ID))).toContain(ID);
    setMode("strict");
    const strictBody = await readClientNetworkCallBody(EXT_ID, "rel");
    expect(JSON.stringify(strictBody)).not.toMatch(new RegExp(`${ID}|${DOB}`));

    setMode("standard");
    const standardBody = await readClientNetworkCallBody(EXT_ID, "rel");
    expect(JSON.stringify(standardBody)).toContain(ID);
    expect(JSON.stringify(standardBody)).not.toContain(DOB);
  });

  it("shows an unparsable URL as empty, never raw", async () => {
    for (const mode of ["strict", "standard"] as const) {
      setMode(mode);
      const list = await listClientNetworkCalls(EXT_ID);
      expect(list.ok && list.calls[1]).toMatchObject({
        url: "",
        resourceName: "",
      });
      expect(JSON.stringify(list)).not.toContain(DOB);
    }
  });
});

describe("readClientResourceBody", () => {
  const RECORD = "4815162342";
  const BIRTH = "1980-01-01";
  const loads = [1, 2, 3].map((load) => ({
    requestId: `rec-${load}`,
    url: `https://api.apty.example/records/${RECORD}.json?dob=${BIRTH}&timestamp=${load}`,
    method: "GET",
    status: 200,
    mimeType: "application/json",
    timestamp: load,
  }));
  const KEY_STRICT = "GET https://api.apty.example/records/:id.json";

  function listing(
    resources: unknown[],
    bodies: Record<string, string>,
    reasons: Record<string, string> = {},
  ) {
    return client({
      "apty-debug-agent:list-observed-resources": { resources },
      "apty-debug-agent:get-resource-body": (m: { requestId: string }) =>
        bodies[m.requestId] !== undefined
          ? { found: true, body: bodies[m.requestId] }
          : {
              found: false,
              ...(reasons[m.requestId] ? { reason: reasons[m.requestId] } : {}),
            },
    });
  }

  it("groups by the shown URL in Strict, so no key or name carries the record number, query value or cache-buster", async () => {
    settings.value = { redactionMode: "strict" };
    listing(loads, {});
    const list = await listClientNetworkCalls(EXT_ID);
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const groups = groupByResource(list.calls);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: KEY_STRICT, count: 3 });
    expect(
      JSON.stringify(groups.map(({ calls: _calls, latest: _l, ...g }) => g)),
    ).not.toMatch(new RegExp(`${RECORD}|${BIRTH}|timestamp`));
  });

  it("in Strict and Standard reads the newest call that has a body, masked, from its key", async () => {
    for (const mode of ["strict", "standard"] as const) {
      settings.value = { redactionMode: mode, networkBodyCaptureDenyList: [] };
      resetRedactionModeForTests();
      const resources = loads.map((l) => ({
        ...l,
        hasBody: l.requestId === "rec-2",
      }));
      const asked = listing(resources, {
        "rec-2": '{"email":"jane.doe@example.com","v":2}',
      });
      const list = await listClientNetworkCalls(EXT_ID);
      if (!list.ok) throw new Error("list failed");
      const [group] = groupByResource(list.calls);

      const result = await readClientResourceBody(EXT_ID, group?.key ?? "");

      expect(result, mode).toMatchObject({
        status: "ok",
        call: { requestId: "rec-2" },
        newerCallsWithoutBody: 1,
      });
      expect(asked.bodyRequests, mode).toEqual(["rec-2"]);
      const shown = JSON.stringify(result);
      expect(shown, mode).not.toContain("jane.doe@example.com");
      expect(shown, mode).not.toContain(BIRTH);
      if (mode === "strict") expect(shown).not.toContain(RECORD);
    }
  });

  it("with a Client that sends no hasBody, tries the newest three calls and stops at the first body", async () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({
      ...loads[0],
      requestId: `m${n}`,
      timestamp: n,
    }));
    const asked = listing(many, { m3: "{}" });
    const result = await readClientResourceBody(EXT_ID, KEY_STRICT);
    expect(result).toMatchObject({
      status: "ok",
      call: { requestId: "m3" },
      newerCallsWithoutBody: 2,
    });
    expect(asked.bodyRequests).toEqual(["m5", "m4", "m3"]);

    const none = listing(many, { m1: "{}" });
    const missed = await readClientResourceBody(EXT_ID, KEY_STRICT);
    expect(missed).toMatchObject({
      status: "body_unavailable",
      call: { requestId: "m5" },
    });
    expect(none.bodyRequests).toEqual(["m5", "m4", "m3"]);
  });

  it("passes the Client's reason through, and nothing when it sends none", async () => {
    listing(loads, {}, { "rec-3": "evicted" });
    expect(await readClientResourceBody(EXT_ID, KEY_STRICT)).toMatchObject({
      status: "body_unavailable",
      reason: "evicted",
    });
    listing(loads, {});
    const plain = await readClientResourceBody(EXT_ID, KEY_STRICT);
    expect(plain).toMatchObject({ status: "body_unavailable" });
    expect("reason" in plain).toBe(false);
  });

  it("never asks the Client for a body whose raw URL is on the deny list", async () => {
    settings.value = {
      redactionMode: "strict",
      networkBodyCaptureDenyList: ["dob=1980"],
    };
    const asked = listing(loads, { "rec-3": "{}" });
    const result = await readClientResourceBody(EXT_ID, KEY_STRICT);
    expect(result).toMatchObject({
      status: "body_denied",
      deniedBy: "dob=1980",
    });
    expect(asked.bodyRequests).toEqual([]);
  });

  it("reads a resource it no longer lists as not observed, and a missing Client as not connected", async () => {
    listing(loads, {});
    expect(
      await readClientResourceBody(EXT_ID, "GET https://gone.example/x.json"),
    ).toEqual({
      status: "not_observed",
    });
    client({}, "Could not establish connection. Receiving end does not exist.");
    expect(await readClientResourceBody(EXT_ID, KEY_STRICT)).toMatchObject({
      status: "not_connected",
    });
  });

  it("reports the Client's failed history saves with the list", async () => {
    client({
      "apty-debug-agent:list-observed-resources": {
        resources: loads,
        saveFailures: 3,
      },
    });
    expect(await listClientNetworkCalls(EXT_ID)).toMatchObject({
      ok: true,
      saveFailures: 3,
    });
    client({
      "apty-debug-agent:list-observed-resources": {
        resources: loads,
        saveFailures: 0,
      },
    });
    const none = await listClientNetworkCalls(EXT_ID);
    expect(none.ok && "saveFailures" in none).toBe(false);
  });
});
