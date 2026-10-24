import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
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
  today: { posts: 0, postLimit: 3, byNetwork: {}, publogSynced: null, publogStale: true, shopChanges: 0, shopLimit: 5 },
  nextWeekReset: '2026-10-22T18:00:00',
  waiting: [],
  ticker: [],
  zentrale: { kennzahlen: null, printify: null, aktualisierung_laeuft: false, links: [] },
  fabrik: { leer: true, leerSeit: '2026-10-22T10:00:00', grund: 'keine Aufgaben', naechsteAusloeser: [{ name: 'Tagesbericht', wann: '2026-10-23T07:30:00' }], letzterPlaner: null },
  kalender: {
    tage: [{ datum: '2026-10-22', heute: true, eintraege: [{ zeit: '18:30', netzwerk: 'instagram', typ: 'reel', status: 'geplant', text: 'Poster im Raum', url: '' }] }],
    heute: {},
  },
  medien: [],
  stimme: { installed: false, engine: null, cuda: false, voices: [], lastSample: null, lastError: null, updated: null },
}

// a fake PNG and a 100-byte "video" under <vault>/Assets/content – served via /media/
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const MP4 = Buffer.alloc(100, 7)

describe('world server', () => {
  let world: WorldHandle
  let base: string
  let mediaRoot: string
  const calls: string[] = []

  beforeAll(async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'los-world-'))
    await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>Welt</title>', 'utf8')
    mediaRoot = await mkdtemp(join(tmpdir(), 'los-vault-'))
    await mkdir(join(mediaRoot, 'Assets', 'content', 't1'), { recursive: true })
    await mkdir(join(mediaRoot, 'Marke'), { recursive: true })
    await writeFile(join(mediaRoot, 'Assets', 'content', 't1', 'slide.png'), PNG)
    await writeFile(join(mediaRoot, 'Assets', 'content', 't1', 'clip.mp4'), MP4)
    await writeFile(join(mediaRoot, 'Assets', 'content', 't1', 'werkzeug.exe'), 'MZ', 'utf8')
    await writeFile(join(mediaRoot, 'Marke', 'Kern.md'), '# Kern – nicht öffentlich', 'utf8')
    world = await startWorld({
      port: 0,
      getState: () => state,
      actions: {
        approve: async (id) => void calls.push(`approve:${id}`),
        pause: async () => void calls.push('pause'),
        resume: async () => void calls.push('resume'),
        refreshKennzahlen: async () => {
          calls.push('refresh')
          return { ok: true, reason: null }
        },
        plan: async () => {
          calls.push('plan')
          return { ok: false, reason: 'Planer läuft bereits' }
        },
      },
      publicDir,
      mediaRoot,
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

  it('carries Fabrik, Kalender, Medien and Stimme in the state', async () => {
    const json = (await (await fetch(`${base}/api/state`)).json()) as SupervisorState
    expect(json.fabrik).toMatchObject({ leer: true, grund: 'keine Aufgaben' })
    expect(json.fabrik.naechsteAusloeser[0]).toEqual({ name: 'Tagesbericht', wann: '2026-10-23T07:30:00' })
    expect(json.kalender.tage[0].heute).toBe(true)
    expect(json.kalender.tage[0].eintraege[0]).toMatchObject({ netzwerk: 'instagram', zeit: '18:30', status: 'geplant' })
    expect(json.medien).toEqual([])
    expect(json.stimme.installed).toBe(false)
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

  it('routes the Zentrale refresh button and returns its answer', async () => {
    const r = await fetch(`${base}/api/kennzahlen/refresh`, { method: 'POST', headers: { origin: `http://localhost:${world.port}` } })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, reason: null })
    expect(calls).toContain('refresh')
    expect((await fetch(`${base}/api/kennzahlen/refresh`)).status).toBe(405)
  })

  it('routes the Fabrik button (Planer jetzt) and returns the planner answer', async () => {
    const r = await fetch(`${base}/api/planer`, { method: 'POST', headers: { origin: `http://localhost:${world.port}` } })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: false, reason: 'Planer läuft bereits' })
    expect(calls).toContain('plan')
    expect((await fetch(`${base}/api/planer`)).status).toBe(405)
  })

  it('serves vault media under /media/Assets with the right type', async () => {
    const res = await fetch(`${base}/media/Assets/content/t1/slide.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true)
  })

  it('answers Range requests with 206 so clips and voice samples can seek', async () => {
    const part = await fetch(`${base}/media/Assets/content/t1/clip.mp4`, { headers: { range: 'bytes=10-19' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-type')).toBe('video/mp4')
    expect(part.headers.get('content-range')).toBe('bytes 10-19/100')
    expect((await part.arrayBuffer()).byteLength).toBe(10)
    const tail = await fetch(`${base}/media/Assets/content/t1/clip.mp4`, { headers: { range: 'bytes=90-' } })
    expect(tail.status).toBe(206)
    expect(tail.headers.get('content-range')).toBe('bytes 90-99/100')
    expect((await tail.arrayBuffer()).byteLength).toBe(10)
    expect((await fetch(`${base}/media/Assets/content/t1/clip.mp4`, { headers: { range: 'bytes=500-' } })).status).toBe(416)
  })

  it('never serves anything outside Assets, with .. in the path or of unknown type', async () => {
    expect((await fetch(`${base}/media/Marke/Kern.md`)).status).toBe(404)
    // encoded slashes survive URL normalisation, so the server's own segment check has to catch this one
    expect((await fetch(`${base}/media/Assets/content%2F..%2F..%2FMarke%2FKern.md`)).status).toBe(404)
    expect((await fetch(`${base}/media/Assets/content/%2e%2e/%2e%2e/Marke/Kern.md`)).status).toBe(404)
    const { request } = await import('node:http')
    const rawStatus = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: world.port, path: '/media/Assets/content/../../Marke/Kern.md', method: 'GET' }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(rawStatus).toBe(404)
    expect((await fetch(`${base}/media/Assets/content/t1/werkzeug.exe`)).status).toBe(404)
    expect((await fetch(`${base}/media/Assets/content/t1/fehlt.png`)).status).toBe(404)
    expect((await fetch(`${base}/media/Assets/content/t1`)).status).toBe(404)
    expect((await fetch(`${base}/media/Assets/content/t1/slide.png`, { method: 'POST' })).status).toBe(405)
  })

  it('answers 404 for /media when no vault root is configured', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'los-world-nomedia-'))
    await writeFile(join(publicDir, 'index.html'), '<!doctype html>', 'utf8')
    const w = await startWorld({ port: 0, getState: () => state, actions: { approve: async () => {}, pause: async () => {}, resume: async () => {} }, publicDir })
    try {
      expect((await fetch(`http://127.0.0.1:${w.port}/media/Assets/content/t1/slide.png`)).status).toBe(404)
      expect((await fetch(`http://127.0.0.1:${w.port}/api/planer`, { method: 'POST' })).status).toBe(404)
    } finally {
      await w.close()
    }
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
    // the new panels and their endpoints
    for (const needle of ['Kalender', 'Produktion', 'Fabrik', 'Stimme', 'Veröffentlicht – zuletzt', 'Planer jetzt', '/api/planer', '/media/']) {
      expect(html).toContain(needle)
    }
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/)
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/)
  })
})
