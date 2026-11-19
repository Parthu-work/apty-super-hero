#!/usr/bin/env node
/**
 * Checks an organization policy file with the extension's own
 * `parseOrgPolicy` (from @apty/agent-core's build) and prints each key and
 * its effect, from the extension's managed-storage schema. It reads a policy
 * JSON (bare, or Chrome's Linux managed-policy file), a Windows .reg or a
 * macOS .mobileconfig, as `policy:generate` writes them.
 *
 * A token in `preset.aiToken` is never printed.
 *
 * Usage: pnpm policy:check <file>
 * Exits 1 when the policy is invalid or cannot be read, 2 on a usage error.
 */
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentCore } from "../kb/eval-kb.mjs";

const SCHEMA = JSON.parse(
  readFileSync(
    new URL(
      "../../../apps/browser-extension/managed-schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const EXTENSION_POLICY_KEY = /\\3rdparty\\extensions\\([a-p]{32})\\policy$/i;
const EXTENSION_DOMAIN = /\.extensions\.([a-p]{32})$/;
const FORCELIST = "ExtensionInstallForcelist";

const byIndex = (a, b) => Number(a) - Number(b);

function regValue(raw) {
  if (raw.startsWith('"')) {
    const match = /^"((?:[^"\\]|\\.)*)"$/.exec(raw);
    if (!match) throw new Error(`A .reg value is not a string: ${raw}`);
    return match[1].replace(/\\(.)/g, "$1");
  }
  const dword = /^dword:([0-9a-f]{8})$/i.exec(raw);
  if (!dword) throw new Error("A .reg value is neither a string nor a dword.");
  return Number.parseInt(dword[1], 16);
}

/** The .reg file as a map of key path to its named values. */
function readRegKeys(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "Windows Registry Editor Version 5.00") {
    throw new Error("Not a .reg file (no version 5.00 header).");
  }
  const keys = new Map();
  let current;
  for (const line of lines.slice(1)) {
    if (!line.trim() || line.startsWith(";")) continue;
    const section = /^\[(-?)(.+)\]$/.exec(line.trim());
    if (section) {
      current = section[1] ? undefined : section[2];
      if (current && !keys.has(current)) keys.set(current, new Map());
      continue;
    }
    const value = /^"((?:[^"\\]|\\.)*)"=(.*)$/.exec(line.trim());
    if (!value || !current) throw new Error(`Unreadable .reg line: ${line}`);
    keys.get(current).set(value[1].replace(/\\(.)/g, "$1"), regValue(value[2]));
  }
  return keys;
}

function fromRegValue(value, schema) {
  return typeof value === "number" && schema?.type === "boolean"
    ? value !== 0
    : value;
}

function regNode(keys, path, schema) {
  const prefix = `${path}\\`;
  const entries = [...(keys.get(path) ?? new Map())].map(([name, value]) => [
    name,
    (itemSchema) => fromRegValue(value, itemSchema),
  ]);
  for (const child of keys.keys()) {
    if (
      child.startsWith(prefix) &&
      !child.slice(prefix.length).includes("\\")
    ) {
      entries.push([
        child.slice(prefix.length),
        (itemSchema) => regNode(keys, child, itemSchema),
      ]);
    }
  }
  const isList =
    schema?.type === "array" ||
    (!schema && entries.length > 0 && entries.every(([n]) => /^\d+$/.test(n)));
  if (isList) {
    return entries
      .sort(([a], [b]) => byIndex(a, b))
      .map(([, read]) => read(schema?.items));
  }
  return Object.fromEntries(
    entries.map(([name, read]) => [name, read(schema?.properties?.[name])]),
  );
}

export function decodeReg(text) {
  const keys = readRegKeys(text);
  const roots = [...keys.keys()].filter((path) =>
    EXTENSION_POLICY_KEY.test(path),
  );
  if (roots.length !== 1) {
    throw new Error(
      `The .reg file must hold one extension policy key; it holds ${roots.length}.`,
    );
  }
  const forcelistKey = [...keys.keys()].find((path) =>
    path.endsWith(`\\${FORCELIST}`),
  );
  return {
    extensionId: EXTENSION_POLICY_KEY.exec(roots[0])[1],
    policy: regNode(keys, roots[0], SCHEMA),
    forcelist: forcelistKey
      ? [...keys.get(forcelistKey)]
          .sort(([a], [b]) => byIndex(a, b))
          .map(([, value]) => value)
      : undefined,
  };
}

const unxml = (text) =>
  text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/** A property list's XML as a value: dict, array, string, integer, true and false. */
