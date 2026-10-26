import { describe, it, expect, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { closeBrowser, fileUrls, loadScene, main, renderReel, renderStill, resolveScene, synthBeat, SCENES_DIR } from '../../src/adapters/studio.js'

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

const SCENES = ['t01-vorher-nachher', 't02-tippe-entscheide', 't03-drei-fehler', 't04-welches-poster-bist-du', 't07-zoom-ins-motiv', 't08-satz-des-tages', 'h01-overlay', 'karussell-slide']

function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('Produktion: Szenen und Hilfen', () => {
  it('ships every scene, lib.js, base.css and the fonts', () => {
    for (const s of SCENES) expect(existsSync(resolveScene(s)), s).toBe(true)
    for (const f of ['lib.js', 'base.css', 'fonts/Anton-Regular.ttf', 'fonts/Inter-Regular.woff2', 'fonts/Inter-Bold.woff2']) {
      expect(existsSync(join(SCENES_DIR, f)), f).toBe(true)
    }
  })

  it('injects <base>, DATA and SUBS into the scene head and turns local files into file:// URLs', async () => {
    const html = await loadScene('t01-vorher-nachher', { hook: 'Hallo </script>', poster: SCENES_DIR + '/lib.js' }, [{ start: 0, end: 1, text: 'x' }])
    expect(html).toMatch(/<head>\s*<base href="file:\/\/.*vorlagen\/">/)
    expect(html).toContain('window.DATA={"hook":"Hallo \\u003c/script>","poster":"file://')
    expect(html).toContain('window.SUBS=[{"start":0,"end":1,"text":"x"}]')
    expect(fileUrls({ a: ['nicht-da.png', SCENES_DIR + '/base.css'], b: 'https://x/y.png' })).toEqual({
      a: ['nicht-da.png', expect.stringMatching(/^file:\/\/.*base\.css$/)],
      b: 'https://x/y.png',
    })
  })

  it('synthBeat writes a valid 16-bit mono WAV of the requested length', () => {
    const wav = synthBeat({ bpm: 120, seconds: 2, sampleRate: 8000 })
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(8000)
    expect(wav.readUInt32LE(40)).toBe(16000 * 2)
    let peak = 0
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)))
    expect(peak).toBeGreaterThan(10000)
    expect(peak).toBeLessThanOrEqual(32767)
  })

  it('CLI beat writes the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-beat-'))
    const out = join(dir, 'beat.wav')
    const stdout: string[] = []
    const code = await main(['beat', '--bpm', '120', '--seconds', '1', '--out', out], env, { stdout: (s) => stdout.push(s), stderr: () => {} })
    expect(code).toBe(0)
    expect(JSON.parse(stdout.join(''))).toEqual({ ok: true, out, bpm: 120, seconds: 1 })
    expect((await stat(out)).size).toBe(44 + 44100 * 2)
  })
})

describe.skipIf(!chromiumPath)('Produktion: render-still (Chromium)', () => {
  afterAll(async () => {
    await closeBrowser()
  })

  it('renders every motion scene at t=0 and mid-way as 1080×1920 PNG with the poster loaded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-szenen-'))
    const poster = join(dir, 'poster.png')
    await renderStill({ scene: 'karussell-slide', data: { art: 'cta', end: 'Motiv' }, out: poster, width: 300, height: 420, env })
    for (const scene of SCENES.filter((s) => s !== 'karussell-slide')) {
      for (const time of [0, 5]) {
        const out = join(dir, `${scene}-${time}.png`)
        const data = scene === 't04-welches-poster-bist-du' ? { optionen: [{ poster, label: 'A' }, { poster, label: 'B' }] } : { poster, poster2: poster }
        const r = await renderStill({ scene, data, out, width: 1080, height: 1920, time, env })
        expect(r.imagesFailed, `${scene} @${time}`).toBe(0)
        if (scene !== 'h01-overlay') expect(r.imagesLoaded, `${scene} @${time}`).toBeGreaterThan(0) // the overlay scene has no poster – the clip below carries it
        expect(pngSize(await readFile(out))).toEqual({ width: 1080, height: 1920 })
      }
    }
  }, 120_000)

  it('renders the four carousel slide variants at 1080×1350', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-slides-'))
    for (const art of ['hero', 'raum', 'text', 'cta']) {
      const out = join(dir, `${art}.png`)
      await renderStill({ scene: 'karussell-slide', data: { art, hook: 'Ein Poster, fünf Stimmungen', text: 'Text', index: '1/6' }, out, width: 1080, height: 1350, env })
      expect(pngSize(await readFile(out))).toEqual({ width: 1080, height: 1350 })
    }
  }, 60_000)

  it('CLI render-still accepts --data @file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-still-'))
    const dataFile = join(dir, 'd.json')
    await writeFile(dataFile, JSON.stringify({ art: 'text', hook: 'Hallo', text: 'Welt' }), 'utf8')
    const out = join(dir, 'still.png')
    const stdout: string[] = []
    const code = await main(['render-still', '--scene', 'karussell-slide', '--data', `@${dataFile}`, '--out', out, '--size', '540x675'], env, { stdout: (s) => stdout.push(s), stderr: () => {} })
    expect(code).toBe(0)
    expect(JSON.parse(stdout.join(''))).toMatchObject({ ok: true, out, imagesFailed: 0 })
  }, 30_000)
})

