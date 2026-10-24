import { loopbackWsUrl } from "./ws-url.js";

const DEFAULT_WS_URL = "ws://localhost:9223/cli";
const DEFAULT_CONNECT_TIMEOUT = "60000";

type Env = Readonly<Record<string, string | undefined>>;

export interface CliEnv {
  wsUrl: string;
  connectTimeoutMs: number;
}

/** `name`'s value, else that of the deprecated `legacyName` it replaced, with one line on stderr saying so. */
function read(
  env: Env,
  name: string,
  legacyName: string,
  warn: (line: string) => void,
): string | undefined {
  if (env[name] !== undefined) return env[name];
  const legacy = env[legacyName];
  if (legacy !== undefined) {
    warn(`${legacyName} is deprecated; use ${name} instead.\n`);
  }
  return legacy;
}

/** The raw CLI's daemon URL (loopback only) and connect timeout. Throws on a URL that isn't loopback. */
export function readCliEnv(
  env: Env,
  warn: (line: string) => void = (line) => process.stderr.write(line),
): CliEnv {
  const wsUrl = read(env, "APTY_WS_URL", "AIPEX_WS_URL", warn);
  const timeout = read(
    env,
    "APTY_CONNECT_TIMEOUT",
    "AIPEX_CONNECT_TIMEOUT",
    warn,
  );
  return {
    wsUrl: loopbackWsUrl(wsUrl ?? DEFAULT_WS_URL),
    connectTimeoutMs: parseInt(timeout ?? DEFAULT_CONNECT_TIMEOUT, 10),
  };
}
