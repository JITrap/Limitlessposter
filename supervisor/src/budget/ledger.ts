import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ModelFamily } from '../types.js'

/** One worker run as recorded in `supervisor/data/ledger.jsonl` (spec §6.2). */
export interface LedgerEntry {
  /** YYYY-MM-DDTHH:mm:ss local */
  ts: string
  task: string
  station: string
  model: string
  family: ModelFamily
  tokens_in: number
  tokens_out: number
  cache_read: number
  cache_write: number
  /** Client-side estimate from `modelUsage` (USD). The pacing currency. */
  cost_usd: number
  duration_ms: number
  result: string
}

/** Append-only JSON-lines ledger. Corrupt lines are skipped, never fatal. */
export class Ledger {
  constructor(readonly filePath: string) {}

  async append(e: LedgerEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await appendFile(this.filePath, JSON.stringify(e) + '\n', 'utf8')
  }

  async load(): Promise<LedgerEntry[]> {
    let text: string
    try {
      text = await readFile(this.filePath, 'utf8')
    } catch {
      return []
    }
    const out: LedgerEntry[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as LedgerEntry
        if (e && typeof e.ts === 'string') out.push(e)
      } catch {
        // skip corrupt line
      }
    }
    return out
  }

  async sumCostSince(since: Date, family?: ModelFamily): Promise<number> {
    const sinceMs = since.getTime()
    let sum = 0
    for (const e of await this.load()) {
      if (new Date(e.ts).getTime() < sinceMs) continue
      if (family && e.family !== family) continue
      sum += Number(e.cost_usd) || 0
    }
    return sum
  }

  async countSince(since: Date, pred: (e: LedgerEntry) => boolean = () => true): Promise<number> {
    const sinceMs = since.getTime()
    let n = 0
    for (const e of await this.load()) {
      if (new Date(e.ts).getTime() < sinceMs) continue
      if (pred(e)) n++
    }
    return n
  }
}
