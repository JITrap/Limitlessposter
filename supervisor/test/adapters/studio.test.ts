import { describe, it, expect, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { renderImage, renderClip, closeBrowser, resolveTemplate, substitute, main } from '../../src/adapters/studio.js'

const CHROMIUM_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  (() => {
    try {
      return chromium.executablePath()
    } catch {
      return undefined
    }
  })(),
].filter((p): p is string => Boolean(p && existsSync(p)))

const chromiumPath = CHROMIUM_CANDIDATES[0]
const ffmpegOk = spawnSync('ffmpeg', ['-version']).status === 0
const env = { ...process.env, PLAYWRIGHT_CHROMIUM: chromiumPath ?? '' }

function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('substitute / resolveTemplate', () => {
  it('replaces {{key}} placeholders and blanks unknown ones', () => {
    expect(substitute('<h1>{{headline}}</h1><img src="{{poster}}">', { headline: 'Hallo' })).toBe('<h1>Hallo</h1><img src="">')
  })
  it('uses {{key|default}} when the key is missing or empty', () => {
    expect(substitute('--bg: {{bg|#0f1115}}; --a: {{accent|#f5c542}};', { accent: '' })).toBe('--bg: #0f1115; --a: #f5c542;')
    expect(substitute('{{bg|#000}}', { bg: '#fff' })).toBe('#fff')
  })
  it('resolves a bare template name to stations/studio/templates/<name>.html', () => {
    expect(resolveTemplate('carousel-slide')).toMatch(/stations[\\/]studio[\\/]templates[\\/]carousel-slide\.html$/)
    expect(resolveTemplate('/abs/x.html')).toBe('/abs/x.html')
  })
})

describe.skipIf(!chromiumPath)('renderImage (Chromium)', () => {
  afterAll(async () => {
    await closeBrowser()
  })

  it('renders a carousel slide PNG of exactly 1080×1350', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-studio-'))
    const out = join(dir, 'slide.png')
    const path = await renderImage({ template: 'carousel-slide', data: { headline: 'Ein Poster, 5 Räume', sub: 'Slide 1/5' }, width: 1080, height: 1350, out, env })
    expect(path).toBe(out)
    expect(pngSize(await readFile(out))).toEqual({ width: 1080, height: 1350 })
  })

  it('renders the room mockup even when no poster file is given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-studio-'))
    const out = join(dir, 'mockup.png')
    await renderImage({ template: 'mockup-room', data: {}, width: 1080, height: 1080, out, env })
    expect((await stat(out)).size).toBeGreaterThan(1000)
  })

  it('turns local file paths in data into file:// URLs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-studio-'))
    const poster = join(dir, 'poster.png')
    await renderImage({ template: 'carousel-slide', data: { headline: 'P' }, width: 200, height: 200, out: poster, env })
    const out = join(dir, 'with-poster.png')
    await renderImage({ template: 'mockup-room', data: { poster }, width: 400, height: 400, out, env })
    expect(pngSize(await readFile(out))).toEqual({ width: 400, height: 400 })
  })
})

describe.skipIf(!chromiumPath || !ffmpegOk)('renderClip (Chromium + ffmpeg)', () => {
  afterAll(async () => {
    await closeBrowser()
  })

  it('renders a short MP4 from the zoom template', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-clip-'))
    const out = join(dir, 'clip.mp4')
    await renderClip({ template: 'clip-zoom', data: { headline: 'Neu im Shop' }, width: 360, height: 640, seconds: 1, fps: 5, out, env })
    const size = (await stat(out)).size
    expect(size).toBeGreaterThan(1024)
    const head = await readFile(out)
    expect(head.subarray(4, 8).toString('ascii')).toBe('ftyp')
  })

  it('CLI render-clip writes the file and prints its path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-clip-'))
    const out = join(dir, 'cli.mp4')
    const stdout: string[] = []
    const code = await main(
      ['render-clip', '--template', 'clip-zoom', '--data', JSON.stringify({ headline: 'CLI' }), '--out', out, '--size', '360x640', '--seconds', '1', '--fps', '4'],
      env,
      { stdout: (s) => stdout.push(s), stderr: () => {} },
    )
    expect(code).toBe(0)
    expect(JSON.parse(stdout.join(''))).toEqual({ ok: true, out, frames: 4 })
  })
})

describe('CLI validation', () => {
  it('rejects unknown commands and bad sizes', async () => {
    const err: string[] = []
    expect(await main(['nope'], env, { stdout: () => {}, stderr: (s) => err.push(s) })).toBe(1)
    expect(err.join('')).toMatch(/render-image|render-clip/)
    expect(await main(['render-image', '--template', 'x', '--out', 'y.png', '--size', 'abc'], env, { stdout: () => {}, stderr: (s) => err.push(s) })).toBe(1)
    expect(err.join('')).toMatch(/--size/)
  })
})
