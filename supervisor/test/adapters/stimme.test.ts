import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureServer, getStatus, main, readStatusFile, resolvePython, serverUrl, speak, toSubs } from '../../src/adapters/stimme.js'

function tinyWav(samples = 2400, sr = 24000): Buffer {
  const b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + samples * 2, 4)
  b.write('WAVE', 8)
  b.write('fmt ', 12)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(sr, 24)
  b.writeUInt32LE(sr * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(samples * 2, 40)
  return b
}

let server: Server
let port = 0
const requests: Array<{ path: string; body: unknown }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      requests.push({ path: req.url ?? '', body: raw ? JSON.parse(raw) : null })
      const json = (code: number, body: unknown): void => {
        res.writeHead(code, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.url?.startsWith('/status')) {
        json(200, { ok: true, engine: 'piper', cuda: false, model_loaded: true, voices: [{ id: 'thorsten', art: 'eingebaut', engine: 'piper' }, { id: 'julius', art: 'eigene', engine: 'chatterbox' }], fehler: [], python: '3.12.1' })
      } else if (req.url?.startsWith('/speak')) {
        const body = JSON.parse(raw) as { text: string }
        if (!body.text.trim()) return json(400, { ok: false, fehler: 'text fehlt' })
        json(200, {
          ok: true,
          engine: 'piper',
          wav_base64: tinyWav().toString('base64'),
          sample_rate: 24000,
          duration: 2.4,
          segments: [
            { text: 'Dein Zimmer sagt mehr über dich als dein Outfit und als alles, was du sonst so trägst.', start: 0, end: 1.6 },
            { text: 'Ehrlich.', start: 1.92, end: 2.4 },
          ],
          text: body.text,
        })
      } else {
        json(404, { ok: false, fehler: 'nein' })
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as { port: number }).port
})

afterAll(() => {
  server.close()
})

describe('stimme adapter', () => {
  it('serverUrl honours STIMME_PORT and getStatus returns null when nothing listens', async () => {
    expect(serverUrl({ STIMME_PORT: '4999' })).toBe('http://127.0.0.1:4999')
    expect(serverUrl({})).toBe('http://127.0.0.1:4243')
    expect(await getStatus({ STIMME_PORT: '1' })).toBeNull()
  })

  it('refuses to autostart when STIMME_NO_AUTOSTART=1 and no server runs', async () => {
    await expect(ensureServer({ env: { STIMME_PORT: '1', STIMME_NO_AUTOSTART: '1' } })).rejects.toThrow(/läuft nicht/)
  })

  it('resolvePython prefers STIMME_PYTHON and otherwise finds a python or returns null', () => {
    expect(resolvePython({ STIMME_PYTHON: '/x/python' }, '/nope')).toEqual({ cmd: '/x/python', args: [] })
    const found = resolvePython({}, '/nope')
    expect(found === null || typeof found.cmd === 'string').toBe(true)
  })

  it('speak writes WAV + timeline and updates supervisor/data/stimme.json with a vault-relative sample path', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'los-stimme-repo-'))
    const vault = join(repoRoot, 'vault', 'LimitlessOS')
    const out = join(vault, 'Assets', 'content', 'task-1', 'stimme.wav')
    const env = { STIMME_PORT: String(port), STIMME_NO_AUTOSTART: '1' }
    const r = await speak({ text: 'Dein Zimmer sagt mehr über dich als dein Outfit. Ehrlich.', out, voice: 'julius', speed: 1.1, env, repoRoot, vaultRoot: vault })
    expect(r.engine).toBe('piper')
    expect(r.duration).toBe(2.4)
    expect(r.segments).toHaveLength(2)
    expect((await readFile(out)).subarray(0, 4).toString('ascii')).toBe('RIFF')
    const timeline = JSON.parse(await readFile(`${out}.json`, 'utf8')) as { segments: unknown[]; sample_rate: number }
    expect(timeline.sample_rate).toBe(24000)
    expect(timeline.segments).toHaveLength(2)
    const status = await readStatusFile(repoRoot)
    expect(status).toMatchObject({ installed: true, engine: 'piper', cuda: false, voices: ['thorsten', 'julius'], lastSample: 'Assets/content/task-1/stimme.wav', lastError: null, python: '3.12.1' })
    expect(status?.updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    const sent = requests.find((q) => q.path.startsWith('/speak'))?.body as { voice: string; speed: number; language: string }
    expect(sent).toMatchObject({ voice: 'julius', speed: 1.1, language: 'de' })
  })

  it('records lastError in stimme.json when the server fails', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'los-stimme-err-'))
    const env = { STIMME_PORT: String(port), STIMME_NO_AUTOSTART: '1' }
    await expect(speak({ text: '   ', out: join(repoRoot, 'x.wav'), env, repoRoot, vaultRoot: repoRoot })).rejects.toThrow(/Kein Text/)
    const env2 = { STIMME_PORT: '1', STIMME_NO_AUTOSTART: '1' }
    await expect(speak({ text: 'Hallo', out: join(repoRoot, 'x.wav'), env: env2, repoRoot, vaultRoot: repoRoot })).rejects.toThrow(/läuft nicht/)
    expect((await readStatusFile(repoRoot))?.lastError).toMatch(/läuft nicht/)
  })

  it('toSubs splits long sentences into blocks ≤ 42 characters with proportional timing', () => {
    const subs = toSubs([
      { text: 'Dein Zimmer sagt mehr über dich als dein Outfit und als alles, was du sonst so trägst.', start: 0, end: 1.6 },
      { text: 'Ehrlich.', start: 1.92, end: 2.4 },
    ])
    expect(subs.length).toBeGreaterThanOrEqual(3)
    for (const s of subs) expect(s.text.length).toBeLessThanOrEqual(42)
    expect(subs[0].start).toBe(0)
    expect(subs[subs.length - 1]).toEqual({ start: 1.92, end: 2.4, text: 'Ehrlich.' })
    const before = subs.slice(0, -1)
    expect(before[before.length - 1].end).toBeCloseTo(1.6, 2)
  })

  it('CLI status/speak/stop work against the fake server', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'los-stimme-cli-'))
    const env = { STIMME_PORT: String(port), STIMME_NO_AUTOSTART: '1' }
    const logs: string[] = []
    const orig = console.log
    console.log = (s: string) => logs.push(String(s))
    try {
      expect(await main(['status'], env, repoRoot)).toBe(0)
      expect(JSON.parse(logs[0])).toMatchObject({ ok: true, laeuft: true, server: { engine: 'piper' } })
      const out = join(repoRoot, 'a.wav')
      expect(await main(['speak', '--text', 'Hallo Welt.', '--out', out], env, repoRoot)).toBe(0)
      expect(JSON.parse(logs[1])).toMatchObject({ ok: true, out, engine: 'piper', saetze: 2 })
      expect((await stat(out)).size).toBeGreaterThan(44)
      expect(await main(['speak', '--out', out], env, repoRoot)).toBe(1)
      expect(await main(['stop'], env, repoRoot)).toBe(0)
    } finally {
      console.log = orig
    }
  })
})
