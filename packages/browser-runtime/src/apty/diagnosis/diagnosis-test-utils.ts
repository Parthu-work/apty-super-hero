import type { AptyObservedResource } from "../types.js";
import flow4x from "./fixtures/content-4x/flow.json";
import segments4x from "./fixtures/content-4x/segments.json";
import announcement from "./fixtures/content-5x/announcement.json";
import appData from "./fixtures/content-5x/app-data.json";
import appUrls from "./fixtures/content-5x/app-urls.json";
import checklist from "./fixtures/content-5x/checklist.json";
import knowledgeContent from "./fixtures/content-5x/knowledge-content.json";
import launcher from "./fixtures/content-5x/launcher.json";
import rule from "./fixtures/content-5x/rule.json";
import segment from "./fixtures/content-5x/segment.json";
import tooltip from "./fixtures/content-5x/tooltip.json";
import validation from "./fixtures/content-5x/validation.json";
import workflow from "./fixtures/content-5x/workflow.json";
import type { ClientEvidence, LoadedFile } from "./types.js";

export const ENV_PATH =
  "https://client.apty.example/tenant-0f000000-0000-7000-8000-000000000000/app-0a000000-0000-7000-8000-000000000001/env-0e000000-0000-7000-8000-000000000002";

export type Capture = Record<string, unknown>;

const SETS: Record<"content-5x" | "content-4x", Capture> = {
  "content-5x": {
    "workflow.json": workflow,
    "segment.json": segment,
    "rule.json": rule,
    "app-urls.json": appUrls,
    "app-data.json": appData,
    "tooltip.json": tooltip,
    "launcher.json": launcher,
    "announcement.json": announcement,
    "validation.json": validation,
    "checklist.json": checklist,
    "knowledge-content.json": knowledgeContent,
  },
  "content-4x": { "segments.json": segments4x, "flow.json": flow4x },
};

/** The synthetic content files, by name, as a fresh copy on every call. */
export function capture(set: keyof typeof SETS = "content-5x"): Capture {
  return JSON.parse(JSON.stringify(SETS[set])) as Capture;
}

/** The same files as the loader would hand them over, every one read. */
export function evidenceFrom(files: Capture): ClientEvidence {
  return {
    connection: { ok: true },
    observedNames: Object.keys(files),
    files: Object.fromEntries(
      Object.entries(files).map(([name, json]): [string, LoadedFile] => [
        name,
        {
          name,
          status: Array.isArray(json) && json.length === 0 ? "empty" : "ok",
          httpStatus: 200,
          json,
        },
      ]),
    ),
    envId: "env-0e000000-0000-7000-8000-000000000002",
  };
}

export interface ServedFile {
  name: string;
  body?: string;
  status?: number;
  failed?: boolean;
}

/** The Client's resource list for served files, as the bridge reports it. */
export function resourcesFor(files: ServedFile[]): AptyObservedResource[] {
  return files.map((file, index) => ({
    requestId: `r${index + 1}`,
    url: `${ENV_PATH}/${file.name}?timestamp=${1000 + index}`,
    method: "GET",
    ...(file.failed ? { failed: true, errorText: "net::ERR_FAILED" } : {}),
    ...(file.failed ? {} : { status: file.status ?? 200 }),
    mimeType: "application/json",
    timestamp: 1000 + index,
    hasBody: file.body !== undefined,
  }));
}

export function served(files: Capture): ServedFile[] {
  return Object.entries(files).map(([name, json]) => ({
    name,
    body: JSON.stringify(json),
  }));
}
