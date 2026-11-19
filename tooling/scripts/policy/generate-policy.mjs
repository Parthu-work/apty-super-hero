#!/usr/bin/env node
/**
 * Writes the extension's organization policy (docs/security/ORG_POLICY.md)
 * for Chrome and Edge from one small JSON config: a Windows .reg, a macOS
 * .mobileconfig per browser, and the Linux managed-policy JSON. Each also
 * force-installs the extension (ExtensionInstallForcelist).
 *
 * The config is `{ "extension": { "id", "updateUrl" }, "policy": { ... } }`;
 * the policy must pass the extension's own `parseOrgPolicy` first.
 *
 * Usage: pnpm policy:generate --config <file> --out <dir>
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentCore } from "../kb/eval-kb.mjs";

const EXTENSION_ID = /^[a-p]{32}$/;

export const BROWSERS = {
  chrome: {
    registry: "Software\\Policies\\Google\\Chrome",
    domain: "com.google.Chrome",
    name: "Google Chrome",
  },
  edge: {
    registry: "Software\\Policies\\Microsoft\\Edge",
    domain: "com.microsoft.Edge",
    name: "Microsoft Edge",
  },
};

export const LINUX_POLICY_DIRS = {
  chrome: "/etc/opt/chrome/policies/managed/",
  chromium: "/etc/chromium/policies/managed/",
  edge: "/etc/opt/edge/policies/managed/",
};

export const policyKeyPath = (browser, id) =>
  `HKEY_LOCAL_MACHINE\\${BROWSERS[browser].registry}\\3rdparty\\extensions\\${id}\\policy`;
export const forcelistKeyPath = (browser) =>
  `HKEY_LOCAL_MACHINE\\${BROWSERS[browser].registry}\\ExtensionInstallForcelist`;
export const extensionDomain = (browser, id) =>
  `${BROWSERS[browser].domain}.extensions.${id}`;

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function regString(value) {
  if (/[\r\n\0]/.test(value)) {
    throw new Error("A policy string may not hold a line break.");
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

const regScalar = (value) =>
  typeof value === "string"
    ? regString(value)
    : `dword:${(typeof value === "boolean" ? Number(value) : value)
        .toString(16)
        .padStart(8, "0")}`;

function regKeys(path, object) {
  const values = [];
  const children = [];
  const entries = Array.isArray(object)
    ? object.map((value, i) => [String(i + 1), value])
    : Object.entries(object);
  for (const [name, value] of entries) {
    if (Array.isArray(value) || isPlainObject(value)) {
      children.push(...regKeys(`${path}\\${name}`, value));
    } else {
      values.push(`${regString(name)}=${regScalar(value)}`);
    }
  }
  return [{ path, values }, ...children];
}

/** The .reg text (without its byte order mark): the policy key is replaced whole, so a removed key does not linger. */
export function renderReg(browser, { extension, policy }) {
  const lines = ["Windows Registry Editor Version 5.00", ""];
  const policyPath = policyKeyPath(browser, extension.id);
  lines.push(`[-${policyPath}]`, "");
  for (const key of regKeys(policyPath, policy)) {
    lines.push(`[${key.path}]`, ...key.values, "");
  }
  lines.push(
    `[${forcelistKeyPath(browser)}]`,
    `"1"=${regString(`${extension.id};${extension.updateUrl}`)}`,
    "",
  );
  return lines.join("\r\n");
}

