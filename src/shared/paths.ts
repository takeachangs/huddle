import { homedir } from 'node:os'
import { join } from 'node:path'

export const STATE_DIR = process.env.TUIGETHER_STATE_DIR
  ?? join(homedir(), '.claude', 'channels', 'tuigether')

export const SOCKET_PATH = join(STATE_DIR, 'coordinator.sock')
export const PID_PATH = join(STATE_DIR, 'coordinator.pid')
export const TRANSCRIPT_PATH = join(STATE_DIR, 'transcript.jsonl')
export const DAEMON_LOG_PATH = join(STATE_DIR, 'coordinator.log')
