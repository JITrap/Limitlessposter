import { describe, it, expect } from 'vitest'
import { selectRunnable, normalizeApprovals, recoverOrphans } from '../../src/queue/select.js'
import type { Task, TaskFrontmatter } from '../../src/types.js'

let n = 0
function task(over: Partial<TaskFrontmatter>): Task {
  n++
  const fm: TaskFrontmatter = {
    type: 'task',
    id: over.id ?? `t${n}`,
    title: over.title ?? `Aufgabe ${n}`,
    status: 'todo',
    station: 'content',
    priority: 2,
    tier: 'standard',
    due: null,
    created: `2026-10-22T09:00:${String(n).padStart(2, '0')}`,
    updated: '2026-10-22T09:00:00',
    started: null,
    completed: null,
    attempts: 0,
    max_attempts: 3,
    cost_usd: 0,
    tokens_in: 0,
    tokens_out: 0,
    model_used: null,
    outputs: [],
    needs_approval: false,
    origin: 'planer',
    parent: null,
    published_at: null,
    tags: ['task'],
    ...over,
  }
  return { fm, body: '', path: `/v/Aufgaben/${fm.id}.md` }
}

const ctx = (over: Partial<Parameters<typeof selectRunnable>[1]> = {}) => ({
  available: new Set(['content', 'planer', 'studio']),
  allowedTiers: new Set(['cheap', 'standard', 'premium'] as const),
  running: new Map<string, Task>(),
  maxParallel: 2,
  ...over,
})

describe('selectRunnable', () => {
  it('orders by priority, then due (null last), then created', () => {
    const a = task({ id: 'a', priority: 2, due: '2026-10-30' })
    const b = task({ id: 'b', priority: 1, due: null })
    const c = task({ id: 'c', priority: 2, due: '2026-10-25' })
    const d = task({ id: 'd', priority: 2, due: null })
    const picked = selectRunnable([a, b, c, d], ctx({ maxParallel: 4 }))
    expect(picked.map((t) => t.fm.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('skips non-todo, manual, unavailable-station and disallowed-tier tasks', () => {
    const tasks = [
      task({ id: 'doing', status: 'doing' }),
      task({ id: 'review', status: 'review' }),
      task({ id: 'manual', station: 'manual' }),
      task({ id: 'voice', station: 'voice' }),
      task({ id: 'premium', tier: 'premium' }),
      task({ id: 'ok' }),
    ]
    const picked = selectRunnable(tasks, ctx({ allowedTiers: new Set(['cheap', 'standard']), maxParallel: 10 }))
    expect(picked.map((t) => t.fm.id)).toEqual(['ok'])
  })

  it('respects maxParallel minus running workers', () => {
    const running = new Map<string, Task>([['r1', task({ id: 'r1', status: 'doing' })]])
    const picked = selectRunnable([task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })], ctx({ running, maxParallel: 2 }))
    expect(picked).toHaveLength(1)
  })

  it('excludes tasks that are already running even if their note still says todo', () => {
    const a = task({ id: 'a' })
    const running = new Map<string, Task>([['a', a]])
    expect(selectRunnable([a, task({ id: 'b' })], ctx({ running, maxParallel: 5 })).map((t) => t.fm.id)).toEqual(['b'])
  })

  it('allows at most one premium task among running and selected', () => {
    const p1 = task({ id: 'p1', tier: 'premium', priority: 1 })
    const p2 = task({ id: 'p2', tier: 'premium', priority: 1 })
    const s = task({ id: 's', tier: 'standard', priority: 3 })
    expect(selectRunnable([p1, p2, s], ctx({ maxParallel: 3 })).map((t) => t.fm.id)).toEqual(['p1', 's'])
    const running = new Map<string, Task>([['rp', task({ id: 'rp', tier: 'premium', status: 'doing' })]])
    expect(selectRunnable([p1, s], ctx({ running, maxParallel: 3 })).map((t) => t.fm.id)).toEqual(['s'])
  })
})

describe('normalizeApprovals', () => {
  it('moves approved review tasks back to todo and clears stray flags', () => {
    const approved = task({ id: 'ok', status: 'review', needs_approval: false })
    const waiting = task({ id: 'wait', status: 'review', needs_approval: true })
    const stray = task({ id: 'stray', status: 'todo', needs_approval: true })
    const plain = task({ id: 'plain', status: 'todo', needs_approval: false })
    const rows = normalizeApprovals([approved, waiting, stray, plain])
    expect(rows).toEqual([
      { id: 'ok', patch: { status: 'todo' }, log: 'Freigabe durch Julius' },
      { id: 'stray', patch: { needs_approval: false }, log: 'Freigabe durch Julius (Status todo)' },
    ])
  })
})

describe('recoverOrphans', () => {
  it('returns doing tasks without a running worker to the queue', () => {
    const orphan = task({ id: 'o', status: 'doing', started: '2026-10-22T08:00:00' })
    const live = task({ id: 'l', status: 'doing' })
    const rows = recoverOrphans([orphan, live, task({ id: 'x' })], new Set(['l']))
    expect(rows).toEqual([
      { id: 'o', patch: { status: 'todo', started: null }, log: 'Lauf nicht mehr aktiv – zurück in Warteschlange' },
    ])
  })
})
