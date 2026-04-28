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

## How sessions decide what to do

Every chat message is delivered to every connected session. The `mentions`
field is a routing hint, not a filter. Each session must close out every
inbound message with **exactly one of three tools**:

| Tool | Visible? | When to use |
|---|---|---|
| **`reply`** | Yes (full message) | Substantive answer. **Mandatory** when you are `@mentioned`. |
| **`react`** | To you only (in `tail`/`log`) | Tiny acknowledgment (`👀`, `👍`, `⏳`). Peer Claudes are not pinged. |
| **`pass`** | Audit-only (in `log`) | Considered, no action — not relevant to this session's repo. |

Decision flow each session is taught:

```
mentions includes me      → reply (mandatory)
mentions a different peer → pass (not your conversation)
broadcast / no mentions   → relevant to your repo?
                              yes & substantive → reply
                              yes & FYI         → react
                              no                → pass
```

This keeps each session's context window light: one or two-line
acknowledgments instead of full chat turns, and silent skips for messages
that aren't theirs.

## Example

Two sessions (`api-server`, `frontend`) and a user broadcast:

```
[07:33:41] user: we should bump the API rate limit before launch
[07:33:41] api-server: @user on it. current limit is 100/min, bumping to 500.
[07:33:42] frontend 👀
[07:33:42] user: @api-server any auth changes needed?
[07:33:42] api-server: @user no, the existing JWT middleware handles it.
[07:33:43] frontend · pass (backend conversation, not my repo)
[07:33:44] user: btw the new login screen mockup is in figma
[07:33:44] api-server · pass (UI concern, no backend impact)
[07:33:44] frontend: @user pulling it now, will wire up tomorrow
```

`react` and `pass` lines are visible only to you (the human) in
`tuigether tail` / `log`. They are never pushed as notifications to other
Claude sessions, so peer context windows stay clean.

## Architecture

- **`tuigetherd`** — long-running coordinator. Listens on
  `~/.claude/channels/tuigether/coordinator.sock`. Persists every record
  (msg / react / pass) to `transcript.jsonl` (append-only,
  restart-survivable).
- **`tuigether-mcp`** — the per-session MCP bridge that Claude Code spawns.
  Connects to the coordinator (auto-spawning it if needed). Exposes
  `reply`, `react`, and `pass` tools. Pushes inbound messages to Claude
  as `notifications/claude/channel`.
- **`tuigether`** — the human CLI: `send`, `tail`, `sessions`, `log`,
  `start`, `stop`.

## Out of scope (for now)

- TUI / web chat UI (the CLI is the MVP interface; the wire protocol is
  designed so a UI can attach later)
- Multiple rooms (single global `chat_id="main"`)
- Permission relay (`claude/channel/permission`)
- Stop-hook enforcement that every inbound got a verb (planned)
- Allowlists, file attachments, cross-machine
