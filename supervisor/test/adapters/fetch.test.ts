// studio.js fetch – erzeugte Medien (Higgsfield) sicher in den Vault holen.
import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchFile, main } from '../../src/adapters/studio.js'

const bytes = (n: number): Uint8Array => new Uint8Array(n).map((_, i) => i % 251)

function fakeFetch(body: Uint8Array | null, init: { status?: number; type?: string; length?: string } = {}): typeof fetch {
  return (async () => {
    const headers = new Headers()
    if (init.type) headers.set('content-type', init.type)
    if (init.length) headers.set('content-length', init.length)
    return new Response(body ? new Blob([body]) : null, { status: init.status ?? 200, headers })
  }) as unknown as typeof fetch
}

describe('studio fetch', () => {
  it('downloads a media file over https into an Assets/ folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-fetch-'))
    const out = join(root, 'LimitlessOS', 'Assets', 'content', 't1', 'higgsfield.mp4')
    const r = await fetchFile({ url: 'https://cdn.higgsfield.ai/x/y.mp4', out, fetchFn: fakeFetch(bytes(5000), { type: 'video/mp4' }) })
    expect(r).toEqual({ out, bytes: 5000, contentType: 'video/mp4' })
    expect((await readFile(out)).length).toBe(5000)
    expect((await stat(out)).size).toBe(5000)
  })

  it('refuses http, paths outside Assets/, non-media types, oversized and empty answers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-fetch-'))
    const ok = join(root, 'Assets', 'content', 't1', 'a.png')
    await expect(fetchFile({ url: 'http://cdn.higgsfield.ai/x.png', out: ok, fetchFn: fakeFetch(bytes(10), { type: 'image/png' }) })).rejects.toThrow(/https/)
    await expect(fetchFile({ url: 'https://cdn.higgsfield.ai/x.png', out: join(root, 'Marke', 'a.png'), fetchFn: fakeFetch(bytes(10), { type: 'image/png' }) })).rejects.toThrow(/Assets/)
    await expect(fetchFile({ url: 'https://cdn.higgsfield.ai/x.png', out: join(root, 'Assets', '..', 'x.png'), fetchFn: fakeFetch(bytes(10), { type: 'image/png' }) })).rejects.toThrow(/Assets/)
    await expect(fetchFile({ url: 'https://cdn.higgsfield.ai/x', out: join(root, 'Assets', 'x.exe'), fetchFn: fakeFetch(bytes(10), { type: 'image/png' }) })).rejects.toThrow(/Endung/)
    await expect(fetchFile({ url: 'https://cdn.higgsfield.ai/x.png', out: ok, fetchFn: fakeFetch(bytes(10), { type: 'text/html' }) })).rejects.toThrow(/Mediendatei/)
    await expect(fetchFile({ url: 'https://cdn.higgsfield.ai/x.png', out: ok, fetchFn: fakeFetch(bytes(10), { type: 'image/png', status: 404 }) })).rejects.toThrow(/HTTP 404/)
    await expect(fetchFile({ url: 'https://cdn.higgsfield.ai/x.png', out: ok, fetchFn: fakeFetch(bytes(3000), { type: 'image/png' }), maxBytes: 2000 })).rejects.toThrow(/zu groß/)
    await expect(fetchFile({ url: 'https://cdn.higgsfield.ai/x.png', out: ok, fetchFn: fakeFetch(bytes(10), { type: 'image/png', length: '999999999' }) })).rejects.toThrow(/zu groß/)
    await expect(fetchFile({ url: 'https://cdn.higgsfield.ai/x.png', out: ok, fetchFn: fakeFetch(new Uint8Array(0), { type: 'image/png' }) })).rejects.toThrow(/leere/)
    await expect(stat(ok)).rejects.toThrow()
    await expect(stat(`${ok}.teil`)).rejects.toThrow()
  })

  it('CLI fetch needs --url and --out', async () => {
    const err: string[] = []
    expect(await main(['fetch', '--url', 'https://x/y.png'], process.env, { stdout: () => {}, stderr: (s) => err.push(s) })).toBe(1)
    expect(err.join('')).toContain('fetch --url')
  })
})
