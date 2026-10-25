// Shared domain types for the Limitless OS supervisor.
// Everything that crosses a module boundary is declared here so that the
// vault, budget, runner, queue and world modules never import each other
// just for a type.

export type Tier = 'cheap' | 'standard' | 'premium'

export type TaskStatus = 'todo' | 'doing' | 'review' | 'blocked' | 'done' | 'cancelled'

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'other'

export type TaskOrigin = 'planer' | 'julius' | 'inbox' | 'system'

/** Frontmatter of one task note in `LimitlessOS/Aufgaben/<id>.md` (spec §4.1). */
export interface TaskFrontmatter {
  type: 'task'
  id: string
  title: string
  status: TaskStatus
  station: string
  priority: 1 | 2 | 3 | 4
  tier: Tier
  /** YYYY-MM-DD or null */
  due: string | null
  /** YYYY-MM-DDTHH:mm:ss local */
  created: string
  updated: string
  started: string | null
  completed: string | null
  attempts: number
  max_attempts: number
  cost_usd: number
  tokens_in: number
  tokens_out: number
  model_used: string | null
  outputs: string[]
  needs_approval: boolean
  origin: TaskOrigin
  parent: string | null
  /** Set by a worker when it actually scheduled/published something outward-facing. */
  published_at: string | null
  tags: string[]
  /**
   * Manual cards only: the supervisor ticks the card off itself once every condition holds –
   * `claude-login`, `mcp:<server>` (from `claude mcp list`), `env:<VAR>` (set in .env); comma-separated.
   */
  auto_done?: string | null
}

export interface Task {
  fm: TaskFrontmatter
  body: string
  path: string
}

/** A rate-limit observation extracted from a `claude -p` stream (spec §6.2). */
export interface RateLimitSignal {
  family: ModelFamily | 'all'
  window: 'five_hour' | 'seven_day' | 'unknown'
  status: 'allowed' | 'allowed_warning' | 'rejected'
  resetsAt: Date | null
}

export interface FamilyUsage {
  used: number
  target: number
  capacity: number
}

/** What the budget guard allows right now (spec §6.3). */
export interface Decision {
  mode: 'normal' | 'cheap-only' | 'paused'
  allowedTiers: Set<Tier>
  /** German, shown in Status.md and the world view. */
  reason: string
  until: Date | null
  usage: {
    week: Record<ModelFamily, FamilyUsage>
    session: { used: number; capacity: number }
  }
}
