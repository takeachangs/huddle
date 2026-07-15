// `huddle voice` — launch the voice web console (the wake-on-report front-end).
// Thin wrapper over voice/serve.ts so the console is reachable from the main CLI
// without needing the separate `huddle-voice` bin on $PATH.

export async function voice(args: string[]): Promise<void> {
  const portFlag = args.indexOf('--port')
  const port = portFlag !== -1 ? Number(args[portFlag + 1]) : 4425
  const { serveApp } = await import('../voice/serve.ts')
  serveApp(port)
}
