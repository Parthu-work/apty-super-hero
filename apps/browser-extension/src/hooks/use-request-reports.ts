import type { RequestReport } from "@apty/agent-core";
import {
  readRequestReports,
  watchRequestReports,
} from "@apty/browser-runtime/runtime/request-reports";
import { useEffect, useState } from "react";

/** The last requests sent to the AI provider, kept current while the page is open. */
export function useRequestReports(): RequestReport[] {
  const [reports, setReports] = useState<RequestReport[]>([]);
  useEffect(() => {
    let active = true;
    void readRequestReports().then((stored) => {
      if (active) setReports(stored);
    });
    const stop = watchRequestReports(setReports);
    return () => {
      active = false;
      stop();
    };
  }, []);
  return reports;
}
