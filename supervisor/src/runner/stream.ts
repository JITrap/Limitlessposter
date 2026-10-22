import type { ModelFamily, RateLimitSignal } from '../types.js'
import { familyOf } from '../budget/models.js'

/** Typed view of one `--output-format stream-json` line (spec §5.2). */
export type StreamEvent =
  | { kind: 'init'; mcpErrors: string[] }
  | { kind: 'rate_limit'; signal: RateLimitSignal }
  | { kind: 'api_retry'; error: string }
  | { kind: 'permission_denied'; tool: string }
  | { kind: 'result'; raw: Record<string, unknown> }
  | { kind: 'other' }

export type RunReason =
  | 'success'
  | 'max_turns'
  | 'max_budget'
  | 'error'
  | 'rate_limited'
  | 'timeout'
  | 'no_result'
  | 'auth'

export interface RunSummary {
  ok: boolean
  reason: RunReason
  subtype: string | null
  isError: boolean
  apiErrorStatus: number | null
  costUsd: number
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cacheWrite: number
  modelUsed: string | null
  resultText: string
  permissionDenials: string[]
  sessionId: string | null
  durationMs: number
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseStreamLine(line: string): StreamEvent | null {
  if (!line.trim()) return null
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObj(raw) || typeof raw.type !== 'string') return null

  switch (raw.type) {
    case 'result':
      return { kind: 'result', raw }
    case 'rate_limit_event':
      return { kind: 'rate_limit', signal: toSignal(raw) }
    case 'system': {
      if (raw.subtype === 'init') return { kind: 'init', mcpErrors: mcpErrors(raw) }
      if (raw.subtype === 'api_retry') return { kind: 'api_retry', error: String(raw.error ?? 'unknown') }
      if (raw.subtype === 'permission_denied') return { kind: 'permission_denied', tool: String(raw.tool_name ?? raw.tool ?? 'unbekannt') }
      return { kind: 'other' }
    }
    default:
      return { kind: 'other' }
  }
}

function mcpErrors(init: Obj): string[] {
  const errs = Array.isArray(init.mcp_server_errors) ? init.mcp_server_errors : []
  return errs.map((e) => (isObj(e) ? `${String(e.name ?? '?')}: ${String(e.error ?? e.message ?? 'Fehler')}` : String(e)))
}

function toSignal(ev: Obj): RateLimitSignal {
  const type = String(ev.rate_limit_type ?? '').toLowerCase()
  const window: RateLimitSignal['window'] = type.startsWith('five_hour')
    ? 'five_hour'
    : type.startsWith('seven_day')
      ? 'seven_day'
      : 'unknown'
  let family: ModelFamily | 'all' = 'all'
  for (const f of ['opus', 'sonnet', 'haiku'] as const) if (type.includes(f)) family = f
  const statusRaw = String(ev.status ?? 'allowed')
  const status: RateLimitSignal['status'] =
    statusRaw === 'rejected' ? 'rejected' : statusRaw === 'allowed_warning' ? 'allowed_warning' : 'allowed'
  return { family, window, status, resetsAt: parseResetsAt(ev.resets_at) }
}

function parseResetsAt(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v)
  if (typeof v === 'string' && v.trim()) {
    const asNum = Number(v)
    if (Number.isFinite(asNum)) return parseResetsAt(asNum)
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Build the run summary from the final `result` line (or its absence).
 * Tokens and cost come from `modelUsage`, which includes subagents (spec §5.2).
 */
export function summarizeResult(
  result: Obj | null,
  seen: { rateLimited: boolean; denials: string[] },
): RunSummary {
  const base: RunSummary = {
    ok: false,
    reason: seen.rateLimited ? 'rate_limited' : 'no_result',
    subtype: null,
    isError: true,
    apiErrorStatus: null,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    modelUsed: null,
    resultText: '',
    permissionDenials: [...seen.denials],
    sessionId: null,
    durationMs: 0,
  }
  if (!result) return base

  const subtype = typeof result.subtype === 'string' ? result.subtype : null
  const isError = Boolean(result.is_error)
  const apiErrorStatus = typeof result.api_error_status === 'number' ? result.api_error_status : null

  // Tokens/cost: prefer modelUsage (includes subagents), fall back to usage/total_cost_usd.
  let costUsd = 0
  let tokensIn = 0
  let tokensOut = 0
  let cacheRead = 0
  let cacheWrite = 0
  let modelUsed: string | null = null
  let bestCost = -1
  if (isObj(result.modelUsage)) {
    for (const [model, u] of Object.entries(result.modelUsage)) {
      if (!isObj(u)) continue
      costUsd += num(u.costUSD)
      tokensIn += num(u.inputTokens)
      tokensOut += num(u.outputTokens)
      cacheRead += num(u.cacheReadInputTokens)
      cacheWrite += num(u.cacheCreationInputTokens)
      if (num(u.costUSD) > bestCost) {
        bestCost = num(u.costUSD)
        modelUsed = model
      }
    }
  }
  if (costUsd === 0) costUsd = num(result.total_cost_usd)
  if (tokensIn === 0 && isObj(result.usage)) {
    tokensIn = num(result.usage.input_tokens)
    tokensOut = num(result.usage.output_tokens)
    cacheRead = num(result.usage.cache_read_input_tokens)
    cacheWrite = num(result.usage.cache_creation_input_tokens)
  }

  const denials = [...seen.denials]
  if (Array.isArray(result.permission_denials)) {
    for (const d of result.permission_denials) {
      const tool = isObj(d) ? String(d.tool_name ?? d.tool ?? '') : String(d)
      if (tool && !denials.includes(tool)) denials.push(tool)
    }
  }

  let reason: RunReason
  if (subtype === 'success' && !isError) reason = 'success'
  else if (subtype === 'error_max_turns') reason = 'max_turns'
  else if (subtype === 'error_max_budget_usd') reason = 'max_budget'
  else if (apiErrorStatus === 429 || seen.rateLimited) reason = 'rate_limited'
  else if (apiErrorStatus === 401 || apiErrorStatus === 403) reason = 'auth'
  else reason = 'error'

  return {
    ok: reason === 'success',
    reason,
    subtype,
    isError,
    apiErrorStatus,
    costUsd,
    tokensIn,
    tokensOut,
    cacheRead,
    cacheWrite,
    modelUsed,
    resultText: typeof result.result === 'string' ? result.result : '',
    permissionDenials: denials,
    sessionId: typeof result.session_id === 'string' ? result.session_id : null,
    durationMs: num(result.duration_ms),
  }
}