export function parsePlist(text) {
  const body = /<plist[^>]*>([\s\S]*)<\/plist>/.exec(text);
  if (!body) throw new Error("Not a property list.");
  const tokens = [...body[1].matchAll(/<(\/?)(\w+)(\/?)>|([^<]+)/g)].filter(
    (token) => token[4] === undefined || token[4].trim(),
  );
  let at = 0;
  const textOf = (tag) => {
    const content = tokens[at]?.[4] !== undefined ? tokens[at++][4] : "";
    if (tokens[at]?.[1] !== "/" || tokens[at][2] !== tag) {
      throw new Error(`The property list's <${tag}> is not closed.`);
    }
    at++;
    return unxml(content);
  };
  const value = () => {
    const [, , tag, selfClosing] = tokens[at++] ?? [];
    if (selfClosing) {
      if (tag === "true" || tag === "false") return tag === "true";
      if (tag === "array") return [];
      if (tag === "dict") return {};
      throw new Error(`Unexpected <${tag}/> in the property list.`);
    }
    if (tag === "string") return textOf("string");
    if (tag === "integer") return Number.parseInt(textOf("integer"), 10);
    if (tag === "array") {
      const list = [];
      while (tokens[at] && tokens[at][1] !== "/") list.push(value());
      at++;
      return list;
    }
    if (tag === "dict") {
      const dict = {};
      while (tokens[at] && tokens[at][1] !== "/") {
        if (tokens[at++][2] !== "key") {
          throw new Error("A property list dict entry has no <key>.");
        }
        const key = textOf("key");
        dict[key] = value();
      }
      at++;
      return dict;
    }
    throw new Error(`Unexpected <${tag}> in the property list.`);
  };
  return value();
}

export function decodeMobileconfig(text) {
  const profile = parsePlist(text);
  const payloads = Array.isArray(profile?.PayloadContent)
    ? profile.PayloadContent
    : [profile];
  const extensions = payloads.filter((item) =>
    EXTENSION_DOMAIN.test(item?.PayloadType ?? ""),
  );
  if (extensions.length !== 1) {
    throw new Error(
      `The profile must hold one extension policy payload; it holds ${extensions.length}.`,
    );
  }
  const policy = Object.fromEntries(
    Object.entries(extensions[0]).filter(([key]) => !key.startsWith("Payload")),
  );
  return {
    extensionId: EXTENSION_DOMAIN.exec(extensions[0].PayloadType)[1],
    policy,
    forcelist: payloads.find((item) => Array.isArray(item?.[FORCELIST]))?.[
      FORCELIST
    ],
  };
}

export function decodeJson(text) {
  const json = JSON.parse(text);
  const extensions = json?.["3rdparty"]?.extensions;
  if (!extensions) return { policy: json };
  const ids = Object.keys(extensions);
  if (ids.length !== 1) {
    throw new Error(
      `The file must hold one extension's policy under 3rdparty.extensions; it holds ${ids.length}.`,
    );
  }
  return {
    extensionId: ids[0],
    policy: extensions[ids[0]],
    forcelist: json[FORCELIST],
  };
}

/** A policy file's policy, its extension id and force-install entries, by its extension. */
export function readPolicyFile(name, content) {
  const text = Buffer.isBuffer(content)
    ? content[0] === 0xff && content[1] === 0xfe
      ? content.subarray(2).toString("utf16le")
      : content.toString("utf8")
    : content;
  const kind = extname(name).toLowerCase();
  if (kind === ".reg") return decodeReg(text);
  if (kind === ".mobileconfig" || kind === ".plist") {
    return decodeMobileconfig(text);
  }
  return decodeJson(text);
}

const shown = (key, value) =>
  key === "preset" && value.aiToken !== undefined
    ? { ...value, aiToken: "(set, not shown)" }
    : value;

/** Each key with its value and what it does, from the managed-storage schema. */
export function describePolicy(policy) {
  return Object.entries(policy).map(([key, value]) => {
    const property = SCHEMA.properties[key] ?? {};
    return `- ${key}: ${JSON.stringify(shown(key, value))}. ${property.title ?? key}: ${property.description ?? ""}`.trimEnd();
  });
}

export async function run({
  argv,
  cwd = process.cwd(),
  out = (line) => console.log(line),
  err = (line) => console.error(line),
}) {
  if (argv.length !== 1 || argv[0].startsWith("--")) {
    err("Usage: pnpm policy:check <file>");
    return 2;
  }
  let read;
  try {
    read = readPolicyFile(argv[0], readFileSync(resolve(cwd, argv[0])));
  } catch (error) {
    err(
      `Cannot read ${argv[0]}: ${error instanceof SyntaxError ? "not valid JSON" : error.message}`,
    );
    return 1;
  }
  const core = await loadAgentCore();
  const parsed = core.parseOrgPolicy(read.policy);
  if (!parsed.ok) {
    out(`Invalid policy: ${parsed.reason}`);
    out(
      "The extension would make no AI request, withhold KB text, keep the MCP bridge off and use Strict redaction.",
    );
    return 1;
  }
  out(
    `Valid policy${read.extensionId ? ` for extension ${read.extensionId}` : ""}, ${Object.keys(read.policy).length} keys:`,
  );
  for (const line of describePolicy(read.policy)) out(line);
  for (const entry of read.forcelist ?? []) {
    const [id, url] = String(entry).split(";");
    out(`Force-installed: ${id}${url ? ` from ${url}` : ""}`);
  }
  if (read.policy.preset?.aiToken !== undefined) {
    out(
      "Warning: preset.aiToken is visible to the user in chrome://policy. Prefer an organization gateway (docs/security/ORG_POLICY.md).",
    );
  }
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
