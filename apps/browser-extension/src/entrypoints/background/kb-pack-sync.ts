/**
 * When the KB pack fetcher runs (KB-RAG K26, D3, D-DEL7): 30 seconds after
 * the browser starts or the extension is installed, on the `kb-pack-sync`
 * alarm every `kbPackCheckHours`, and on Check now. With no policy source
 * there is no alarm and no request.
 */
import {
  type KbPackSync,
  type KbSyncResult,
  kbPackCheckHours,
  kbPackSources,
  type OrgPolicyState,
} from "@apty/agent-core";
import {
  loadOrgPolicy,
  watchOrgPolicy,
} from "@apty/browser-runtime/runtime/org-policy";
import { isOwnExtensionPage } from "@apty/browser-runtime/runtime/trusted-sender";
import { KB_PACK_SYNC_NOW, kbPackSync } from "../../services/kb-pack-sync";

export const KB_PACK_SYNC_ALARM = "kb-pack-sync";
export const KB_PACK_STARTUP_DELAY_MS = 30_000;

export interface KbPackSyncDeps {
  chromeApi: Pick<typeof chrome, "alarms" | "runtime">;
  sync: () => KbPackSync;
  policy: () => Promise<OrgPolicyState>;
  watchPolicy: (onChange: (state: OrgPolicyState) => void) => () => void;
  delay: (run: () => void, ms: number) => void;
}

const hasSources = (state: OrgPolicyState) =>
  Object.keys(kbPackSources(state)).length > 0;

/** The alarm as the policy wants it: none without a source, else every `kbPackCheckHours`. */
export async function scheduleKbPackSync(
  deps: Pick<KbPackSyncDeps, "chromeApi">,
  state: OrgPolicyState,
): Promise<void> {
  const { alarms } = deps.chromeApi;
  if (!hasSources(state)) {
    await alarms.clear(KB_PACK_SYNC_ALARM);
    return;
  }
  const periodInMinutes = kbPackCheckHours(state) * 60;
  const existing = await alarms.get(KB_PACK_SYNC_ALARM);
  if (existing?.periodInMinutes === periodInMinutes) return;
  await alarms.create(KB_PACK_SYNC_ALARM, {
    delayInMinutes: periodInMinutes,
    periodInMinutes,
  });
}

const browserDeps = (): KbPackSyncDeps => ({
  chromeApi: chrome,
  sync: kbPackSync,
  policy: loadOrgPolicy,
  watchPolicy: watchOrgPolicy,
  delay: (run, ms) => {
    setTimeout(run, ms);
  },
});

/** Registers the start-up run, the alarm, the policy watch and Check now. */
export function registerKbPackSync(deps: KbPackSyncDeps = browserDeps()): void {
  const { chromeApi } = deps;
  const runIfSourced = async (reason: "startup" | "alarm") => {
    if (!hasSources(await deps.policy())) return;
    await deps.sync().syncAll({ reason });
  };
  const atStartup = () =>
    deps.delay(() => {
      void runIfSourced("startup").catch(() => undefined);
    }, KB_PACK_STARTUP_DELAY_MS);

  chromeApi.runtime.onStartup.addListener(atStartup);
  chromeApi.runtime.onInstalled.addListener(atStartup);
  chromeApi.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== KB_PACK_SYNC_ALARM) return;
    void runIfSourced("alarm").catch(() => undefined);
  });
  void deps
    .policy()
    .then((state) => scheduleKbPackSync(deps, state))
    .catch(() => undefined);
  deps.watchPolicy((state) => {
    void scheduleKbPackSync(deps, state).catch(() => undefined);
  });

  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.request !== KB_PACK_SYNC_NOW) return false;
    if (!isOwnExtensionPage(sender)) {
      sendResponse({ ok: false, error: "Unauthorized sender" });
      return false;
    }
    deps
      .sync()
      .syncAll({ reason: "manual" })
      .then((results: KbSyncResult[]) => sendResponse({ ok: true, results }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.name : "Error",
        }),
      );
    return true;
  });
}
