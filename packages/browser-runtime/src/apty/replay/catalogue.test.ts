import { describe, expect, it } from "vitest";
import { FILES_4X, FILES_5X, filePath, specFor } from "./catalogue";

const IDS = {
  tenantId: "t1",
  applicationId: "a1",
  environmentId: "e1",
};
const EXTRA = { userId: "u1", chatId: "c1", workflowId: "w1" };

const expected5x: Record<string, string> = {
  tenant: "tenant-t1/{name}",
  application: "tenant-t1/app-a1/{name}",
  environment: "tenant-t1/app-a1/env-e1/{name}",
};

describe("filePath, 5.x", () => {
  it.each(
    FILES_5X.map((f) => [f.name, f.scope] as const),
  )("builds %s at %s scope", (name, scope) => {
    const built = filePath({ version: "5.x", ...IDS }, name, EXTRA);
    if (!built.ok) throw new Error(built.detail);
    const resolved = name
      .replace("{userId}", "u1")
      .replace("{chatId}", "c1")
      .replace("{workflowId}", "w1");
    const template =
      scope === "user"
        ? expected5x.application
        : scope === "workflow"
          ? expected5x.environment
          : expected5x[scope];
    expect(built.path).toBe(template?.replace("{name}", resolved));
  });

  it("builds the stored chat paths the 5.x player reads", () => {
    const ctx = { version: "5.x" as const, ...IDS };
    expect(
      filePath(ctx, "users/{userId}/widget-chat/chat-list.json", EXTRA),
    ).toMatchObject({
      ok: true,
      path: "tenant-t1/app-a1/users/u1/widget-chat/chat-list.json",
    });
    expect(
      filePath(ctx, "users/{userId}/widget-chat/{chatId}.json", EXTRA),
    ).toMatchObject({
      ok: true,
      path: "tenant-t1/app-a1/users/u1/widget-chat/c1.json",
    });
  });

  it("takes a step file by its workflow id, at the environment", () => {
    expect(
      filePath({ version: "5.x", ...IDS }, "workflow-0c01.json"),
    ).toMatchObject({
      ok: true,
      path: "tenant-t1/app-a1/env-e1/workflow-0c01.json",
    });
    expect(specFor("5.x", "flow-1.json")).toBeUndefined();
  });

  it("names the missing ID for each scope", () => {
    const tenantOnly = { version: "5.x" as const, tenantId: "t1" };
    expect(filePath(tenantOnly, "app-urls.json").ok).toBe(true);
    expect(filePath(tenantOnly, "app-data.json")).toMatchObject({
      ok: false,
      failure: "ids_missing",
      detail: "app-data.json needs the application ID.",
    });
    expect(
      filePath({ ...tenantOnly, applicationId: "a1" }, "tooltip.json"),
    ).toMatchObject({ ok: false, failure: "ids_missing" });
    expect(
      filePath({ version: "5.x", ...IDS }, "users/{userId}.json"),
    ).toMatchObject({ ok: false, failure: "ids_missing" });
  });

  it("refuses a file outside the catalogue and an ID that is not a plain segment", () => {
    const ctx = { version: "5.x" as const, ...IDS };
    for (const file of [
      "../secrets.json",
      "admin/users.json",
      "tooltip.json?x=1",
      "flow.json",
    ]) {
      expect(filePath(ctx, file)).toMatchObject({
        ok: false,
        failure: "unknown_file",
      });
    }
    expect(
      filePath({ ...ctx, environmentId: "e1/../../x" }, "tooltip.json"),
    ).toMatchObject({ ok: false, failure: "ids_missing" });
    expect(
      filePath(ctx, "users/{userId}.json", { userId: "u?x=1" }),
    ).toMatchObject({ ok: false, failure: "ids_missing" });
  });
});

describe("filePath, 4.x", () => {
  it.each(
    FILES_4X.map((f) => [f.name, f.scope] as const),
  )("builds %s at %s scope", (name, scope) => {
    const built = filePath(
      { version: "4.x", tenantId: "k", applicationId: "7", environmentId: "1" },
      name,
      EXTRA,
    );
    if (!built.ok) throw new Error(built.detail);
    const resolved = name
      .replace(/^app\//, "")
      .replace("{userId}", "u1")
      .replace("{workflowId}", "w1");
    const prefix =
      scope === "tenant"
        ? "tenant-k"
        : scope === "application" || scope === "user"
          ? "tenant-k/app-7"
          : "tenant-k/app-7/env-1";
    expect(built.path).toBe(`${prefix}/${resolved}`);
  });

  it("reads content-config.json at tenant scope, and app/content-config.json at application scope", () => {
    expect(specFor("4.x", "content-config.json")?.scope).toBe("tenant");
    expect(
      filePath(
        { version: "4.x", tenantId: "k", applicationId: "7" },
        "app/content-config.json",
      ),
    ).toMatchObject({ ok: true, path: "tenant-k/app-7/content-config.json" });
    expect(specFor("4.x", "flow-12.json")?.scope).toBe("workflow");
  });
});
