import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  countForDay, findDuplicate, isStale, loadPublog, mergeEntries, normalizeDate, normalizeText, parsePublog, renderPublog, savePublog, similarity, textKey, toEntry,
} from '../src/publog.js'

const now = new Date('2026-10-24T18:00:00')
const willkommen = 'Willkommen bei LimitlessPoster 🖤 Gerahmte Poster mit Haltung.\n\n#poster  #zimmerdeko  #roomdecor  #kleinunternehmen #posters'
const willkommen2 = 'Willkommen bei LimitlessPoster. 🖤\n\nGerahmte Poster mit Haltung – Motivation, Sport, Quiet Luxury. Gerahmt geliefert, kostenloser Versand in Deutschland.\nWelches Motiv soll als Nächstes ins Rampenlicht? 👇\n\n👉 Link in Bio\n\n#poster #postershop #wanddeko #zimmerdeko #motivation'

describe('publog – normalization', () => {
  it('drops links, hashtags, mentions, emojis and punctuation', () => {
    expect(normalizeText('Er hatte recht. 💀 Welches Poster?\n👉 limitlessposter.com\n\n#zimmerdeko @x')).toBe('er hatte recht welches poster')
  })
  it('keys are stable and independent of hashtags', () => {
    expect(textKey('Hallo Welt #a')).toBe(textKey('hallo   welt! #b'))
    expect(textKey('Hallo Welt')).not.toBe(textKey('Hallo Wand'))
  })
  it('similarity is Jaccard over words', () => {
    expect(similarity('ein zwei drei vier', 'ein zwei drei vier')).toBe(1)
    expect(similarity('ein zwei drei vier', 'fünf sechs')).toBe(0)
    expect(similarity('poster gerahmt geliefert versand', 'poster gerahmt geliefert heute')).toBeCloseTo(0.6, 1)
  })
  it('normalizeDate accepts Metricool compact stamps and ISO', () => {
    expect(normalizeDate('20261012151251')).toBe('2026-10-12T15:12')
    expect(normalizeDate('2026-10-24T12:00:00+02:00')).toBe('2026-10-24T12:00')
    expect(normalizeDate('2026-10-24')).toBe('2026-10-24T00:00')
  })
})

describe('publog – the guard', () => {
  const entries = [
    toEntry({ network: 'instagram', date: '20261012151251', type: 'post', text: willkommen, url: 'https://www.instagram.com/p/DeZhypQCnu1/' }),
    toEntry({ network: 'instagram', date: '2026-10-12T15:47', type: 'reel', text: 'Er hatte recht. 💀 Welches Poster hättest du genommen?\n👉 limitlessposter.com\n\n#zimmerdeko', media: ['https://cdn.shopify.com/s/files/1/x/files/limitlessos-cb-r01.mp4?v=1'] }),
    toEntry({ network: 'tiktok', date: '2026-10-13T12:03', type: 'video', text: 'Erste eigene Wohnung: Was kommt über das kleine Sofa? Ein Leopard in Schwarz-Weiß, 91 × 61 cm quer.' }),
    toEntry({ network: 'instagram', date: '2026-06-01T10:00', type: 'post', text: 'Uralter Text über Poster und Rahmen für die erste Wohnung', status: 'veröffentlicht' }),
    toEntry({ network: 'instagram', date: '2026-10-20T10:00', type: 'post', text: 'Storniertes Experiment mit Leopard Panther Tiger', status: 'storniert' }),
  ]
  it('catches the 24.10. duplicate of the welcome post (same beginning, different hashtags)', () => {
    const hit = findDuplicate({ network: 'instagram', text: willkommen2 }, entries, now)
    expect(hit?.entry.url).toBe('https://www.instagram.com/p/DeZhypQCnu1/')
    expect(['anfang', 'aehnlich', 'text']).toContain(hit!.reason)
  })
  it('catches the same media file even with a new caption', () => {
    const hit = findDuplicate({ network: 'instagram', text: 'Völlig neuer Text ohne jede Ähnlichkeit', media: ['https://cdn.shopify.com/s/files/1/x/files/limitlessos-cb-r01.mp4'] }, entries, now)
    expect(hit?.reason).toBe('medien')
  })
  it('treats a cross-post on another network as new', () => {
    expect(findDuplicate({ network: 'tiktok', text: willkommen }, entries, now)).toBeNull()
  })
  it('ignores cancelled and very old entries', () => {
    expect(findDuplicate({ network: 'instagram', text: 'Storniertes Experiment mit Leopard Panther Tiger' }, entries, now)).toBeNull()
    expect(findDuplicate({ network: 'instagram', text: 'Uralter Text über Poster und Rahmen für die erste Wohnung' }, entries, now)).toBeNull()
  })
  it('lets a genuinely new text through', () => {
    expect(findDuplicate({ network: 'instagram', text: 'Drei Regeln für die Bilderwand im Flur: Kante, Abstand, Licht. Welche fehlt bei dir?' }, entries, now)).toBeNull()
  })
  it('counts scheduled and published posts per network and day', () => {
    const log = [
      toEntry({ network: 'instagram', date: '2026-10-24T12:00', text: 'a', status: 'veröffentlicht' }),
      toEntry({ network: 'instagram', date: '2026-10-24T18:30', text: 'b', status: 'geplant' }),
      toEntry({ network: 'instagram', date: '2026-10-24T20:00', text: 'c', status: 'entwurf' }),
      toEntry({ network: 'tiktok', date: '2026-10-24T18:30', text: 'd', status: 'geplant' }),
    ]
    expect(countForDay(log, 'instagram', '2026-10-24')).toBe(2)
    expect(countForDay(log, 'tiktok', '2026-10-24')).toBe(1)
    expect(countForDay(log, 'instagram', '2026-10-25')).toBe(0)
  })
  it('isStale after 12 hours or when never synced', () => {
    expect(isStale(null, now)).toBe(true)
    expect(isStale({ synced: '2026-10-24T07:00:00', entries: [] }, now)).toBe(false)
    expect(isStale({ synced: '2026-10-23T05:00:00', entries: [] }, now)).toBe(true)
  })
})

