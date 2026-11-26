/**
 * The GET requests the Apty player makes to its content host, as the Agent
 * replays them. Every entry is cited in
 * docs/development/replay-network-source.md (request catalogue).
 */
import type {
  AptyContentContext,
  AptyFetchFailure,
  AptyFileExtra,
  AptyFileSpec,
  AptyVersion,
} from "@apty/agent-core";

const spec = (
  version: AptyVersion,
  scope: AptyFileSpec["scope"],
  name: string,
  purpose: string,
  needs?: AptyFileSpec["needs"],
): AptyFileSpec => ({
  version,
  scope,
  name,
  purpose,
  ...(needs ? { needs } : {}),
});

const env5 = (name: string, purpose: string) =>
  spec("5.x", "environment", name, purpose);

export const FILES_5X: readonly AptyFileSpec[] = [
  spec(
    "5.x",
    "tenant",
    "app-urls.json",
    "applications, environments and their URL patterns",
  ),
  spec("5.x", "tenant", "content-config.json", "publish timestamps per file"),
  spec(
    "5.x",
    "application",
    "app-data.json",
    "application config: widget audience, user identification",
  ),
  spec(
    "5.x",
    "application",
    "application-locales.json",
    "the application's languages",
  ),
  env5("tooltip.json", "tooltips"),
  env5("workflow.json", "workflows"),
  spec(
    "5.x",
    "workflow",
    "workflow-{workflowId}.json",
    "one workflow's steps",
    ["workflowId"],
  ),
  env5("launcher.json", "launchers"),
  env5("announcement.json", "announcements"),
  env5("validation.json", "validations"),
  env5("checklist.json", "checklists"),
  env5("knowledge-content.json", "knowledge content"),
  env5("segment.json", "segments: which items each audience gets"),
  env5("rule.json", "rules used by segments and visibility rules"),
  env5("tag.json", "tags"),
  env5("application-script.json", "application scripts"),
  env5("validation-disable-element.json", "elements validations disable"),
  env5("theme.json", "themes"),
  env5("baseline-journey.json", "baseline journeys"),
  env5("popup.json", "popups"),
  env5("labels.json", "labels"),
  env5("most-used-content.json", "most used content"),
  spec(
    "5.x",
    "user",
    "users/{userId}.json",
    "the user's preferences: favorites, progress, reminders",
    ["userId"],
  ),
  spec(
    "5.x",
    "user",
    "users/{userId}/widget-chat/chat-list.json",
    "the user's stored Ask Dapty chats",
    ["userId"],
  ),
  spec(
    "5.x",
    "user",
    "users/{userId}/widget-chat/{chatId}.json",
    "one stored Ask Dapty chat",
    ["userId", "chatId"],
  ),
];

/** Selects a file the player reads at both tenant and application scope, at application scope; not part of the request path. */
const APP_SCOPED = "app/";

const env4 = (name: string, purpose: string) =>
  spec("4.x", "environment", name, purpose);
const app4 = (name: string, purpose: string) =>
  spec("4.x", "application", name, purpose);

export const FILES_4X: readonly AptyFileSpec[] = [
  spec(
    "4.x",
    "tenant",
    "content-config.json",
    "tenant publish timestamps per file",
  ),
  spec("4.x", "tenant", "feature-flag.json", "feature flags"),
  spec("4.x", "tenant", "properties.json", "tenant properties"),
  spec(
    "4.x",
    "tenant",
    "app-urls.json",
    "applications and their environment URLs",
  ),
  spec("4.x", "tenant", "tenant-config.json", "tenant config"),
  app4(
    `${APP_SCOPED}content-config.json`,
    "application publish timestamps per file",
  ),
  app4("app-data.json", "application and its environments"),
  app4("segments.json", "segments"),
  app4("rules.json", "rules"),
  app4("langs.json", "languages"),
  app4("tags.json", "tags"),
  app4("keywords.json", "keywords"),
  app4("styles.json", "styles"),
  app4("themes.json", "themes"),
  env4("tooltip.json", "tooltips"),
  env4("flow.json", "flows"),
  spec("4.x", "workflow", "flow-{workflowId}.json", "one flow's steps", [
    "workflowId",
  ]),
  env4("launcher.json", "launchers"),
  env4("validation.json", "validations"),
  env4("announcement.json", "announcements"),
  env4("form.json", "pages (frames) items are attached to"),
  env4("onboarding.json", "onboarding"),
  env4("knowledge-content.json", "knowledge content"),
  env4("smart-canvas-templates.json", "smart canvas templates"),
  env4("activities.json", "activities"),
  spec("4.x", "user", "users/{userId}.json", "the user's preferences", [
    "userId",
  ]),
];

