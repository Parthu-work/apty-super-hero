/**
 * KB-RAG K28 A1: the policy generator and checker, on synthetic values only.
 * Every generated format must read back to the policy it was made from, and
 * the checker must judge a policy with the extension's own parseOrgPolicy.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadAgentCore } from "../kb/eval-kb.mjs";
import { run as check, readPolicyFile } from "./check-policy.mjs";
import { run as generate, renderPolicyFiles } from "./generate-policy.mjs";

const CONFIG_PATH = new URL("./fixtures/example-config.json", import.meta.url);
const CONFIG = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const EXPECTED = new URL("./fixtures/expected/", import.meta.url);
const ID = CONFIG.extension.id;
const FORCELIST_ENTRY = `${ID};${CONFIG.extension.updateUrl}`;

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "apty-policy-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const capture = () => {
  const lines = [];
  return { lines, write: (line) => lines.push(String(line)) };
};

const withPolicy = (policy) => ({ ...CONFIG, policy });

describe("generate-policy", () => {
  const files = renderPolicyFiles(CONFIG);

  it("writes a .reg, a .mobileconfig for Chrome and Edge, and the Linux JSON", () => {
    assert.deepEqual(files.map((file) => file.path).sort(), [
      "linux/apty-agent.json",
      "macos/chrome.mobileconfig",
      "macos/edge.mobileconfig",
      "windows/chrome.reg",
      "windows/edge.reg",
    ]);
  });

  it("every generated format reads back to the same policy and force-install entry", async () => {
    const core = await loadAgentCore();
    const expected = core.parseOrgPolicy(CONFIG.policy);
    assert.equal(expected.ok, true);
    for (const file of files) {
      const read = readPolicyFile(file.path, file.content);
      assert.deepEqual(read.policy, CONFIG.policy, file.path);
      assert.equal(read.extensionId, ID, file.path);
      assert.deepEqual(read.forcelist, [FORCELIST_ENTRY], file.path);
      assert.deepEqual(core.parseOrgPolicy(read.policy), expected, file.path);
    }
  });

  it("matches the stored snapshots of the three formats", () => {
    for (const file of files) {
      const snapshot = readFileSync(new URL(file.path, EXPECTED), "utf8");
      if (file.path.endsWith(".json")) {
        assert.deepEqual(JSON.parse(file.content), JSON.parse(snapshot));
      } else {
        assert.equal(file.content, snapshot, file.path);
      }
    }
  });

  it("uses each browser's registry path and preference domain", () => {
    const text = (path) => files.find((file) => file.path === path).content;
    assert.match(
      text("windows/chrome.reg"),
      new RegExp(
        `\\[HKEY_LOCAL_MACHINE\\\\Software\\\\Policies\\\\Google\\\\Chrome\\\\3rdparty\\\\extensions\\\\${ID}\\\\policy\\]`,
      ),
    );
    assert.match(
      text("windows/edge.reg"),
      /\[HKEY_LOCAL_MACHINE\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist\]/,
    );
    assert.match(
      text("macos/chrome.mobileconfig"),
      new RegExp(`<string>com.google.Chrome.extensions.${ID}</string>`),
    );
    assert.match(
      text("macos/edge.mobileconfig"),
      new RegExp(`<string>com.microsoft.Edge.extensions.${ID}</string>`),
    );
  });

  it("writes the files, the .reg as UTF-16LE with a byte order mark", async () => {
    const out = capture();
    const code = await generate({
      argv: ["--config", CONFIG_PATH.pathname, "--out", join(dir, "gen")],
      out: out.write,
      err: out.write,
    });
    assert.equal(code, 0, out.lines.join("\n"));
    const reg = readFileSync(join(dir, "gen/windows/chrome.reg"));
    assert.deepEqual([...reg.subarray(0, 2)], [0xff, 0xfe]);
    assert.equal(
      reg.subarray(2).toString("utf16le"),
      files.find((file) => file.path === "windows/chrome.reg").content,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, "gen/linux/apty-agent.json"), "utf8")),
      JSON.parse(readFileSync(new URL("linux/apty-agent.json", EXPECTED))),
    );
    assert.match(out.lines.join("\n"), /\/etc\/opt\/chrome\/policies\/managed/);
  });

  it("refuses a policy the extension would not accept, a bad extension id and a non-https update URL", async () => {
    const cases = [
      [
        withPolicy({ ...CONFIG.policy, colour: "blue" }),
        /"colour" is not a policy key/,
      ],
      [
        { ...CONFIG, extension: { ...CONFIG.extension, id: "not-an-id" } },
        /extension\.id/,
      ],
      [
        {
          ...CONFIG,
          extension: {
            ...CONFIG.extension,
            updateUrl: "http://example.invalid/u",
          },
        },
        /updateUrl must be https/,
      ],
    ];
    for (const [config, message] of cases) {
      const path = join(dir, "bad-config.json");
      writeFileSync(path, JSON.stringify(config));
      const out = capture();
      const code = await generate({
        argv: ["--config", path, "--out", join(dir, "bad")],
        out: out.write,
        err: out.write,
      });
      assert.equal(code, 1);
      assert.match(out.lines.join("\n"), message);
    }
  });
});

describe("check-policy", () => {
  const checkFile = async (name, content) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    const out = capture();
    const code = await check({ argv: [path], out: out.write, err: out.write });
    return { code, text: out.lines.join("\n") };
  };

  it("accepts every generated file and prints each key with its effect", async () => {
    for (const file of renderPolicyFiles(CONFIG)) {
      const { code, text } = await checkFile(
        file.path.replaceAll("/", "-"),
        file.content,
      );
      assert.equal(code, 0, `${file.path}: ${text}`);
      for (const key of Object.keys(CONFIG.policy)) {
        assert.match(text, new RegExp(`^- ${key}: `, "m"), key);
      }
      assert.match(text, /KB text to the AI model/);
      assert.match(text, new RegExp(`Force-installed: ${ID}`));
    }
  });

  it("fails an unknown key, a non-https source and a malformed key id with the parser's reason", async () => {
    const cases = [
      [
        { ...CONFIG.policy, kbToCloud: true },
        /"kbToCloud" is not a policy key/,
      ],
      [
        {
          ...CONFIG.policy,
          kbPackSources: { "5.x": "http://packs.example.invalid/5x.json" },
        },
        /kbPackSources\.5\.x is not https/,
      ],
      [
        {
          ...CONFIG.policy,
          trustedPackKeys: [
            { ...CONFIG.policy.trustedPackKeys[0], keyId: "XYZ" },
          ],
        },
        /trustedPackKeys: keyId must be 16 hex characters/,
      ],
    ];
    for (const [policy, reason] of cases) {
      const { code, text } = await checkFile(
        "bad.json",
        JSON.stringify(policy),
      );
      assert.equal(code, 1);
      assert.match(text, /^Invalid policy: /m);
      assert.match(text, reason);
      const reg = renderPolicyFiles(withPolicy(policy)).find(
        (file) => file.path === "windows/chrome.reg",
      );
      const fromReg = await checkFile("bad.reg", reg.content);
      assert.equal(fromReg.code, 1);
      assert.match(fromReg.text, reason);
    }
  });

  it("warns that preset.aiToken shows in chrome://policy, and never prints the token", async () => {
    const token = "sk-synthetic-0123456789";
    const { code, text } = await checkFile(
      "token.json",
      JSON.stringify({ preset: { aiProvider: "openai", aiToken: token } }),
    );
    assert.equal(code, 0);
    assert.match(
      text,
      /preset\.aiToken is visible to the user in chrome:\/\/policy/,
    );
    assert.equal(text.includes(token), false);
  });

  it("reads a policy with a quote and a backslash through the .reg encoding", () => {
    const policy = { allowedModels: ['model "a"', "path\\b"] };
    const reg = renderPolicyFiles(withPolicy(policy)).find(
      (file) => file.path === "windows/edge.reg",
    );
    assert.deepEqual(readPolicyFile("edge.reg", reg.content).policy, policy);
  });

  it("names a file it cannot read", async () => {
    const { code, text } = await checkFile("broken.json", "{ not json");
    assert.equal(code, 1);
    assert.match(text, /not valid JSON/);
  });
});
