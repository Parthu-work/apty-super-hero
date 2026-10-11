/**
 * The fields of Chrome DevTools Protocol event params that the network and
 * runtime capture read (`Network.*`, `Log.entryAdded`,
 * `Runtime.exceptionThrown`). Fields are optional because the payload comes
 * from the page's debugger session and is untrusted, except `requestId`
 * and `request`, which the `Network.*` events that read them always carry.
 */
export interface CdpEventParams {
  requestId: string;
  type?: string;
  errorText?: string;
  encodedDataLength?: number;
  initiator?: { type?: string };
  request: {
    url: string;
    method: string;
    headers?: Record<string, string>;
  };
  response?: {
    status?: number;
    statusText?: string;
    mimeType?: string;
    headers?: Record<string, string>;
  };
  entry?: { level?: string; source?: string; text?: string };
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
    stackTrace?: unknown;
  };
}
