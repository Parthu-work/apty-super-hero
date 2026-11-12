import { createHash } from "node:crypto";
import { canonicalJson, KB_PACK_KIND } from "@apty/agent-core";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { unsignedAllowed } from "../kb/kb-test-utils.js";
import {
  createKbPackStore,
  indexedDbRecords,
  type KbRecords,
  webCryptoSha256,
} from "./kb-store.js";

/** An in-memory `KbRecords`: each putAll or moveAll applies all or nothing, and fails when it touches `failOn`. */
function memoryRecords(): KbRecords & {
  data: Map<string, unknown>;
  failOn: Set<string>;
} {
  const data = new Map<string, unknown>();
  const failOn = new Set<string>();
  const writeAll = async (
    puts: ReadonlyArray<readonly [string, unknown]>,
    deletes: readonly string[],
  ) => {
    const staged = new Map(data);
    for (const [key, value] of puts) {
      if (failOn.has(key)) throw new Error(`FIXTURE write of ${key} failed`);
      staged.set(key, structuredClone(value));
    }
    for (const key of deletes) {
      if (failOn.has(key)) throw new Error(`FIXTURE delete of ${key} failed`);
      staged.delete(key);
    }
    data.clear();
    for (const [key, value] of staged) data.set(key, value);
  };
  return {
    data,
    failOn,
    get: async (key) => structuredClone(data.get(key)) as never,
    putAll: (entries) => writeAll(entries, []),
    moveAll: writeAll,
  };
}

