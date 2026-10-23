import { classifyPage } from "../classify";
import { diffPageRuns } from "../diff-runs";
import { flattenRun } from "../flatten";
import { noisePolicy } from "../noise";
import type {
  ApplicationCapture,
  DomProfileV2,
  PageCapture,
  ProfileRun,
  RunLabel,
  RunMeta,
} from "../types";

export type Values = Record<string, number>;

/** `{ value: 1 }` for each value, or the given counts. */
export function values(...entries: Array<string | [string, number]>): Values {
  const result: Values = {};
  for (const entry of entries) {
    const [value, count] = typeof entry === "string" ? [entry, 1] : entry;
    result[value] = (result[value] ?? 0) + count;
  }
  return result;
}

export function profile(
  attributes: Record<string, Values>,
  extra: Partial<DomProfileV2> = {},
): DomProfileV2 {
  return { tags: { html: 1, body: 1, div: 10 }, attributes, ...extra };
}

export function run(
  label: RunLabel,
  p: DomProfileV2,
  meta: Partial<RunMeta> = {},
): ProfileRun {
  return {
    profile: p,
    meta: { label, aptyPresent: false, extensionNoisePresent: false, ...meta },
  };
}

export function page(
  pageId: string,
  runs: ProfileRun[],
  label = pageId,
): PageCapture {
  return { pageId, label, runs };
}

export function capture(
  pages: PageCapture[],
  applicationName = "Test app",
): ApplicationCapture {
  return { applicationName, pages };
}

/** A stable page body: the same in every run. */
export function stableAttributes(slug: string): Record<string, Values> {
  return {
    id: values(`${slug}-panel`, "main-content"),
    name: values(["delete", 2], "firstName"),
    class: values(["RptTable", 3], "header"),
  };
}

/** One page through flattening, diffing and classification, as the report builder runs it. */
export function analyze(runs: ProfileRun[], pageId = "p1") {
  const policy = noisePolicy();
  const flats = runs.map((r) => flattenRun(r, policy));
  const diff = diffPageRuns(flats, policy);
  const classified = classifyPage(pageId, pageId, flats, diff, policy);
  const bucketOf = (name: string, value: string) =>
    classified.items.find((i) => i.name === name && i.value === value)?.bucket;
  return { flats, diff, classified, bucketOf };
}
