# Contributing to huddle

## What this project is right now

v0. The wire protocol is stable enough to build on but the behavioral surface — how Claude responds to incoming messages mid-task — is still being shaped. Breaking the protocol format is expensive; breaking the fanout rules is subtle. Read this before you send a PR.

## What kinds of contributions are welcome

- **Bug reports** — if it breaks when you run it, open an issue.
- **Use-case ideas and design discussion** — the channel protocol can support a lot of interaction patterns that haven't been tried yet. Open a "Use case" issue with a transcript-style example of what you'd want to see.
- **Feature PRs** — welcome, but if the change touches the wire protocol or the fanout rules, open an issue first so the design can be discussed before code is written. Mistakes in `src/shared/protocol.ts` affect both the wire format and the on-disk transcript at once; that's a hard migration to undo.
- **Small bug fixes** — just open a PR.

## Dev setup

```sh
bun install
bun link        # puts huddle, huddle-mcp, huddled on $PATH
```

## Verifying changes

**Typecheck** (run after every change):

```sh
bunx tsc --noEmit
```

**Smoke test** — pipes JSON-RPC frames into `huddle-mcp` without launching real Claude:

```sh
( cat <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"reply","arguments":{"text":"hi"}}}
EOF
sleep 0.5 ) | HUDDLE_SESSION=alpha huddle-mcp
```

The `sleep 0.5` at the end is required — stdin EOF triggers shutdown, and without a short window the SDK can't flush in-flight stdout responses. There's a 50ms drain in `bridge/index.ts`'s shutdown handler, but a piped test that ends immediately still races it.

## Three invariants you must not break

### 1. Bridge startup order

In `src/bridge/index.ts`, `await client.connect()` (the coordinator socket) must run *before* `await mcp.connect(StdioServerTransport())`. If reversed, Claude can call `reply` before the socket is up and `CoordinatorClient.send()` silently no-ops.

### 2. Own-session echo filter

`bridge/index.ts`'s `onMessage` must drop messages where `msg.sender === sessionName`. The coordinator already excludes the originating bridge socket in `fanoutMessage`, but the bridge filter is belt-and-suspenders for reconnect races.

### 3. react/pass stay audit-only

`src/coordinator/registry.ts` has two fanout paths: `fanoutMessage` (peers + CLI tail subscribers) and `fanoutAuditOnly` (CLI tail only). `reply` uses the first; `react` and `pass` use the second. This split is the whole point — it keeps peer context windows clean. Do not merge these or add peer fanout to `react`/`pass`.

## Out of scope

See the [Out of scope](README.md#out-of-scope-for-now) section in the README.

## License

By contributing you agree that your contribution is licensed under the MIT license, consistent with [LICENSE](LICENSE).
