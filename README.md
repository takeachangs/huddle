# tuigether

Multi-session Claude Code **channel** MCP server — a group chat between you
and the Claude Code sessions running in each of your repos.

```
                        ┌──────────────┐
                        │  you (CLI)   │
                        └──────┬───────┘
                               │
          ┌────────────────────┴────────────────────┐
          │           tuigetherd (daemon)           │
          │  transcript • routing • live registry   │
          └───┬────────────┬────────────┬───────────┘
              │            │            │
       ┌──────┴──┐  ┌──────┴──┐  ┌──────┴──┐
       │ claude  │  │ claude  │  │ claude  │
       │ repo-a  │  │ repo-b  │  │ repo-c  │
       └─────────┘  └─────────┘  └─────────┘
```

## Quick start

1. Install:

   ```sh
   bun install
   bun link
   ```

   That puts `tuigether`, `tuigether-mcp`, and `tuigetherd` on your `$PATH`.

2. In each repo where you want a Claude session to join the chat, add a
   `.mcp.json`:

   ```json
   {
     "mcpServers": {
       "tuigether": { "command": "tuigether-mcp" }
     }
   }
   ```

   The session name defaults to the repo directory's basename. To override,
   add `"env": { "TUIGETHER_SESSION": "my-name" }`.

3. Open Claude Code in those repos. Each session connects to (and lazily
   spawns) the coordinator daemon.

4. From any terminal, talk to them:

   ```sh
   tuigether sessions                    # list connected sessions
   tuigether send "hi everyone"          # broadcast
   tuigether send "@repo-a check api.py" # direct (still visible to all)
   tuigether tail                        # follow live transcript
   tuigether log --n 50                  # read history
   ```

## How addressing works

Every message is delivered to every connected session — that's the group chat.
The `mentions` field is a routing **hint** in the message metadata. Each
Claude session is instructed to:

- Always respond when its name is mentioned (or the message is to "all", or
  it's a user message with no mentions).
- Otherwise treat peer-to-peer chatter as observation only.

Sessions can `@mention` each other too (e.g. "@repo-b can you also check?").

## Architecture

- **`tuigetherd`** — long-running coordinator. Listens on
  `~/.claude/channels/tuigether/coordinator.sock`. Persists every message to
  `transcript.jsonl` (append-only, restart-survivable).
- **`tuigether-mcp`** — the per-session MCP bridge that Claude Code spawns.
  Connects to the coordinator (auto-spawning it if needed). Exposes the
  `reply` tool. Pushes inbound messages to Claude as
  `notifications/claude/channel`.
- **`tuigether`** — the human CLI: `send`, `tail`, `sessions`, `log`,
  `start`, `stop`.

## Out of scope (for now)

- TUI / web chat UI (the CLI is the MVP interface; the wire protocol is
  designed so a UI can attach later)
- Multiple rooms (single global `chat_id="main"`)
- Permission relay (`claude/channel/permission`)
- Allowlists, file attachments, cross-machine
