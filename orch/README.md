# orch

Config pack for `orch`, the huddle session that manages your other background
Claude Code sessions and reports outcomes to `@voice` on the channel.

## Prerequisites

- huddle installed and linked in this repo (`bun install && bun link` from
  the repo root — see the top-level README).
- `huddle init` already run in this directory. If not, run it first:

  ```sh
  cd orch && huddle init
  ```

## Configuration

`orch` manages sessions under MANAGED_ROOT, which defaults to `~/projects`.
To change it, edit the `MANAGED_ROOT` line near the top of `CLAUDE.md`.

## Launch

```sh
cd orch && HUDDLE_SESSION=orch huddle claude
```

Leave this session running — reports to `@voice` only flow while it's alive.

## Test it

From another terminal:

```sh
huddle send "@orch what sessions are running?"
huddle tail
```
