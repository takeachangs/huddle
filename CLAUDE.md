# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`tuigether` is a Claude Code **channel** MCP server (per
https://code.claude.com/docs/en/channels-reference) that hosts a multi-party
group chat between one human and N Claude Code sessions, each running in its
own repo. It is the only known multi-session implementation of the channel
contract — both reference plugins (`imessage`, `fakechat`) are
single-Claude-only.

Three reference resources for any non-trivial change:
- The channels-reference URL above (the protocol contract).
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/imessage/server.ts` — production-grade single-Claude reference.
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/fakechat/server.ts` — minimal in-process WebSocket reference.

## Commands

This project has no test suite or build step. Verification is manual end-to-end
via the CLI + piped JSON-RPC against `tuigether-mcp`.

```sh
bun install                       # one-time
bun link                          # puts tuigether, tuigether-mcp, tuigetherd on $PATH
bunx tsc --noEmit                 # typecheck — run after any change
tuigether init [--name NAME]      # write/merge .mcp.json in cwd; idempotent
tuigether claude [...args]        # wraps `claude --dangerously-load-development-channels server:tuigether`
tuigetherd                        # start coordinator (foreground)
tuigether send "@alpha hi"        # send as the human
tuigether tail                    # follow live transcript
tuigether sessions                # list connected bridges
tuigether log --n 50              # read transcript history
tuigether stop                    # shut the daemon down
```

The dev flag is required because tuigether isn't on Anthropic's
channel allowlist. Plain `--channels plugin:tuigether@MARKETPLACE`
needs either marketplace approval or `allowedChannelPlugins` in
managed (admin) settings; user-level allowlist isn't honored for
individual accounts. See https://code.claude.com/docs/en/channels.

To smoke-test the MCP bridge without launching real Claude, pipe JSON-RPC
frames into `tuigether-mcp` and **keep stdin open after the last frame** with
a trailing `sleep`:

```sh
( cat <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"reply","arguments":{"text":"hi"}}}
EOF
sleep 0.5 ) | TUIGETHER_SESSION=alpha tuigether-mcp
```

The trailing `sleep` is required: stdin EOF triggers shutdown, and without a
short window the SDK can't flush in-flight stdout responses (there's a 50ms
drain in `bridge/index.ts`'s shutdown handler, but a piped test that ends
immediately still races).

## Architecture

Three processes, one shared unix socket. **The three-process split is the
non-obvious part — the coordinator exists because each Claude session spawns
its own MCP subprocess (stdio is per-client), so peer-visibility requires
shared state.**

```
Claude session A          Claude session B          Claude session C
        │ stdio                  │ stdio                  │ stdio
        ▼                        ▼                        ▼
   tuigether-mcp             tuigether-mcp             tuigether-mcp
   (per-session bridge)      (per-session bridge)      (per-session bridge)
        │                         │                         │
        └────────── unix socket ──┴─── ~/.claude/channels/tuigether/coordinator.sock
                                  │
                                  ▼
                        tuigetherd (coordinator)
                                  │
                                  ▼
                          tuigether (CLI)
```

**Coordinator daemon** (`src/coordinator/`) — listens on the unix socket,
holds the live session registry, persists every record to
`~/.claude/channels/tuigether/transcript.jsonl` (append-only), routes
messages. Lazy-spawned by the bridge or CLI on first connect.

**Per-session MCP bridge** (`src/bridge/`) — what Claude Code spawns over
stdio. Declares `capabilities.experimental['claude/channel']`, exposes the
three tools (`reply` / `react` / `pass`), and forwards inbound coordinator
messages to Claude as `notifications/claude/channel` with the `<channel ...>`
meta the docs prescribe. Session name defaults to `path.basename(process.cwd())`
because Claude Code does NOT expose any session/conversation ID to MCP servers
(this is a deliberate isolation boundary; we cannot auto-derive a session
identity any other way). Override with `TUIGETHER_SESSION=name`.

**CLI** (`src/cli/`) — the human-facing client. `send`, `tail`, `sessions`,
`log`, `start`, `stop`. The MVP "UI" until a TUI/web UI exists.

### Wire protocol

`src/shared/protocol.ts` is the single source of truth for **both** the
on-the-wire frames (`ClientFrame` / `ServerFrame`, NDJSON over the unix
socket) **and** the on-disk transcript record union (`TranscriptRecord` =
`Message | ReactRecord | PassRecord`, discriminated by `kind`). When extending
the channel, update both axes here first; the rest follows.

### The three-verb model

Every inbound channel message Claude receives must be closed out with exactly
one of three tools (`bridge/instructions.ts` is the system prompt that teaches
this to Claude):

- `reply({text, mentions?})` — full message; **mandatory** when the session
  is `@mentioned`. Persisted as `Message`; fanned out to every peer bridge
  (excluding the originator) and every CLI tail subscriber.
- `react({message_id, emoji})` — tiny acknowledgment. Persisted as
  `ReactRecord`; fanned out to **CLI tail subscribers only** — peer Claudes
  are never pinged by reactions (this is the whole point: low-noise per-session
  context).
- `pass({message_id, reason?})` — silent "considered, no action". Persisted as
  `PassRecord`; fanned out to CLI tail only. Audit trail for the user.

The split lives in `coordinator/registry.ts`: `fanoutMessage` (peers + tail)
vs `fanoutAuditOnly` (tail only). Don't merge these; the split is what
guarantees react/pass don't pollute peer context windows.

### Two non-obvious correctness invariants

1. **Bridge startup order** — `await client.connect()` MUST run *before*
   `await mcp.connect(StdioServerTransport())` in `bridge/index.ts`. If you
   reverse it, Claude can call the `reply` tool before the coordinator socket
   is up, and `CoordinatorClient.send()` silently no-ops on a missing socket.
   This was tried and reverted in commit `7c3e2b2`. The cold-start cost
   (150ms-2s for the lazy daemon spawn) is the price.

2. **Own-session echo filter** — `bridge/index.ts`'s `onMessage` must drop
   messages where `msg.sender === sessionName` so a Claude session doesn't
   receive its own reply back as a notification. The coordinator already
   excludes the originating bridge socket in `fanoutMessage`, but the bridge
   filter is belt-and-suspenders for the case where the bridge reconnects with
   the same session name and races against an in-flight echo.

## State on disk

Everything lives under `~/.claude/channels/tuigether/`:
- `coordinator.sock` — listening socket (deleted on clean shutdown)
- `coordinator.pid` — pidfile (TOCTOU-safe try/catch read in `coordinator/index.ts`)
- `transcript.jsonl` — append-only NDJSON of `TranscriptRecord` union
- `coordinator.log` — daemon stderr when spawned detached

The transcript survives daemon restarts. There is no rotation yet.

## What's deliberately NOT here (yet)

When implementing any of these, check the README's "Out of scope" section
first — that's the canonical list:

- TUI / web UI (server-only by design; protocol is wire-stable for future
  attachment)
- Multiple rooms (single global `chat_id="main"` constant in `shared/constants.ts`)
- Permission relay (`claude/channel/permission` capability)
- Stop-hook enforcement that every inbound got a verb
- Allowlists, file attachments, cross-machine
