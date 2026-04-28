# huddle

Multi-session Claude Code **[channel](https://code.claude.com/docs/en/channels-reference)** MCP server — a group chat between you
and the Claude Code sessions running in each of your repos.

> **Notice — Channels research preview** *(as of 28 April 2026)*
> Channels are in research preview and require **Claude Code v2.1.80 or later**.
> You must be logged in with a **claude.ai account** — Console and API key
> authentication are not supported. **Team and Enterprise organizations** must
> explicitly enable Channels before they can be used.

```
                        ┌──────────────┐
                        │  you (CLI)   │
                        └──────┬───────┘
                               │
          ┌────────────────────┴────────────────────┐
          │           huddled (daemon)           │
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

   That puts `huddle`, `huddle-mcp`, and `huddled` on your `$PATH`.

2. In each repo where you want a Claude session to join the chat:

   ```sh
   cd ~/repos/api-server
   huddle init                # writes/merges .mcp.json
   huddle init --name custom  # override the session name (default: cwd basename)
   ```

3. Launch Claude in each repo with the channel flag — `huddle claude`
   wraps it for you:

   ```sh
   huddle claude              # = claude --dangerously-load-development-channels server:huddle
   huddle claude --resume     # any extra args pass through to claude
   ```

   The dev flag is required during the channels research preview because
   custom channels aren't on Anthropic's allowlist; once huddle is
   approved (or you allowlist it via org policy) it'll switch to plain
   `--channels`. Channels also require Claude Code v2.1.80+ and claude.ai
   login (no API-key auth).

4. From any terminal, talk to them:

   ```sh
   huddle sessions                    # list connected sessions
   huddle send "hi everyone"          # broadcast
   huddle send "@repo-a check api.py" # direct (still visible to all)
   huddle tail                        # follow live transcript
   huddle log --n 50                  # read history
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
`huddle tail` / `log`. They are never pushed as notifications to other
Claude sessions, so peer context windows stay clean.

## Architecture

- **`huddled`** — long-running coordinator. Listens on
  `~/.claude/channels/huddle/coordinator.sock`. Persists every record
  (msg / react / pass) to `transcript.jsonl` (append-only,
  restart-survivable).
- **`huddle-mcp`** — the per-session MCP bridge that Claude Code spawns.
  Connects to the coordinator (auto-spawning it if needed). Exposes
  `reply`, `react`, and `pass` tools. Pushes inbound messages to Claude
  as `notifications/claude/channel`.
- **`huddle`** — the human CLI: `init`, `claude`, `send`, `tail`,
  `sessions`, `log`, `start`, `stop`.

## Out of scope (for now)

- TUI / web chat UI (the CLI is the MVP interface; the wire protocol is
  designed so a UI can attach later)
- Multiple rooms (single global `chat_id="main"`)
- Permission relay (`claude/channel/permission`)
- Stop-hook enforcement that every inbound got a verb (planned)
- Allowlists, file attachments, cross-machine
