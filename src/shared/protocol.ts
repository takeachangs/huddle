export interface Message {
  id: string
  ts: string
  sender: string
  mentions: string[]
  text: string
  /** Discriminator for transcript records. Absent on legacy lines = "msg". */
  kind?: 'msg'
}

export interface ReactRecord {
  id: string
  ts: string
  sender: string
  kind: 'react'
  target_id: string
  emoji: string
}

export interface PassRecord {
  id: string
  ts: string
  sender: string
  kind: 'pass'
  target_id: string
  reason?: string
}

export type TranscriptRecord = Message | ReactRecord | PassRecord

export interface SessionInfo {
  name: string
  pid: number
  connected_at: string
}

export type ClientFrame =
  | { t: 'hello'; role: 'bridge'; session: string; pid: number }
  | { t: 'hello'; role: 'cli' }
  | { t: 'send'; text: string; mentions?: string[] }
  | { t: 'react'; target_id: string; emoji: string }
  | { t: 'pass'; target_id: string; reason?: string }
  | { t: 'subscribe_tail' }
  | { t: 'list_sessions' }
  | { t: 'read_log'; since?: string; limit?: number }
  | { t: 'shutdown' }
  | { t: 'bye' }

export type ServerFrame =
  | { t: 'welcome'; identity: string }
  | { t: 'message'; msg: Message }
  | { t: 'sessions'; sessions: SessionInfo[] }
  | { t: 'log'; messages: TranscriptRecord[] }
  | { t: 'tail_event'; record: TranscriptRecord }
  | { t: 'ack' }
  | { t: 'error'; reason: string }
