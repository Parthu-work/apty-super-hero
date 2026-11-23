import { describe, expect, it } from "vitest";
import { namedFileVersion } from "./file-version.js";

describe("the Apty version a named content file says (KB-RAG K29, B3)", () => {
  it.each([
    ["what does flow.json mean", "4.x", "flow.json", "workflow.json"],
    ["is FLOW-1234.json empty", "4.x", "flow-1234.json", "workflow-<id>.json"],
    ["segments.json has no rows", "4.x", "segments.json", "segment.json"],
    ["rules.json lists nothing", "4.x", "rules.json", "rule.json"],
    ["what does workflow.json mean", "5.x", "workflow.json", "flow.json"],
    [
      "workflow-0c05ab.json is empty",
      "5.x",
      "workflow-0c05ab.json",
      "flow-<id>.json",
    ],
    ["segment.json lists my segment", "5.x", "segment.json", "segments.json"],
    ["read rule.json", "5.x", "rule.json", "rules.json"],
  ])("%s names a %s file", (question, version, file, counterpart) => {
    expect(namedFileVersion(question)).toMatchObject({
      version,
      file,
      counterpart,
    });
  });

  it("names nothing for a question without a content file, a shared file, or files of both versions", () => {
    expect(namedFileVersion("workflow not working")).toBeUndefined();
    expect(namedFileVersion("what is in app-urls.json")).toBeUndefined();
    expect(
      namedFileVersion("compare flow.json with workflow.json"),
    ).toBeUndefined();
    expect(namedFileVersion("my-workflow.json is custom")).toBeUndefined();
  });

  it("keeps one version's files together and takes the first", () => {
    expect(
      namedFileVersion("from flows.json check segments.json"),
    ).toMatchObject({ version: "4.x", file: "flows.json", kind: "workflows" });
  });
});