export const filesOf = (version: AptyVersion): readonly AptyFileSpec[] =>
  version === "4.x" ? FILES_4X : FILES_5X;

/** A path segment the player puts in a URL as is: no separator or query in it. */
export const PATH_SAFE = /^[^/?#\\\s]{1,256}$/;
const STEP_FILE = {
  "5.x": /^workflow-[\w-]{1,200}\.json$/,
  "4.x": /^flow-[\w-]{1,200}\.json$/,
};

/** The catalogue entry for a file: its exact name, a template name, or a step file by id. */
export function specFor(
  version: AptyVersion,
  file: string,
): AptyFileSpec | undefined {
  const files = filesOf(version);
  return (
    files.find((f) => f.name === file) ??
    (STEP_FILE[version].test(file)
      ? files.find((f) => f.scope === "workflow")
      : undefined)
  );
}

export type PathResult =
  | { ok: true; path: string; spec: AptyFileSpec }
  | { ok: false; failure: AptyFetchFailure; detail: string };

const missing = (detail: string): PathResult => ({
  ok: false,
  failure: "ids_missing",
  detail,
});

/**
 * The path under the content URL the player requests for a file:
 * `tenant-{t}[/app-{a}[/env-{e}]]/{file}`, a template's `{id}` filled from
 * `extra`. A file outside the catalogue is never requested, so a model
 * cannot steer a fetch to another path.
 */
export function filePath(
  context: Pick<
    AptyContentContext,
    "version" | "tenantId" | "applicationId" | "environmentId"
  >,
  file: string,
  extra: AptyFileExtra = {},
): PathResult {
  const found = specFor(context.version, file);
  if (!found) {
    return {
      ok: false,
      failure: "unknown_file",
      detail: `${file} is not a file the Apty ${context.version} player requests.`,
    };
  }
  const ids = [
    context.tenantId,
    context.applicationId,
    context.environmentId,
    extra.userId,
    extra.chatId,
    extra.workflowId,
  ];
  if (ids.some((id) => id !== undefined && !PATH_SAFE.test(id))) {
    return missing("An ID is not a plain path segment.");
  }
  let name = file.startsWith(APP_SCOPED) ? file.slice(APP_SCOPED.length) : file;
  for (const key of found.needs ?? []) {
    if (!name.includes(`{${key}}`)) continue;
    const value = extra[key];
    if (!value) return missing(`${found.name} needs the ${key}.`);
    name = name.replace(`{${key}}`, value);
  }
  const tenant = `tenant-${context.tenantId}`;
  if (found.scope === "tenant")
    return { ok: true, path: `${tenant}/${name}`, spec: found };
  if (!context.applicationId)
    return missing(`${file} needs the application ID.`);
  const app = `${tenant}/app-${context.applicationId}`;
  if (found.scope === "application" || found.scope === "user") {
    return { ok: true, path: `${app}/${name}`, spec: found };
  }
  if (!context.environmentId)
    return missing(`${file} needs the environment ID.`);
  return {
    ok: true,
    path: `${app}/env-${context.environmentId}/${name}`,
    spec: found,
  };
}