function packText(
  pageId = "101",
  builtAt = "2026-03-01T00:00:00.000Z",
  aptyVersion: "4.x" | "5.x" | "common" = "5.x",
) {
  const body = {
    kind: KB_PACK_KIND,
    schemaVersion: aptyVersion === "5.x" ? 1 : 2,
    builtAt,
    builder: "build-kb-pack 1.0.0",
    source: {
      site: "fixture.atlassian.net",
      space: "FX",
      label: "rag-card",
      cardCount: 1,
    },
    aptyVersion,
    retrieval: { bm25: true, threshold: 2 },
    cards: [
      {
        pageId,
        title: "FIXTURE banner never glows",
        group: "FIXTURE group",
        verifiedOn: "Verified on: FIXTURE code.",
        notVerifiedCount: 0,
        url: `https://fixture.atlassian.net/wiki/spaces/FX/pages/${pageId}`,
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    ],
    chunks: [1, 2, 3, 4].map((layer) => ({
      id: `${pageId}#L${layer}`,
      pageId,
      layer,
      heading: `Layer ${layer}: FIXTURE`,
      text: `- FIXTURE layer ${layer} text.`,
      notVerified: false,
    })),
  };
  const sha256 = createHash("sha256").update(canonicalJson(body)).digest("hex");
  return JSON.stringify({ ...body, sha256 });
}

const NOW = new Date("2026-03-05T10:00:00.000Z");

describe("createKbPackStore", () => {
  it("imports a valid pack and reports what is loaded, without the card text", async () => {
    const records = memoryRecords();
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records,
      now: () => NOW,
    });
    expect(await store.info()).toEqual([]);
    expect(await store.load("5.x")).toBeNull();

    const result = await store.replace(packText());
    expect(result).toEqual({
      ok: true,
      info: {
        aptyVersion: "5.x",
        site: "fixture.atlassian.net",
        space: "FX",
        label: "rag-card",
        cardCount: 1,
        stubCount: 0,
        chunkCount: 4,
        builtAt: "2026-03-01T00:00:00.000Z",
        importedAt: NOW.toISOString(),
        mode: "bm25",
        calibrated: true,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        expiresAt: null,
        signature: null,
      },
    });
    expect(JSON.stringify(records.data.get("meta:5.x"))).not.toContain(
      "FIXTURE",
    );
    expect(await store.info()).toEqual([
      {
        ...(result.ok && result.info),
        usability: {
          trust: { status: "unsigned" },
          validity: { state: "current", date: null },
          usable: true,
        },
      },
    ]);
    expect((await store.load("5.x"))?.chunks).toHaveLength(4);
    expect(await store.load("4.x")).toBeNull();
  });

  it("keeps the loaded pack when an import is refused, and names why", async () => {
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: memoryRecords(),
    });
    await store.replace(packText("101"));
    const tampered = packText("202").replace("layer 2 text", "layer 2 edited");
    expect(await store.replace(tampered)).toEqual({
      ok: false,
      code: "checksum_mismatch",
    });
    expect(await store.replace("{")).toEqual({ ok: false, code: "not_json" });
    expect((await store.load("5.x"))?.cards[0]?.pageId).toBe("101");
  });

  it("replaces a version's pack with the next, and removes it", async () => {
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: memoryRecords(),
    });
    await store.replace(packText("101"));
    await store.replace(packText("202"));
    expect((await store.load("5.x"))?.cards.map((card) => card.pageId)).toEqual(
      ["202"],
    );
    await store.remove("5.x");
    expect(await store.info()).toEqual([]);
    expect(await store.load("5.x")).toBeNull();
  });

  it("holds a 4.x, a 5.x and a common pack side by side, and removing 4.x leaves the others", async () => {
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: memoryRecords(),
    });
    await store.replace(packText("501"));
    await store.replace(packText("401", undefined, "4.x"));
    await store.replace(packText("601", undefined, "common"));
    expect((await store.info()).map((info) => info.aptyVersion)).toEqual([
      "4.x",
      "5.x",
      "common",
    ]);
    expect((await store.load("4.x"))?.cards[0]?.pageId).toBe("401");
    await store.remove("4.x");
    expect((await store.info()).map((info) => info.aptyVersion)).toEqual([
      "5.x",
      "common",
    ]);
    expect((await store.load("5.x"))?.cards[0]?.pageId).toBe("501");
  });

  it("moves the one pack an earlier version stored to 5.x, once, and searches it as before", async () => {
    const records = memoryRecords();
    const older = createKbPackStore({
      assess: unsignedAllowed,
      records,
      now: () => NOW,
    });
    const imported = await older.replace(packText("101"));
    const {
      aptyVersion: _v,
      stubCount: _s,
      ...oldMeta
    } = imported.ok ? imported.info : ({} as never);
    const pack = records.data.get("pack:5.x");
    records.data.clear();
    records.data.set("meta", oldMeta);
    records.data.set("pack", pack);

    const store = createKbPackStore({ assess: unsignedAllowed, records });
    expect(await store.info()).toEqual([
      {
        ...oldMeta,
        aptyVersion: "5.x",
        stubCount: 0,
        usability: expect.objectContaining({ usable: true }),
      },
    ]);
    expect((await store.load("5.x"))?.cards[0]?.pageId).toBe("101");
    expect(records.data.has("meta")).toBe(false);
    expect(records.data.has("pack")).toBe(false);
  });

  it("drops an earlier version's pack whose body does not match its meta record", async () => {
    const records = memoryRecords();
    records.data.set("meta", { sha256: "0".repeat(64) });
    records.data.set("pack", JSON.parse(packText("101")));
    const store = createKbPackStore({ assess: unsignedAllowed, records });
    expect(await store.info()).toEqual([]);
    expect(records.data.size).toBe(0);
  });

  it("does not hand out a body that does not match its meta record", async () => {
    const records = memoryRecords();
    const store = createKbPackStore({ assess: unsignedAllowed, records });
    await store.replace(packText("101"));
    const meta = records.data.get("meta:5.x") as { sha256: string };
    records.data.set("meta:5.x", { ...meta, sha256: "0".repeat(64) });
    expect(await store.load("5.x")).toBeNull();
  });

  it("hashes with Web Crypto", async () => {
    expect(await webCryptoSha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("F8: keeps the previous pack when the meta write of a replace fails", async () => {
    const records = memoryRecords();
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records,
      now: () => NOW,
    });
    await store.replace(packText("101"));
    records.failOn.add("meta:5.x");
    await expect(
      store.replace(packText("202", "2026-03-02T00:00:00.000Z")),
    ).rejects.toThrow(/meta:5\.x/);
    expect((await store.load("5.x"))?.cards[0]?.pageId).toBe("101");
  });

  it("F8: leaves the legacy pack loadable when its migration fails", async () => {
    const records = memoryRecords();
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records,
      now: () => NOW,
    });
    await store.replace(packText("101"));
    const oldMeta = records.data.get("meta:5.x");
    const body = records.data.get("pack:5.x");
    records.data.clear();
    records.data.set("meta", oldMeta);
    records.data.set("pack", body);
    records.failOn.add("pack");
    const failing = createKbPackStore({
      assess: unsignedAllowed,
      records,
      now: () => NOW,
    });
    await expect(failing.load("5.x")).rejects.toThrow(/delete of pack/);
    expect(records.data.has("meta")).toBe(true);
    expect(records.data.has("pack")).toBe(true);
    expect(records.data.has("meta:5.x")).toBe(false);
    records.failOn.clear();
    expect((await failing.load("5.x"))?.cards[0]?.pageId).toBe("101");
  });

  it("F8: removes a version's pack and meta together, or neither", async () => {
    const records = memoryRecords();
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records,
      now: () => NOW,
    });
    await store.replace(packText("101"));
    records.failOn.add("pack:5.x");
    await expect(store.remove("5.x")).rejects.toThrow();
    expect((await store.load("5.x"))?.cards[0]?.pageId).toBe("101");
    records.failOn.clear();
    await store.remove("5.x");
    expect(records.data.size).toBe(0);
  });
});

