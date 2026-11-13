#!/usr/bin/env node
/**
 * Makes the KB owner's pack signing key (KB-RAG K23 P2, D-SEC9): an ECDSA
 * P-256 key pair. The private key is written as PKCS#8 PEM, mode 600,
 * outside this repository (a path inside it is refused), and never printed;
 * the public key is printed and written as base64 SPKI with its keyId,
 * ready for the built-in trusted keys or a policy's trustedPackKeys.
 *
 * Usage: pnpm kb:keygen --out <directory> [--name <key name>]
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keyIdOf } from "./build-kb-pack.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function insideRepository(path) {
  const rel = relative(REPO_ROOT, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function parseArgs(argv) {
  const options = { name: "Apty KB owner" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === "--out" || flag === "--name") && value !== undefined) {
      options[flag.slice(2)] = value;
      i++;
    } else {
      throw new Error(`Unknown or incomplete option: ${flag}`);
    }
  }
  if (!options.out) throw new Error("Pass --out <directory>.");
  return options;
}

/** The CLI, with its output injected for tests. Returns the exit code. */
export function run({
  argv,
  cwd = process.cwd(),
  out = (line) => console.log(line),
  err = (line) => console.error(line),
}) {
  try {
    const options = parseArgs(argv);
    const dir = resolve(cwd, options.out);
    if (insideRepository(dir)) {
      throw new Error(
        "The private key never goes in this repository: pass a directory outside it (for example ~/apty-kb-signing-key).",
      );
    }
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const keyId = keyIdOf(publicKey);
    const spki = publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const privatePath = join(dir, `kb-signing-key-${keyId}.pem`);
    const publicPath = join(dir, `kb-signing-key-${keyId}.public.json`);
    try {
      writeFileSync(
        privatePath,
        privateKey.export({ type: "pkcs8", format: "pem" }),
        { mode: 0o600, flag: "wx" },
      );
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error(`${privatePath} exists; it is not overwritten.`);
      }
      throw error;
    }
    const entry = { keyId, spki, name: options.name };
    writeFileSync(publicPath, `${JSON.stringify(entry, null, 2)}\n`);
    out(
      `Private key: ${privatePath} (mode 600). Keep it off shared drives and out of CI; build with --sign-key ${privatePath}.`,
    );
    out(`Public key: ${publicPath}`);
    out(`keyId: ${keyId}`);
    out(`spki: ${spki}`);
    out(
      "Send the public key (keyId, spki and name) to the extension's maintainers for the built-in list, or to IT for the policy's trustedPackKeys.",
    );
    return 0;
  } catch (error) {
    err(error.message);
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = run({ argv: process.argv.slice(2) });
}