describe('publog – note format', () => {
  it('renders and parses back, merges by url and by text+day', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publog-'))
    const base = mergeEntries({ synced: null, entries: [] }, [
      { network: 'instagram', date: '2026-10-24T12:00', type: 'post', status: 'geplant', text: willkommen2, url: 'https://app.metricool.com/planner/calendar?openWithPostUuid=721', media: ['https://static.metricool.com/planner/202610/7412016-file-5.jpeg'] },
      { network: 'tiktok', date: '2026-10-25T18:30', type: 'photos', status: 'geplant', text: 'Welches ist deins? 1–5 👇 | mit Pipe', quelle: 'content:x' },
    ])
    expect(base.added).toBe(2)
    base.log.synced = '2026-10-24T17:00:00'
    await savePublog(dir, base.log)
    const text = await readFile(join(dir, 'Pläne', 'Veröffentlicht.md'), 'utf8')
    expect(text).toContain('type: veroeffentlichungen')
    expect(text).toContain('| 2026-10-25T18:30 | tiktok | photos | geplant |')
    const back = await loadPublog(dir)
    expect(back.synced).toBe('2026-10-24T17:00:00')
    expect(back.entries).toHaveLength(2)
    expect(back.entries.find((e) => e.network === 'tiktok')?.text).toContain('¦')
    // same url → update status, no new row
    const m2 = mergeEntries(back, [{ network: 'instagram', date: '2026-10-24T12:00', text: willkommen2, status: 'veröffentlicht', url: 'https://app.metricool.com/planner/calendar?openWithPostUuid=721' }])
    expect(m2.added).toBe(0)
    expect(m2.updated).toBe(1)
    expect(m2.log.entries.find((e) => e.network === 'instagram')?.status).toBe('veröffentlicht')
    // same text same day without url → update too
    const m3 = mergeEntries(back, [{ network: 'tiktok', date: '2026-10-25T18:30', text: 'Welches ist deins? 1–5 👇 | mit Pipe', status: 'veröffentlicht', url: 'https://www.tiktok.com/@x/video/1' }])
    expect(m3.updated).toBe(1)
    expect(parsePublog(renderPublog(m3.log)).entries.find((e) => e.network === 'tiktok')?.url).toBe('https://www.tiktok.com/@x/video/1')
  })
})