const xml = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function plistValue(value, indent) {
  const pad = "\t".repeat(indent);
  if (typeof value === "string")
    return [`${pad}<string>${xml(value)}</string>`];
  if (typeof value === "boolean") return [`${pad}<${value}/>`];
  if (typeof value === "number") return [`${pad}<integer>${value}</integer>`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}<array/>`];
    return [
      `${pad}<array>`,
      ...value.flatMap((item) => plistValue(item, indent + 1)),
      `${pad}</array>`,
    ];
  }
  return [
    `${pad}<dict>`,
    ...Object.entries(value).flatMap(([key, item]) => [
      `${pad}\t<key>${xml(key)}</key>`,
      ...plistValue(item, indent + 1),
    ]),
    `${pad}</dict>`,
  ];
}

/** A UUID derived from the payload, so the same config gives the same profile. */
function stableUuid(seed) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ]
    .join("-")
    .toUpperCase();
}

function payload(type, identifier, settings) {
  return {
    PayloadType: type,
    PayloadIdentifier: identifier,
    PayloadUUID: stableUuid(identifier),
    PayloadVersion: 1,
    PayloadDisplayName: type,
    ...settings,
  };
}

export function renderMobileconfig(browser, { extension, policy }) {
  const base = `com.apty.agent.policy.${browser}`;
  const profile = {
    PayloadContent: [
      payload(
        extensionDomain(browser, extension.id),
        `${base}.extension`,
        policy,
      ),
      payload(BROWSERS[browser].domain, `${base}.forcelist`, {
        ExtensionInstallForcelist: [`${extension.id};${extension.updateUrl}`],
      }),
    ],
    PayloadDisplayName: `Apty Agent policy (${BROWSERS[browser].name})`,
    PayloadIdentifier: base,
    PayloadScope: "System",
    PayloadType: "Configuration",
    PayloadUUID: stableUuid(base),
    PayloadVersion: 1,
  };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    ...plistValue(profile, 0),
    "</plist>",
    "",
  ].join("\n");
}

export const renderLinuxJson = ({ extension, policy }) =>
  `${JSON.stringify(
    {
      ExtensionInstallForcelist: [`${extension.id};${extension.updateUrl}`],
      "3rdparty": { extensions: { [extension.id]: policy } },
    },
    null,
    2,
  )}\n`;

function checkExtension(extension) {
  if (!isPlainObject(extension)) {
    throw new Error('The config needs "extension": { "id", "updateUrl" }.');
  }
  if (typeof extension.id !== "string" || !EXTENSION_ID.test(extension.id)) {
    throw new Error("extension.id must be 32 letters a to p.");
  }
  let url;
  try {
    url = new URL(extension.updateUrl);
  } catch {
    throw new Error("extension.updateUrl must be a URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("extension.updateUrl must be https.");
  }
  if (/[;\s]/.test(extension.updateUrl)) {
    throw new Error("extension.updateUrl may not hold a ; or a space.");
  }
}

/**
 * Every file for the config, as `{ path, content }` text. The .reg content
 * has no byte order mark; `run` writes it as UTF-16LE with one.
 */
export function renderPolicyFiles(config) {
  if (!isPlainObject(config) || !isPlainObject(config.policy)) {
    throw new Error('The config needs a "policy" object.');
  }
  checkExtension(config.extension);
  return [
    ...Object.keys(BROWSERS).flatMap((browser) => [
      { path: `windows/${browser}.reg`, content: renderReg(browser, config) },
      {
        path: `macos/${browser}.mobileconfig`,
        content: renderMobileconfig(browser, config),
      },
    ]),
    { path: "linux/apty-agent.json", content: renderLinuxJson(config) },
  ];
}

const encode = (file) =>
  file.path.endsWith(".reg")
    ? Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(file.content, "utf16le"),
      ])
    : file.content;

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--config" || argv[i] === "--out") && argv[i + 1]) {
      options[argv[i].slice(2)] = argv[++i];
    } else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  if (!options.config || !options.out) {
    throw new Error("Usage: pnpm policy:generate --config <file> --out <dir>");
  }
  return options;
}

export async function run({
  argv,
  cwd = process.cwd(),
  out = (line) => console.log(line),
  err = (line) => console.error(line),
}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    err(error.message);
    return 2;
  }
  try {
    const config = JSON.parse(
      readFileSync(resolve(cwd, options.config), "utf8"),
    );
    const core = await loadAgentCore();
    const parsed = core.parseOrgPolicy(config?.policy);
    if (!parsed.ok) throw new Error(`Invalid policy: ${parsed.reason}`);
    const files = renderPolicyFiles(config);
    const root = resolve(cwd, options.out);
    for (const file of files) {
      const target = join(root, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, encode(file));
      out(`Wrote ${target}`);
    }
    out("");
    out(
      "Windows: import windows/chrome.reg or windows/edge.reg as an administrator (or deploy the same keys by Group Policy).",
    );
    out(
      "macOS: install macos/chrome.mobileconfig or macos/edge.mobileconfig through your MDM.",
    );
    out(
      `Linux: copy linux/apty-agent.json to ${Object.values(LINUX_POLICY_DIRS).join(", ")} as needed.`,
    );
    out(
      "Each one also force-installs the extension (ExtensionInstallForcelist entry 1).",
    );
    return 0;
  } catch (error) {
    err(
      error instanceof SyntaxError
        ? "The config is not valid JSON."
        : error.message,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
