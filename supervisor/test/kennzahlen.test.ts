import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseKennzahlen, loadKennzahlen } from '../src/kennzahlen.js'

const FULL = `---
type: kennzahlen
updated: 2026-10-23T08:00:00
quelle: metricool + shopify + printify
shop:
  bestellungen_7t: 2
  umsatz_7t: 164.98
  bestellungen_28t: 3
  umsatz_28t: 244.97
  produkte_aktiv: 125
  produkte_englisch: 12
  waehrung: EUR
netzwerke:
  instagram: { follower: 12, follower_7t: 2, reichweite_7t: 260, interaktionen_7t: 12, posts_7t: 5 }
  TikTok: { follower: 6, follower_7t: -1, aufrufe_7t: 2600, interaktionen_7t: 40, posts_7t: 4 }
  gmb: { follower: , follower_7t: , reichweite_7t: 0, interaktionen_7t: 0, posts_7t: 2 }
geplant_7t: 3
beste_zeiten:
  instagram: "Fr 18–20 Uhr"
  tiktok: "Sa 19–21 Uhr"
---
# Kennzahlen – Stand 23.10.2026 08:00

## Woche in Sätzen
- Instagram ist um 2 Follower gewachsen.
- TikTok hat 2.600 Aufrufe gebracht.
(Hinweis in Klammern wird ignoriert)

## Netzwerke (7 Tage)
| Netzwerk | Follower |
|---|---|
`

describe('parseKennzahlen', () => {
  it('reads shop, networks (case-insensitive, aufrufe alias), plan count, best times and sentences', () => {
    const k = parseKennzahlen(FULL)
    expect(k.updated).toBe('2026-10-23T08:00:00')
    expect(k.quelle).toBe('metricool + shopify + printify')
    expect(k.shop).toEqual({ bestellungen_7t: 2, umsatz_7t: 164.98, bestellungen_28t: 3, umsatz_28t: 244.97, produkte_aktiv: 125, produkte_englisch: 12, waehrung: 'EUR' })
    expect(k.netzwerke.instagram).toEqual({ follower: 12, follower_7t: 2, reichweite_7t: 260, interaktionen_7t: 12, posts_7t: 5 })
    expect(k.netzwerke.tiktok.reichweite_7t).toBe(2600)
    expect(k.netzwerke.tiktok.follower_7t).toBe(-1)
    expect(k.netzwerke.gmb.follower).toBeNull()
    expect(k.geplant_7t).toBe(3)
    expect(k.beste_zeiten).toEqual({ instagram: 'Fr 18–20 Uhr', tiktok: 'Sa 19–21 Uhr' })
    expect(k.saetze).toEqual(['Instagram ist um 2 Follower gewachsen.', 'TikTok hat 2.600 Aufrufe gebracht.'])
  })

  it('never throws on an empty or odd note and defaults to nulls', () => {
    const k = parseKennzahlen('---\ntype: kennzahlen\nupdated:\nshop: nein\nnetzwerke: [a, b]\n---\n# leer\n')
    expect(k.updated).toBeNull()
    expect(k.shop.umsatz_7t).toBeNull()
    expect(k.shop.waehrung).toBe('EUR')
    expect(k.netzwerke).toEqual({})
    expect(k.saetze).toEqual([])
    expect(parseKennzahlen('kein frontmatter').shop.bestellungen_7t).toBeNull()
  })

  it('accepts German decimal commas in strings', () => {
    expect(parseKennzahlen('---\nshop:\n  umsatz_7t: "79,99"\n---\n').shop.umsatz_7t).toBe(79.99)
  })
})

describe('loadKennzahlen', () => {
  it('returns null without the file, parses it once per mtime and re-reads after a change', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'los-kz-'))
    const none = await loadKennzahlen(vault, null)
    expect(none.value).toBeNull()
    await writeFile(join(vault, 'Kennzahlen.md'), FULL, 'utf8')
    const first = await loadKennzahlen(vault, none)
    expect(first.value?.shop.bestellungen_7t).toBe(2)
    const again = await loadKennzahlen(vault, first)
    expect(again).toBe(first) // same mtime → same object, no re-parse
    await writeFile(join(vault, 'Kennzahlen.md'), FULL.replace('bestellungen_7t: 2', 'bestellungen_7t: 9'), 'utf8')
    const later = new Date(Date.now() + 5000)
    await utimes(join(vault, 'Kennzahlen.md'), later, later)
    const third = await loadKennzahlen(vault, again)
    expect(third.value?.shop.bestellungen_7t).toBe(9)
  })
})
