import type { EffectiveSettings } from "@apty/agent-core";
import {
  loadEffectiveSettings,
  watchEffectiveSettings,
} from "@apty/browser-runtime/runtime/effective-settings";
import type { OrgPolicyView } from "@apty/ui";
import { useEffect, useState } from "react";

/** What Options shows of the policy (KB-RAG K22): the effective settings, the locked fields and an invalid policy's reason. */
function orgPolicyView(effective: EffectiveSettings): OrgPolicyView {
  return {
    settings: effective.settings,
    locked: effective.locked,
    ...(effective.policy.kind === "invalid"
      ? { invalidReason: effective.policy.reason }
      : {}),
    ...(effective.redactionFloor
      ? { redactionFloor: effective.redactionFloor }
      : {}),
  };
}

/** The policy view, kept current as the settings, the policy or the packs change. */
export function useOrgPolicyView(): OrgPolicyView | undefined {
  const [view, setView] = useState<OrgPolicyView>();
  useEffect(() => {
    let live = true;
    void loadEffectiveSettings()
      .then((effective) => {
        if (live) setView(orgPolicyView(effective));
      })
      .catch(() => undefined);
    const stop = watchEffectiveSettings((effective) =>
      setView(orgPolicyView(effective)),
    );
    return () => {
      live = false;
      stop();
    };
  }, []);
  return view;
}
