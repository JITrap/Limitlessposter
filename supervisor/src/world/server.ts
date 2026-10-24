import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { SupervisorState } from '../status/writer.js'
import { MEDIEN_MIME } from '../medien.js'

export interface WorldActions {
  approve: (id: string) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  /** Zentrale button: collect fresh numbers now. Optional for older callers. */
  refreshKennzahlen?: () => Promise<{ ok: boolean; reason: string | null }>
  /** Fabrik button: start a planner run now. Optional for older callers. */
  plan?: () => Promise<{ ok: boolean; reason: string | null }>
}

export interface WorldOptions {
  port: number
  host?: string
  getState: () => SupervisorState
  actions: WorldActions
  publicDir: string
  /** `<Vault>/LimitlessOS` – only its `Assets/` subtree is served under /media/ (previews in the Produktion panel). */
  mediaRoot?: string
}

export interface WorldEvent {
  type: string
  data: unknown
}

export interface WorldHandle {
  port: number
  close(): Promise<void>
  broadcast(ev: WorldEvent): void
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

const HEARTBEAT_MS = 15_000

/** JSON with Sets as arrays and Dates as ISO strings. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v instanceof Set ? [...v] : v instanceof Date ? v.toISOString() : v))
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(toJson(body))
}

/**
 * „Die Welt“: localhost-only HTTP server with the static page, a JSON state
 * endpoint, an SSE stream and the approve/pause/resume actions (spec §9).
 */
export async function startWorld(opts: WorldOptions): Promise<WorldHandle> {
  const host = opts.host ?? '127.0.0.1'
  const publicRoot = resolve(opts.publicDir)
  const clients = new Set<ServerResponse>()

  const send = (res: ServerResponse, ev: WorldEvent): void => {
    res.write(`event: ${ev.type}\ndata: ${toJson(ev.data)}\n\n`)
  }

  const serveStatic = async (urlPath: string, res: ServerResponse): Promise<void> => {
    const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.replace(/^\/+/, ''))
    const file = resolve(publicRoot, rel)
    if (file !== publicRoot && !file.startsWith(publicRoot + sep)) return json(res, 404, { error: 'Nicht gefunden' })
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file')
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch {
      json(res, 404, { error: 'Nicht gefunden' })
    }
  }

  /**
   * /media/Assets/… → `<mediaRoot>/Assets/…`. Only the Assets subtree, never `..`, only known
   * media types; videos/audio get simple Range support so the browser can seek.
   */
  const assetsRoot = opts.mediaRoot ? resolve(opts.mediaRoot, 'Assets') : null
  const serveMedia = async (urlPath: string, req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!assetsRoot) return json(res, 404, { error: 'Nicht gefunden' })
    let rel: string
    try {
      rel = decodeURIComponent(urlPath.replace(/^\/media\/+/, ''))
    } catch {
      return json(res, 404, { error: 'Nicht gefunden' })
    }
    if (!rel.startsWith('Assets/') || rel.split(/[\\/]/).some((seg) => seg === '..' || seg === '' || seg.startsWith('.'))) {
      return json(res, 404, { error: 'Nicht gefunden' })
    }
    const file = resolve(opts.mediaRoot!, rel)
    if (!file.startsWith(assetsRoot + sep)) return json(res, 404, { error: 'Nicht gefunden' })
    const mime = MEDIEN_MIME[extname(file).toLowerCase()]
    if (!mime) return json(res, 404, { error: 'Nicht gefunden' })
    let size: number
    try {
      const st = await stat(file)
      if (!st.isFile()) throw new Error('not a file')
      size = st.size
    } catch {
      return json(res, 404, { error: 'Nicht gefunden' })
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}` })
        res.end()
        return
      }
      res.writeHead(206, { 'content-type': mime, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-store' })
      createReadStream(file, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, { 'content-type': mime, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' })
    createReadStream(file).pipe(res)
  }

  // State-changing requests must come from the page itself: a foreign Origin (any
  // website in Julius' browser) or a foreign Host (DNS rebinding) is refused.
  const isLocal = (value: string | undefined): boolean => {
    if (!value) return true
    try {
      const h = value.includes('://') ? new URL(value).hostname : value.replace(/:\d+$/, '')
      return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
    } catch {
      return false
    }
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${host}`)
    const path = url.pathname
    const method = req.method ?? 'GET'
    if (method === 'POST' && (!isLocal(req.headers.origin) || !isLocal(req.headers.host))) {
      return json(res, 403, { error: 'Nur von der Welt-Seite selbst erlaubt' })
    }

    if (path === '/api/state') {
      if (method !== 'GET') return json(res, 405, { error: 'Methode nicht erlaubt' })
      return json(res, 200, opts.getState())
    }
    if (path === '/events') {
      if (method !== 'GET') return json(res, 405, { error: 'Methode nicht erlaubt' })
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      res.write(': verbunden\n\n')
      clients.add(res)
      send(res, { type: 'state', data: opts.getState() })
      req.on('close', () => clients.delete(res))
      return
    }
    const approve = /^\/api\/approve\/([^/]+)$/.exec(path)
    if (approve) {
      if (method !== 'POST') return json(res, 405, { error: 'Methode nicht erlaubt' })
      await opts.actions.approve(decodeURIComponent(approve[1]))
      return json(res, 200, { ok: true })
    }
    if (path === '/api/kennzahlen/refresh') {
      if (method !== 'POST') return json(res, 405, { error: 'Methode nicht erlaubt' })
      if (!opts.actions.refreshKennzahlen) return json(res, 404, { error: 'Nicht verfügbar' })
      return json(res, 200, await opts.actions.refreshKennzahlen())
    }
    if (path === '/api/pause' || path === '/api/resume') {
      if (method !== 'POST') return json(res, 405, { error: 'Methode nicht erlaubt' })
      await (path === '/api/pause' ? opts.actions.pause() : opts.actions.resume())
      return json(res, 200, { ok: true })
    }
    if (path === '/api/planer') {
      if (method !== 'POST') return json(res, 405, { error: 'Methode nicht erlaubt' })
      if (!opts.actions.plan) return json(res, 404, { error: 'Nicht verfügbar' })
      return json(res, 200, await opts.actions.plan())
    }
    if (path.startsWith('/api/')) return json(res, 404, { error: 'Nicht gefunden' })
    if (method !== 'GET') return json(res, 405, { error: 'Methode nicht erlaubt' })
    if (path.startsWith('/media/')) return serveMedia(path, req, res)
    return serveStatic(path, res)
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      else res.end()
    })
  })

  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n')
  }, HEARTBEAT_MS)
  heartbeat.unref()

  await new Promise<void>((ok, fail) => {
    server.once('error', fail)
    server.listen(opts.port, host, () => ok())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : opts.port

  return {
    port,
    broadcast(ev) {
      for (const c of clients) send(c, ev)
    },
    async close() {
      clearInterval(heartbeat)
      for (const c of clients) c.end()
      clients.clear()
      await new Promise<void>((ok) => server.close(() => ok()))
    },
  }
}

/** Where the static page lives – served straight from the source tree, no copy step. */
export function defaultPublicDir(repoRoot: string): string {
  return join(repoRoot, 'supervisor', 'src', 'world', 'public')
}
