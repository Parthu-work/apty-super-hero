/**
 * Apty's published content, read by the Agent itself (replay): the same GET
 * requests the Apty Client makes to its public content host, from a tenant,
 * application and environment ID. Interfaces only; the browser runtime
 * fetches. Read-only by contract: no write, no credentials, no host but the
 * page's own content URL or one the organization policy names.
 */

export type AptyVersion = "4.x" | "5.x";

/** Where the content file sits under the content URL. */
export type AptyFileScope =
  | "tenant"
  | "application"
  | "environment"
  | "user"
  | "workflow";

export interface AptyFileSpec {
  /** The file as the player names it, or a template such as `workflow-{workflowId}.json`. */
  name: string;
  scope: AptyFileScope;
  version: AptyVersion;
  /** What the player uses it for. */
  purpose: string;
  /** The extra IDs its path needs. */
  needs?: ReadonlyArray<"userId" | "workflowId" | "chatId">;
}

export interface AptyContentContext {
  version: AptyVersion;
  /** The content URL with no trailing slash. */
  contentURL: string;
  tenantId: string;
  applicationId?: string;
  environmentId?: string;
  /** How the player was found on the page, when it was. */
  mode?: "extension" | "injected";
  /** `page`: the page's Apty config; `given`: the SE or the tool call; `url-match`: app-urls.json and the page URL. */
  idsFrom: { tenant: "page" | "given"; environment?: "given" | "url-match" };
}

export interface AptyContextInput {
  version?: AptyVersion;
  tenantId?: string;
  applicationId?: string;
  environmentId?: string;
  /** A content origin: used only if the organization policy names it. */
  contentURL?: string;
}

export type AptyFetchFailure =
  | "not_published"
  | `http_${number}`
  | "network"
  | "timeout"
  | "schema_mismatch"
  | "host_not_allowed"
  | "ids_missing"
  | "body_denied"
  | "too_large"
  | "unparsable"
  | "unknown_file";

export type AptyContextFailure =
  | "ids_missing"
  | "host_not_allowed"
  | "no_apty"
  | "no_environment_match"
  | AptyFetchFailure;

export interface AptyFileExtra {
  userId?: string;
  workflowId?: string;
  chatId?: string;
}

export type AptyContextResult =
  | { ok: true; context: AptyContentContext }
  | { ok: false; failure: AptyContextFailure; detail: string };

export type AptyFileResult =
  | {
      ok: true;
      file: string;
      /** The path under the content URL, without the query. */
      path: string;
      httpStatus: number;
      /** The body after the deny list and redaction. */
      text: string;
      json: unknown;
      fetchedAt: number;
      /** "Published now": what the host serves at `fetchedAt`, not proof of what the Client loaded. */
      fromCache: boolean;
    }
  | {
      ok: false;
      file: string;
      path?: string;
      failure: AptyFetchFailure;
      httpStatus?: number;
      detail: string;
    };

/** The Agent's own reader of Apty's published content, shared by the check packs and the model's tools. */
export interface AptyContentSource {
  resolveContext(input?: AptyContextInput): Promise<AptyContextResult>;
  /** The catalogue of files the player can request for this version. */
  listFiles(version: AptyVersion): readonly AptyFileSpec[];
  fetchFile(
    context: AptyContentContext,
    file: string,
    extra?: AptyFileExtra,
  ): Promise<AptyFileResult>;
}

export const httpFailure = (status: number): AptyFetchFailure =>
  status === 404 ? "not_published" : `http_${status}`;
