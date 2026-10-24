// Produktion sichtbar machen: Listing von Assets/content für die Galerie der Welt und die Stimme-Datei.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listMedien,
  listMedienCached,
  loadStimmeCached,
  medienTyp,
  medienUrl,
  parseStimme,
  MEDIEN_CACHE_MS,
  MEDIEN_MIME,
  STIMME_LEER,
} from '../../src/medien.js'

const stampOf = (iso: string): Date => new Date(iso)

describe('listMedien', () => {
  let vault: string

  beforeAll(async () => {
    vault = await mkdtemp(join(tmpdir(), 'los-medien-'))
    const content = join(vault, 'Assets', 'content')
    await mkdir(join(content, 't1', 'tief', 'tiefer', 'noch', 'zu-tief'), { recursive: true })
    await mkdir(join(content, 'Stimme Übung'), { recursive: true })
    await mkdir(join(vault, 'Aufgaben'), { recursive: true })
    await writeFile(join(vault, 'Aufgaben', 't1.md'), '---\nid: t1\ntitle: Karussell 5 Räume\nstatus: done\n---\n## Auftrag\nx\n', 'utf8')

    const put = async (rel: string[], bytes: number, iso: string): Promise<void> => {
      const file = join(content, ...rel)
      await writeFile(file, Buffer.alloc(bytes, 1))
      await utimes(file, stampOf(iso), stampOf(iso))
    }
    await put(['t1', 'slide-1.png'], 10, '2026-10-22T09:00:00')
    await put(['t1', 'clip.mp4'], 20, '2026-10-22T11:00:00')
    await put(['t1', 'caption.txt'], 5, '2026-10-22T08:00:00')
    await put(['Stimme Übung', 'probe.wav'], 7, '2026-10-22T10:00:00')
    await put(['lose.png'], 1, '2026-10-22T07:00:00')
    await put(['t1', 'tief', 'tiefer', 'noch', 'tief-genug.png'], 1, '2026-10-22T06:00:00')
    // ignored: dotfiles, unknown types, too deep
    await put(['t1', '.versteckt.png'], 1, '2026-10-22T12:00:00')
    await put(['t1', 'werkzeug.exe'], 1, '2026-10-22T12:00:00')
    await put(['t1', 'tief', 'tiefer', 'noch', 'zu-tief', 'x.png'], 1, '2026-10-22T12:00:00')
  })

  it('lists newest first with type, task and a browser URL, skipping dotfiles, odd types and deep folders', async () => {
    const list = await listMedien(vault)
    expect(list.map((m) => m.pfad)).toEqual([
      'Assets/content/t1/clip.mp4',
      'Assets/content/Stimme Übung/probe.wav',
      'Assets/content/t1/slide-1.png',
      'Assets/content/t1/caption.txt',
      'Assets/content/lose.png',
      'Assets/content/t1/tief/tiefer/noch/tief-genug.png',
    ])
    expect(list.map((m) => m.typ)).toEqual(['video', 'audio', 'bild', 'text', 'bild', 'bild'])
    const clip = list[0]
    expect(clip).toMatchObject({ aufgabe: 't1', titel: 'Karussell 5 Räume', groesse: 20, geaendert: '2026-10-22T11:00:00', url: '/media/Assets/content/t1/clip.mp4' })
    const probe = list[1]
    expect(probe).toMatchObject({ aufgabe: 'Stimme Übung', titel: 'Stimme Übung', url: '/media/Assets/content/Stimme%20%C3%9Cbung/probe.wav' })
    expect(list[4]).toMatchObject({ aufgabe: '(Ordner)', titel: '(Ordner)' })
  })

  it('respects the limit and an empty or missing folder', async () => {
    expect(await listMedien(vault, 2)).toHaveLength(2)
    const empty = await mkdtemp(join(tmpdir(), 'los-medien-leer-'))
    expect(await listMedien(empty)).toEqual([])
  })

  it('caches the listing for 30 seconds', async () => {
    const t0 = new Date('2026-10-22T12:00:00')
    const first = await listMedienCached(vault, null, t0)
    expect(first.value).toHaveLength(6)
    const again = await listMedienCached(vault, first, new Date(t0.getTime() + MEDIEN_CACHE_MS - 1))
    expect(again).toBe(first)
    const fresh = await listMedienCached(vault, first, new Date(t0.getTime() + MEDIEN_CACHE_MS))
    expect(fresh).not.toBe(first)
    expect(fresh.value).toHaveLength(6)
  })

  it('knows the media types and MIME map the /media route relies on', () => {
    expect(medienTyp('a.PNG')).toBe('bild')
    expect(medienTyp('a.webm')).toBe('video')
    expect(medienTyp('a.mp3')).toBe('audio')
    expect(medienTyp('a.srt')).toBe('text')
    expect(medienTyp('a.exe')).toBeNull()
    expect(MEDIEN_MIME['.wav']).toBe('audio/wav')
    expect(MEDIEN_MIME['.exe']).toBeUndefined()
    expect(medienUrl('Assets/content/t1/Räume & Co.png')).toBe('/media/Assets/content/t1/R%C3%A4ume%20%26%20Co.png')
  })
})

describe('Stimme (stimme.json)', () => {
  it('parses a well-formed file and normalises Windows paths', () => {
    const v = parseStimme(
      JSON.stringify({ installed: true, engine: 'chatterbox', cuda: true, voices: ['julius', 'thorsten'], lastSample: 'Assets\\content\\stimme\\probe.wav', lastError: '', updated: '2026-10-24T09:00:00' }),
    )
    expect(v).toEqual({ installed: true, engine: 'chatterbox', cuda: true, voices: ['julius', 'thorsten'], lastSample: 'Assets/content/stimme/probe.wav', lastError: null, updated: '2026-10-24T09:00:00' })
  })

  it('tolerates unknown engines, missing fields and broken JSON', () => {
    expect(parseStimme(JSON.stringify({ installed: true, engine: 'elevenlabs' }))).toMatchObject({ installed: true, engine: null, cuda: false, voices: [] })
    expect(parseStimme('{nicht json')).toEqual({ ...STIMME_LEER, lastError: 'stimme.json nicht lesbar' })
  })

  it('loads from the data dir by mtime and reports „nicht installiert“ when the file is missing', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'los-stimme-'))
    expect((await loadStimmeCached(dataDir, null)).value).toEqual(STIMME_LEER)
    const file = join(dataDir, 'stimme.json')
    await writeFile(file, JSON.stringify({ installed: true, engine: 'piper', voices: ['de_DE-thorsten'] }), 'utf8')
    const first = await loadStimmeCached(dataDir, null)
    expect(first.value).toMatchObject({ installed: true, engine: 'piper', cuda: false, voices: ['de_DE-thorsten'] })
    expect(await loadStimmeCached(dataDir, first)).toBe(first)
    await writeFile(file, JSON.stringify({ installed: false, lastError: 'CUDA fehlt' }), 'utf8')
    await utimes(file, new Date(first.mtimeMs + 5000), new Date(first.mtimeMs + 5000))
    const second = await loadStimmeCached(dataDir, first)
    expect(second).not.toBe(first)
    expect(second.value).toMatchObject({ installed: false, lastError: 'CUDA fehlt' })
  })
})
