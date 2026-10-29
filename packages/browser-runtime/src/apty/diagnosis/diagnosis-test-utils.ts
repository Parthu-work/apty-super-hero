import { readdirSync, readFileSync } from "node:fs";
import type { AptyObservedResource } from "../types.js";
import type { ClientEvidence, LoadedFile } from "./types.js";

const FIXTURES = new URL("./fixtures/", import.meta.url);
export const ENV_PATH =
  "https://client.apty.example/tenant-0f000000-0000-7000-8000-000000000000/app-0a000000-0000-7000-8000-000000000001/env-0e000000-0000-7000-8000-000000000002";

export type Capture = Record<string, unknown>;

/** The synthetic content files, by name, parsed fresh on every call. */
export function capture(set: "content-5x" | "content-4x" = "content-5x") {
  const dir = new URL(`${set}/`, FIXTURES);
  return Object.fromEntries(
    readdirSync(dir).map((name) => [
      name,
      JSON.parse(readFileSync(new URL(name, dir), "utf8")) as unknown,
    ]),
  ) as Capture;
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
