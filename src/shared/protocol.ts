export interface Message {
  id: string
  ts: string
  sender: string
  mentions: string[]
  text: string
}

export interface SessionInfo {
  name: string
  pid: number
  connected_at: string
}

export type ClientFrame =
  | { t: 'hello'; role: 'bridge'; session: string; pid: number }
  | { t: 'hello'; role: 'cli' }
  | { t: 'send'; text: string; mentions?: string[] }
  | { t: 'subscribe_tail' }
  | { t: 'list_sessions' }
  | { t: 'read_log'; since?: string; limit?: number }
  | { t: 'shutdown' }
  | { t: 'bye' }

export type ServerFrame =
  | { t: 'welcome'; identity: string }
  | { t: 'message'; msg: Message }
  | { t: 'sessions'; sessions: SessionInfo[] }
  | { t: 'log'; messages: Message[] }
  | { t: 'ack' }
  | { t: 'error'; reason: string }