describe.skipIf(!chromiumPath || !ffmpegOk)('Produktion: render-reel (Chromium + ffmpeg)', () => {
  afterAll(async () => {
    await closeBrowser()
  })

  it('renders a short reel with voice + music, subtitles, cover and stills', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-reel-'))
    const voice = join(dir, 'voice.wav')
    const music = join(dir, 'music.wav')
    await writeFile(voice, synthBeat({ bpm: 60, seconds: 0.5, sampleRate: 16000 }))
    await writeFile(music, synthBeat({ bpm: 120, seconds: 1, sampleRate: 16000 }))
    const out = join(dir, 'clip.mp4')
    const cover = join(dir, 'cover.jpg')
    const r = await renderReel({
      scene: 't08-satz-des-tages',
      data: { zeilen: ['Eins', 'zwei', 'drei.'] },
      out,
      width: 360,
      height: 640,
      fps: 8,
      duration: 1,
      audio: voice,
      music,
      subs: [{ start: 0, end: 1, text: 'Untertitel' }],
      stills: [0, 0.5],
      cover,
      env,
    })
    expect(r).toMatchObject({ out, frames: 8, duration: 1, fps: 8, audio: true, music: true, cover, imagesFailed: 0 })
    expect(r.stills).toHaveLength(2)
    for (const s of r.stills) expect((await stat(s)).size).toBeGreaterThan(1000)
    expect((await stat(cover)).size).toBeGreaterThan(1000)
    const head = await readFile(out)
    expect(head.subarray(4, 8).toString('ascii')).toBe('ftyp')
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], { encoding: 'utf8' })
    if (probe.status === 0) expect(probe.stdout).toMatch(/audio/)
  }, 120_000)

  it('lays a transparent scene over a background image or clip (Higgsfield H01) and grabs cover and stills from the result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-reel-bg-'))
    // background 1: an image (a rendered carousel slide), background 2: a clip (the first result)
    const bgImage = join(dir, 'raum.png')
    await renderStill({ scene: 'karussell-slide', data: { art: 'hero', hook: 'Raum' }, out: bgImage, width: 360, height: 640, env })
    const out1 = join(dir, 'h01-bild.mp4')
    const cover = join(dir, 'cover.jpg')
    const r1 = await renderReel({ scene: 'h01-overlay', data: { hook: 'Dein Raum', produkt: 'Tiger', detail1: 'Gerahmt' }, out: out1, width: 360, height: 640, fps: 6, duration: 1, background: bgImage, stills: [0.5], cover, env })
    expect(r1).toMatchObject({ out: out1, frames: 6, duration: 1, imagesFailed: 0, cover })
    expect((await stat(out1)).size).toBeGreaterThan(1000)
    expect((await stat(cover)).size).toBeGreaterThan(500)
    expect(r1.stills).toHaveLength(1)
    expect(pngSize(await readFile(r1.stills[0]))).toEqual({ width: 360, height: 640 })
    const stdout: string[] = []
    const out2 = join(dir, 'h01-clip.mp4')
    const code = await main(['render-reel', '--scene', 'h01-overlay', '--data', '{"hook":"Dein Raum"}', '--out', out2, '--size', '360x640', '--fps', '6', '--duration', '1', '--background', out1], env, { stdout: (s) => stdout.push(s), stderr: () => {} })
    expect(code).toBe(0)
    expect(JSON.parse(stdout.join(''))).toMatchObject({ ok: true, out: out2, frames: 6, duration: 1 })
    expect((await stat(out2)).size).toBeGreaterThan(1000)
  }, 120_000)

  it('uses window.DURATION when --duration is not given and works without any audio', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-reel2-'))
    const out = join(dir, 'clip.mp4')
    const stdout: string[] = []
    const code = await main(['render-reel', '--scene', 'karussell-slide', '--data', '{"art":"cta"}', '--out', out, '--size', '360x450', '--fps', '4'], env, { stdout: (s) => stdout.push(s), stderr: () => {} })
    expect(code).toBe(0)
    expect(JSON.parse(stdout.join(''))).toMatchObject({ ok: true, out, frames: 4, duration: 1, audio: false, music: false })
  }, 60_000)
})
