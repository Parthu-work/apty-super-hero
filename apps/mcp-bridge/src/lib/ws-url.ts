/**
 * The CLIs send the daemon token in the WebSocket handshake, so a URL taken
 * from the environment may only point at this machine.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function loopbackWsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Not a WebSocket URL: ${value}`);
  }
  if (url.protocol !== "ws:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      "The daemon URL must be ws://127.0.0.1 or ws://localhost; the token is never sent anywhere else.",
    );
  }
  return value;
}
