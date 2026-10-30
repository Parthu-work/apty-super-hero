/**
 * What the logs pack reads: the Apty Client's calls and its service-worker
 * logs over the same connection as the content checks, and the page's
 * console through a reader the caller supplies (the tools layer owns the
 * page-world bridge). Lines are redacted where they are read; calls keep
 * only their file name and host, never a URL.
 */
import { getRedactionMode } from "../../runtime/redaction-mode.js";
import { resourceNameFor } from "../resource-body-utils.js";
import { ConfiguredServiceWorkerDiagnosticsProvider } from "../service-worker-diagnostics.js";
import { connectionFailure } from "./loader.js";
import type { LogEvidence } from "./types.js";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export async function loadLogEvidence(
  extensionId: string | undefined,
  pageConsole: () => Promise<LogEvidence["page"]>,
): Promise<LogEvidence> {
  await getRedactionMode();
  const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
    extensionId,
    peer: "client",
  });
  const list = await provider.listResources();
  if (!list.ok) {
    return {
      connection: connectionFailure(list).connection,
      clientLogs: { ok: false, failure: "unreachable", message: "" },
      calls: [],
    };
  }
  const logs = await provider.readLogs();
  return {
    connection: { ok: true },
    clientLogs: logs.ok
      ? {
          ok: true,
          lines: logs.logs.map(({ level, message }) => ({ level, message })),
        }
      : {
          ok: false,
          failure: logs.failure ?? "no_response",
          message:
            logs.error ?? "The Apty Client did not answer the logs request.",
        },
    calls: list.resources.map((r) => ({
      name: resourceNameFor(r.url),
      host: hostOf(r.url),
      ...(r.status !== undefined ? { status: r.status } : {}),
      ...(r.failed ? { failed: true, errorText: r.errorText } : {}),
    })),
    page: await pageConsole(),
  };
}
