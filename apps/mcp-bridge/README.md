# apty-mcp-bridge

Local bridge, daemon, and CLI tools for connecting AI agents to the Apty Agent browser extension.

**This package is not published to npm** (`"private": true`) — there is nothing under this package's name for `npm install -g` or `npx` to fetch, and you should never run `npm install -g aipex-mcp-bridge` either: that is a different, unrelated package on the public registry, not this one. Run it from a local build instead (see below).

## How It Works

```
Cursor / Claude Code / VS Code ──stdio──▶ apty-mcp-bridge ──WS /bridge──┐
browser-cli / apty-cli         ──WS /cli────────────────────────────────┤
                                                                         ├── apty-mcp-daemon (:9223) ──WS /extension──▶ Apty Agent extension ──▶ Browser
                                                                         │
Other bridge clients            ──WS /bridge─────────────────────────────┘
```

The daemon is auto-spawned by the bridge or CLI when needed, shared by multiple clients, and exits after idle time. The Apty Agent extension connects to `ws://localhost:9223/extension`.

## Build

```bash
cd apps/mcp-bridge
pnpm build   # or: pnpm --filter apty-mcp-bridge build, from the repo root
```

This produces `dist/bridge.js`, `dist/daemon.js`, `dist/cli.js`, and `dist/browser-cli.js`.

Requirements:

- Node.js >= 18
- The Apty Agent Chrome or Edge extension installed and running (see the repo root `README.md`)

## Use with MCP Agents

**Cursor**, **Claude Desktop**, **Windsurf**, and other stdio MCP clients — point `command`/`args` at the built file directly (use an absolute path; replace `/path/to/apty-super-hero` with where you cloned this repo):


```json
{
  "mcpServers": {
    "apty-browser": {
      "command": "node",
      "args": ["/path/to/apty-super-hero/apps/mcp-bridge/dist/bridge.js"]
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add apty-browser -- node /path/to/apty-super-hero/apps/mcp-bridge/dist/bridge.js
```

Then open the Apty Agent extension's Options page and set the WebSocket URL to:

```text
ws://localhost:9223/extension
```

If you'd rather not repeat the absolute path everywhere, run `pnpm link --global` from inside `apps/mcp-bridge` (after building) to put `apty-mcp-bridge`/`apty-cli`/`browser-cli` on your `PATH`, then use the bin name directly as `command` instead of `node <path>`.

## Browser CLI

`browser-cli` is included in this package. It provides friendly command groups over the same local daemon used by MCP.

```bash
# from apps/mcp-bridge, after `pnpm build`
node dist/browser-cli.js status
node dist/browser-cli.js tab list
node dist/browser-cli.js tab new https://example.com
node dist/browser-cli.js page search "button*" --tab 123
node dist/browser-cli.js interact click btn-42 --tab 123
node dist/browser-cli.js page screenshot
```

(Or just `browser-cli ...` if you've linked it globally as above.)

Command groups:

- `tab` — list, open, close, switch, and inspect tabs
- `page` — search DOM snapshots, capture screenshots, inspect metadata, highlight elements
- `interact` — click, fill, hover, upload files, and use coordinate-based computer actions
- `download` — save images and chat images
- `intervention` — request or cancel human intervention during automation
- `skill` — list, inspect, load, and run skills

## Raw CLI

`apty-cli` remains available for direct tool calls:

```bash
node dist/cli.js --list
node dist/cli.js get_all_tabs
node dist/cli.js create_new_tab --url https://example.com
node dist/cli.js search_elements --tabId 123 --query "button*"
node dist/cli.js --json '{"name":"capture_screenshot","arguments":{}}'
```

## Why It Is Fast

- It controls your local browser directly through the extension instead of streaming a remote browser.
- It prefers structured DOM snapshots and stable element UIDs before falling back to screenshots.
- It preserves existing sessions, cookies, tabs, and extensions, so agents start from your real working context.
- It shares one daemon across MCP and CLI clients, avoiding repeated startup cost.

## Options

```bash
node dist/bridge.js [--port <port>] [--host <host>]
node dist/browser-cli.js [--port <port>] [--host <host>] <group> <command>
node dist/daemon.js [--port <port>] [--host <host>]
```

(Or `apty-mcp-bridge`/`browser-cli`/`apty-mcp-daemon` if linked globally.)

| Option | Default | Description |
| --- | --- | --- |
| `--port <port>` | `9223` | Local daemon port |
| `--host <host>` | `127.0.0.1` | Bind/connect host |
| `--help`, `-h` | | Show help |
| `--version`, `-v` | | Show version |

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `AIPEX_WS_URL` | `ws://localhost:9223/cli` | WebSocket URL for the raw CLI (`apty-cli`) — kept as-is from the upstream fork this fork's CLI protocol descends from; not a reference to the unrelated `aipex-mcp-bridge` npm package |
| `AIPEX_CONNECT_TIMEOUT` | `60000` | Max wait time for the raw CLI |
| `BROWSER_CLI_WS_URL` | `ws://127.0.0.1:9223/cli` | WebSocket URL for `browser-cli` |
| `BROWSER_CLI_CONNECT_TIMEOUT` | `60000` | Max wait time for `browser-cli` |

## License

MIT
