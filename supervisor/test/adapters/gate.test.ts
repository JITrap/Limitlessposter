import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, normalizePlatform, parseGateOutput, planFromPost, runGate } from '../../src/adapters/gate.js'
import { resolvePython } from '../../src/adapters/stimme.js'

const pythonOk = resolvePython({}) !== null

const goodTikTok = {
  text: 'Dein Zimmer sagt mehr über dich als dein Outfit. Welches Poster passt zu dir? #poster #wanddeko #zimmerinspo #limitlessposter',
  media: ['https://cdn.shopify.com/s/files/x/reel.mp4', 'https://cdn.shopify.com/s/files/x/cover.jpg'],
  providers: [{ network: 'tiktok' }],
  publicationDate: { dateTime: '2026-10-25T12:30:00', timezone: 'Europe/Berlin' },
  tiktokData: { title: 'Dein Zimmer sagt mehr über dich als dein Outfit' },
}

const badTikTok = {
  text: 'Nur heute 20% Rabatt auf alle Poster, Lieferung in 2 Tagen garantiert! Premium Leinwand für 79,99 € #poster',
  media: ['https://cdn.shopify.com/s/files/x/reel.mp4'],
  providers: [{ network: 'tiktok' }],
  publicationDate: { dateTime: '2026-10-25T12:30:00', timezone: 'Europe/Berlin' },
  tiktokData: { title: '' },
}

describe('gate adapter: plan from a Metricool post', () => {
  it('maps a TikTok video post to a gate item with the plan document shape', () => {
    const plan = planFromPost('tiktok', goodTikTok) as { date: string; platform: string; source: unknown; items: Array<Record<string, unknown>> }
    expect(plan.date).toBe('2026-10-25')
    expect(plan.platform).toBe('tiktok')
    expect(plan.source).toEqual({ collection: 'days', date: '2026-10-25' })
    expect(plan.items[0]).toMatchObject({
      id: '2026-10-25-tt1',
      type: 'video',
      caption: goodTikTok.text,
      slot: { time: '12:30' },
      media: { main: goodTikTok.media[0], poster: goodTikTok.media[1] },
      network: { title: goodTikTok.tiktokData.title },
    })
  })

  it('maps an Instagram carousel with products, alt texts and the product link from the text', () => {
    const plan = planFromPost(
      'instagram',
      { text: 'Berge im Morgenlicht hängt jetzt da. https://limitlessposter.com/products/berge-im-morgenlicht #poster #wand #deko', media: ['a.png', 'b.png', 'c.png'], mediaAltText: ['A', null, 'C'] },
      { products: [['berge-im-morgenlicht', 'Berge im Morgenlicht']], date: '2026-11-01', time: '07:30' },
    ) as { items: Array<Record<string, unknown>> }
    expect(plan.items[0]).toMatchObject({
      id: '2026-11-01-ig1',
      type: 'post',
      products: [['berge-im-morgenlicht', 'Berge im Morgenlicht']],
      link: 'https://limitlessposter.com/products/berge-im-morgenlicht',
      alt: ['A', '', 'C'],
      media: { slides: ['a.png', 'b.png', 'c.png'] },
      slot: { time: '07:30' },
    })
  })

  it('normalises platform names (gmb → gbp) and rejects unknown ones', () => {
    expect(normalizePlatform('GMB')).toBe('gbp')
    expect(normalizePlatform('Instagram')).toBe('instagram')
    expect(() => normalizePlatform('pinterest')).toThrow(/Unbekannte Plattform/)
  })

  it('parses PASS/SKIP lines', () => {
    expect(parseGateOutput('PASS 2026-10-25-tt1\nSKIP 2026-10-25-tt2: Hashtags: 1, erlaubt 3–5; Preis in Caption nicht erlaubt\n')).toEqual([
      { id: '2026-10-25-tt1', passed: true, reasons: [] },
      { id: '2026-10-25-tt2', passed: false, reasons: ['Hashtags: 1, erlaubt 3–5', 'Preis in Caption nicht erlaubt'] },
    ])
  })
})

describe.skipIf(!pythonOk)('gate adapter: runs stations/produktion/gate.py', () => {
  it('passes a clean TikTok post and skips a bad one with reasons', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-gate-'))
    const good = join(dir, 'good.json')
    const bad = join(dir, 'bad.json')
    await writeFile(good, JSON.stringify(planFromPost('tiktok', goodTikTok)), 'utf8')
    await writeFile(bad, JSON.stringify(planFromPost('tiktok', badTikTok)), 'utf8')
    const ok = await runGate('tiktok', good)
    expect(ok.code, ok.stderr).toBe(0)
    expect(ok.results).toEqual([{ id: '2026-10-25-tt1', passed: true, reasons: [] }])
    const no = await runGate('tiktok', bad)
    expect(no.code).toBe(1)
    expect(no.results[0].passed).toBe(false)
    expect(no.results[0].reasons.join(' ')).toMatch(/rabatt/i)
    expect(no.results[0].reasons.join(' ')).toMatch(/Hashtags/)
    expect(no.results[0].reasons.join(' ')).toMatch(/network\.title fehlt/)
  }, 30_000)

  it('CLI --post wraps a Metricool post file and returns the gate exit code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-gate-cli-'))
    const post = join(dir, 'post-tiktok.json')
    await writeFile(post, JSON.stringify(goodTikTok), 'utf8')
    const chunks: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((s: string) => {
      chunks.push(String(s))
      return true
    }) as typeof process.stdout.write
    try {
      expect(await main(['tiktok', '--post', post])).toBe(0)
    } finally {
      process.stdout.write = orig
    }
    expect(chunks.join('')).toContain('PASS 2026-10-25-tt1')
    expect(await main([])).toBe(2)
  }, 30_000)
})
