import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export async function init(args: string[]): Promise<void> {
  let name: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--name' || a === '-n') {
      name = args[++i]
      if (!name) throw new Error('--name requires a value')
    } else if (a === '--help' || a === '-h') {
      printHelp()
      return
    } else {
      printHelp()
      throw new Error(`unknown argument: ${a}`)
    }
  }

  const cwd = process.cwd()
  const mcpPath = join(cwd, '.mcp.json')

  type McpEntry = { command: string; args?: string[]; env?: Record<string, string> }
  const entry: McpEntry = { command: 'tuigether-mcp' }
  if (name) entry.env = { TUIGETHER_SESSION: name }

  let config: { mcpServers?: Record<string, McpEntry> } = {}
  if (existsSync(mcpPath)) {
    try {
      config = JSON.parse(readFileSync(mcpPath, 'utf8'))
    } catch (err) {
      throw new Error(`failed to parse existing .mcp.json: ${err instanceof Error ? err.message : err}`)
    }
  }

  const servers = config.mcpServers ?? {}
  const replaced = 'tuigether' in servers
  servers.tuigether = entry
  config.mcpServers = servers

  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n', 'utf8')

  const effectiveName = name ?? basename(cwd).toLowerCase()
  process.stdout.write(
    (replaced ? 'tuigether: replaced existing entry in ' : 'tuigether: wrote ') + mcpPath + '\n' +
    `session name: ${effectiveName}${name ? '' : ' (derived from cwd)'}\n\n` +
    `Launch this session with:\n` +
    `  tuigether claude\n\n` +
    `Or directly:\n` +
    `  claude --dangerously-load-development-channels server:tuigether\n`,
  )
}

function printHelp(): void {
  process.stderr.write(
    `Usage: tuigether init [--name SESSION_NAME]\n\n` +
    `Wires the current directory up to tuigether by writing/merging a\n` +
    `.mcp.json with a "tuigether" MCP server entry. The session name\n` +
    `defaults to the cwd basename; pass --name to override.\n`,
  )
}
