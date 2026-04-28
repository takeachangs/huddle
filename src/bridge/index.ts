#!/usr/bin/env bun
import { basename } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { CoordinatorClient } from './coordinator-client.ts'
import { instructionsFor } from './instructions.ts'
import { normalizeMentions } from '../shared/mentions.ts'
import { CHAT_ID, MENTION_ALL } from '../shared/constants.ts'
import type { Message } from '../shared/protocol.ts'

const sessionName = (process.env.TUIGETHER_SESSION ?? basename(process.cwd())).toLowerCase()

const mcp = new Server(
  { name: 'tuigether', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} },
    },
    instructions: instructionsFor(sessionName),
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message to the tuigether group chat. Pass `mentions` (e.g. ["user"], ["repo-b"], or omit for broadcast) to direct routing.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The message body.' },
          mentions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Session names (without "@"), or "user", or "all". If omitted, defaults to broadcast (visible to user + all sessions).',
          },
        },
        required: ['text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  if (req.params.name !== 'reply') {
    return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true }
  }
  const text = typeof args.text === 'string' ? args.text : ''
  if (!text.trim()) {
    return { content: [{ type: 'text', text: 'reply: text is required' }], isError: true }
  }
  const mentions = normalizeMentions(Array.isArray(args.mentions) ? (args.mentions as string[]) : undefined)
  client.send(text, mentions)
  return { content: [{ type: 'text', text: 'sent' }] }
})

const client = new CoordinatorClient({
  session: sessionName,
  pid: process.pid,
  onMessage: (msg: Message) => {
    if (msg.sender === sessionName) return
    void mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: msg.text,
        meta: {
          chat_id: CHAT_ID,
          message_id: msg.id,
          sender: msg.sender,
          mentions: msg.mentions.length ? msg.mentions.join(',') : MENTION_ALL,
          ts: msg.ts,
        },
      },
    })
  },
  onDisconnect: () => {
    process.stderr.write('tuigether-mcp: coordinator disconnected\n')
  },
})

// Connect to the coordinator before exposing the reply tool. Otherwise
// reply() can fire before the socket is up and silently drop the message.
// Cold-start cost: 150ms-2s when the daemon isn't already running.
await client.connect()
process.stderr.write(`tuigether-mcp: connected as "${sessionName}"\n`)
await mcp.connect(new StdioServerTransport())

let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  client.close()
  // Give the SDK a tick to flush in-flight stdout responses before exiting.
  // Without this, a final response can be truncated if stdin EOFs immediately
  // after the request frame.
  setTimeout(() => process.exit(0), 50)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