describe("F8: the store on IndexedDB (fake-indexeddb)", () => {
  const records = () => indexedDbRecords("kb-test", new IDBFactory());
  /** A value IndexedDB cannot store: its put throws a DataCloneError. */
  const unstorable = { invalid: () => undefined };

  it("imports, loads, replaces and removes a pack through one database", async () => {
    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: records(),
      now: () => NOW,
    });
    await store.replace(packText("101"));
    expect((await store.load("5.x"))?.cards[0]?.pageId).toBe("101");
    await store.replace(packText("202", "2026-03-02T00:00:00.000Z"));
    expect((await store.load("5.x"))?.cards[0]?.pageId).toBe("202");
    await store.remove("5.x");
    expect(await store.load("5.x")).toBeNull();
    expect(await store.info()).toEqual([]);
  });

  it("writes all of a putAll or none of it", async () => {
    const db = records();
    await db.putAll([
      ["pack:5.x", { v: "old" }],
      ["meta:5.x", { v: "old" }],
    ]);
    await expect(
      db.putAll([
        ["pack:5.x", { v: "new" }],
        ["meta:5.x", unstorable],
      ]),
    ).rejects.toThrow();
    expect(await db.get("pack:5.x")).toEqual({ v: "old" });
    expect(await db.get("meta:5.x")).toEqual({ v: "old" });
  });

  it("moves the legacy pack in one transaction, or leaves it where it was", async () => {
    const db = records();
    const legacy = createKbPackStore({
      assess: unsignedAllowed,
      records: memoryRecords(),
      now: () => NOW,
    });
    await legacy.replace(packText("101"));
    const body = JSON.parse(packText("101"));
    const meta = (await legacy.info())[0];
    await db.putAll([
      ["pack", body],
      ["meta", meta],
    ]);
    await expect(
      db.moveAll(
        [
          ["pack:5.x", body],
          ["meta:5.x", unstorable],
        ],
        ["meta", "pack"],
      ),
    ).rejects.toThrow();
    expect(await db.get("pack")).toEqual(body);
    expect(await db.get("meta")).toEqual(meta);
    expect(await db.get("pack:5.x")).toBeUndefined();

    const store = createKbPackStore({
      assess: unsignedAllowed,
      records: db,
      now: () => NOW,
    });
    expect((await store.load("5.x"))?.cards[0]?.pageId).toBe("101");
    expect(await db.get("pack")).toBeUndefined();
    expect(await db.get("meta")).toBeUndefined();
  });
});
