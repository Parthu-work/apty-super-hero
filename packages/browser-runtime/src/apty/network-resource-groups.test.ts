import { describe, expect, it } from "vitest";
import {
  bodyCandidates,
  type GroupableCall,
  groupByResource,
  isFailedCall,
  MAX_BODY_TRIES,
  resourceKeyOf,
} from "./network-resource-groups";

const call = (overrides: Partial<GroupableCall>): GroupableCall => ({
  requestId: "r",
  method: "GET",
  url: "https://cdn.apty.example/styles.json",
  resourceName: "styles.json",
  timestamp: 1,
  status: 200,
  ...overrides,
});

describe("resourceKeyOf", () => {
  it("ignores the query string and the fragment, and the case of the method", () => {
    expect(
      resourceKeyOf("get", "https://x.example/a.json?timestamp=1#top"),
    ).toBe("GET https://x.example/a.json");
    expect(resourceKeyOf("GET", "/a.json")).toBe("GET /a.json");
  });

  it("tells methods and paths apart", () => {
    const keys = new Set([
      resourceKeyOf("GET", "https://x.example/a.json"),
      resourceKeyOf("POST", "https://x.example/a.json"),
      resourceKeyOf("GET", "https://x.example/b.json"),
      resourceKeyOf("GET", "https://y.example/a.json"),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe("isFailedCall", () => {
  it("counts a network failure and any HTTP error, not a redirect or a pending call", () => {
    expect(isFailedCall(call({ failed: true, status: undefined }))).toBe(true);
    expect(isFailedCall(call({ status: 404 }))).toBe(true);
    expect(isFailedCall(call({ status: 503 }))).toBe(true);
    expect(isFailedCall(call({ status: 302 }))).toBe(false);
    expect(isFailedCall(call({ status: undefined }))).toBe(false);
  });
});

describe("groupByResource", () => {
  const loads = [1, 2, 3].map((load) =>
    call({
      requestId: `s${load}`,
      url: `https://cdn.apty.example/styles.json?timestamp=${load}`,
      timestamp: load,
    }),
  );

  it("joins calls that differ only in their query string, newest first, in the order of the latest call", () => {
    const rules = call({
      requestId: "rules",
      url: "https://cdn.apty.example/rules.json",
      resourceName: "rules.json",
      timestamp: 2.5,
      status: 500,
    });
    const groups = groupByResource([...loads, rules]);

    expect(groups.map((g) => g.resourceName)).toEqual([
      "styles.json",
      "rules.json",
    ]);
    expect(groups[0]).toMatchObject({
      key: "GET https://cdn.apty.example/styles.json",
      url: "https://cdn.apty.example/styles.json",
      count: 3,
      failedCount: 0,
      method: "GET",
    });
    expect(groups[0]?.calls.map((c) => c.requestId)).toEqual([
      "s3",
      "s2",
      "s1",
    ]);
    expect(groups[0]?.latest.requestId).toBe("s3");
    expect(groups[1]).toMatchObject({ count: 1, failedCount: 1 });
  });

  it("counts failed instances of a resource whose latest call succeeded", () => {
    const [group] = groupByResource([
      call({ requestId: "a", timestamp: 1, status: 500 }),
      call({ requestId: "b", timestamp: 2 }),
      call({ requestId: "c", timestamp: 3, status: undefined, failed: true }),
      call({ requestId: "d", timestamp: 4 }),
    ]);
    expect(group).toMatchObject({ count: 4, failedCount: 2 });
    expect(group?.latest.requestId).toBe("d");
  });

  it("keeps a call reported later first when two have the same time", () => {
    const [group] = groupByResource([
      call({ requestId: "first", timestamp: 7 }),
      call({ requestId: "second", timestamp: 7 }),
    ]);
    expect(group?.calls.map((c) => c.requestId)).toEqual(["second", "first"]);
  });

  it("returns nothing for no calls", () => {
    expect(groupByResource([])).toEqual([]);
  });
});

describe("bodyCandidates", () => {
  const ids = (calls: GroupableCall[]) =>
    bodyCandidates(calls).map((c) => c.requestId);
  const newestFirst = (flags: Array<boolean | undefined>) =>
    flags.map((hasBody, i) =>
      call({ requestId: `c${i}`, timestamp: 100 - i, hasBody }),
    );

  it("takes only the calls the Client says have a body", () => {
    expect(ids(newestFirst([false, true, false, true]))).toEqual(["c1", "c3"]);
  });

  it("without the flag tries the newest calls, up to the limit", () => {
    expect(MAX_BODY_TRIES).toBe(3);
    expect(
      ids(newestFirst([undefined, undefined, undefined, undefined, undefined])),
    ).toEqual(["c0", "c1", "c2"]);
  });

  it("skips calls the Client rules out when others are unknown", () => {
    expect(ids(newestFirst([false, undefined, false, undefined]))).toEqual([
      "c1",
      "c3",
    ]);
  });

  it("asks the newest once when the Client rules out every call, so it can say why", () => {
    expect(ids(newestFirst([false, false, false]))).toEqual(["c0"]);
  });

  it("limits flagged calls too", () => {
    expect(ids(newestFirst([true, true, true, true]))).toHaveLength(
      MAX_BODY_TRIES,
    );
  });
});
