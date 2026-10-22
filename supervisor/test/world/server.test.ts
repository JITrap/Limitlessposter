import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startWorld, type WorldHandle } from '../../src/world/server.js'
import type { SupervisorState } from '../../src/status/writer.js'

const here = dirname(fileURLToPath(import.meta.url))
const REAL_PUBLIC = join(here, '..', '..', 'src', 'world', 'public')

const state: SupervisorState = {
  now: '2026-10-22T10:15:00',
  vaultName: 'MeinVault',
  health: { ok: true, problems: [] },
  paused: { active: false, reason: null, until: null },
  decision: null,
  workers: [],
  counts: { todo: 1, doing: 0, review: 0, blocked: 0, done: 0, cancelled: 0 },
  stations: [],
  today: { posts: 0, postLimit: 3, shopChanges: 0, shopLimit: 5 },
  nextWeekReset: '2026-10-22T18:00:00',
  waiting: [],
  ticker: [],
}

describe('world server', () => {
  let world: WorldHandle
  let base: string
  const calls: string[] = []

  beforeAll(async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'los-world-'))
    await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>Welt</title>', 'utf8')
    world = await startWorld({
      port: 0,
      getState: () => state,
      actions: {
        approve: async (id) => void calls.push(`approve:${id}`),
        pause: async () => void calls.push('pause'),
        resume: async () => void calls.push('resume'),
      },
      publicDir,
    })
    base = `http://127.0.0.1:${world.port}`
  })

  afterAll(async () => {
    await world.close()
  })

  it('serves the page at /', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('Welt')
  })

  it('returns the state as JSON (Sets serialized as arrays)', async () => {
    const res = await fetch(`${base}/api/state`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as SupervisorState
    expect(json.vaultName).toBe('MeinVault')
    expect(json.counts.todo).toBe(1)
  })

  it('streams state events over SSE on connect and on broadcast', async () => {
    const ctrl = new AbortController()
    const res = await fetch(`${base}/events`, { signal: ctrl.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    const readUntil = async (needle: string): Promise<void> => {
      const deadline = Date.now() + 2000
      while (!buf.includes(needle) && Date.now() < deadline) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
      }
    }
    await readUntil('event: state')
    expect(buf).toContain('event: state')
    expect(buf).toContain('"vaultName":"MeinVault"')
    buf = ''
    world.broadcast({ type: 'ticker', data: { line: 'hallo' } })
    await readUntil('event: ticker')
    expect(buf).toContain('event: ticker')
    expect(buf).toContain('"line":"hallo"')
    ctrl.abort()
  })

  it('routes approve/pause/resume to the actions', async () => {
    expect((await fetch(`${base}/api/approve/abc`, { method: 'POST' })).status).toBe(200)
    expect((await fetch(`${base}/api/pause`, { method: 'POST' })).status).toBe(200)
    const r = await fetch(`${base}/api/resume`, { method: 'POST' })
    expect(await r.json()).toEqual({ ok: true })
    expect(calls).toEqual(['approve:abc', 'pause', 'resume'])
  })

  it('rejects GET on action routes and unknown paths with 404/405', async () => {
    expect((await fetch(`${base}/api/pause`)).status).toBe(405)
    expect((await fetch(`${base}/nope`)).status).toBe(404)
    expect((await fetch(`${base}/api/approve/`, { method: 'POST' })).status).toBe(404)
  })

  it('rejects state-changing requests from a foreign origin or host (CSRF / DNS rebinding)', async () => {
    const before = calls.length
    expect((await fetch(`${base}/api/resume`, { method: 'POST', headers: { origin: 'http://evil.example' } })).status).toBe(403)
    expect((await fetch(`${base}/api/approve/x`, { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403)
    // fetch() refuses to set Host, so use a raw request for the DNS-rebinding case.
    const { request } = await import('node:http')
    const hostStatus = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: world.port, path: '/api/pause', method: 'POST', headers: { host: 'evil.example' } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(hostStatus).toBe(403)
    expect((await fetch(`${base}/api/pause`, { method: 'POST', headers: { origin: `http://127.0.0.1:${world.port}` } })).status).toBe(200)
    expect((await fetch(`${base}/api/resume`, { method: 'POST', headers: { origin: 'http://localhost:4242' } })).status).toBe(200)
    expect(calls.slice(before)).toEqual(['pause', 'resume'])
  })

  it('does not serve files outside the public dir', async () => {
    expect((await fetch(`${base}/../package.json`)).status).toBe(404)
  })
})

describe('world page', () => {
  it('ships a self-contained German page without external assets', async () => {
    const { readFile } = await import('node:fs/promises')
    const html = await readFile(join(REAL_PUBLIC, 'index.html'), 'utf8')
    expect(html).toContain('<html lang="de">')
    expect(html).toContain('/events')
    expect(html).toContain('/api/approve/')
    expect(html).toContain('obsidian://open?vault=')
    expect(html).toContain('Wartet auf dich')
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/)
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/)
  })
})
