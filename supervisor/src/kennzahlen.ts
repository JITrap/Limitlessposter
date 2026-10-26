// Kennzahlen (the "Zentrale"): the figures from Shopify, Metricool and Printify that the
// world view shows on one page. A cheap worker (station `kennzahlen`) collects the
// Shopify/Metricool numbers through MCP and writes them as frontmatter of
// `<Vault>/LimitlessOS/Kennzahlen.md`; the supervisor only reads that note. Printify is
// read directly by the supervisor (plain REST, token in .env) – see adapters/printify.ts.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseNote, readSection } from './vault/frontmatter.js'

export interface NetzwerkKennzahlen {
  follower: number | null
  /** follower change over the last 7 days */
  follower_7t: number | null
  reichweite_7t: number | null
  interaktionen_7t: number | null
  posts_7t: number | null
}

export interface Kennzahlen {
  /** YYYY-MM-DDTHH:mm:ss, when the worker wrote the note */
  updated: string | null
  quelle: string | null
  shop: {
    bestellungen_7t: number | null
    umsatz_7t: number | null
    bestellungen_28t: number | null
    umsatz_28t: number | null
    produkte_aktiv: number | null
    produkte_englisch: number | null
    waehrung: string
  }
  netzwerke: Record<string, NetzwerkKennzahlen>
  /** scheduled Metricool posts in the next 7 days */
  geplant_7t: number | null
  beste_zeiten: Record<string, string>
  /** Higgsfield-Guthaben (KI-Video) aus `balance`; null, wenn nicht verbunden */
  higgsfield: { credits: number | null; plan: string | null }
  /** short German sentences the worker wrote under "## Woche in Sätzen" */
  saetze: string[]
}

export const KENNZAHLEN_FILE = 'Kennzahlen.md'
export const NETZWERKE = ['instagram', 'tiktok', 'linkedin', 'gmb', 'pinterest', 'facebook', 'youtube'] as const

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'))
  return null
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : v instanceof Date ? v.toISOString().slice(0, 19) : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Tolerant parse: every missing or odd value becomes null, never an exception. */
export function parseKennzahlen(text: string): Kennzahlen {
  const { data, body } = parseNote(text)
  const shop = obj(data.shop)
  const netzwerkeRaw = obj(data.netzwerke)
  const netzwerke: Record<string, NetzwerkKennzahlen> = {}
  for (const [name, raw] of Object.entries(netzwerkeRaw)) {
    const n = obj(raw)
    netzwerke[name.toLowerCase()] = {
      follower: num(n.follower),
      follower_7t: num(n.follower_7t),
      reichweite_7t: num(n.reichweite_7t ?? n.aufrufe_7t),
      interaktionen_7t: num(n.interaktionen_7t),
      posts_7t: num(n.posts_7t),
    }
  }
  const besteRaw = obj(data.beste_zeiten)
  const beste_zeiten: Record<string, string> = {}
  for (const [k, v] of Object.entries(besteRaw)) {
    const s = str(v)
    if (s) beste_zeiten[k.toLowerCase()] = s
  }
  const saetze: string[] = []
  for (const line of (readSection(body, 'Woche in Sätzen') ?? '').split('\n')) {
    const t = line.replace(/^[-*]\s*/, '').trim()
    if (t && !t.startsWith('(')) saetze.push(t)
  }
  return {
    updated: str(data.updated),
    quelle: str(data.quelle),
    shop: {
      bestellungen_7t: num(shop.bestellungen_7t),
      umsatz_7t: num(shop.umsatz_7t),
      bestellungen_28t: num(shop.bestellungen_28t),
      umsatz_28t: num(shop.umsatz_28t),
      produkte_aktiv: num(shop.produkte_aktiv),
      produkte_englisch: num(shop.produkte_englisch),
      waehrung: str(shop.waehrung) ?? 'EUR',
    },
    netzwerke,
    geplant_7t: num(data.geplant_7t),
    beste_zeiten,
    higgsfield: { credits: num(obj(data.higgsfield).credits), plan: str(obj(data.higgsfield).plan) },
    saetze: saetze.slice(0, 6),
  }
}

export interface KennzahlenCache {
  mtimeMs: number
  value: Kennzahlen | null
}

/** Re-read `Kennzahlen.md` only when its mtime changed (called every tick). */
export async function loadKennzahlen(vaultRoot: string, cache: KennzahlenCache | null): Promise<KennzahlenCache> {
  const file = join(vaultRoot, KENNZAHLEN_FILE)
  let mtimeMs: number
  try {
    mtimeMs = (await stat(file)).mtimeMs
  } catch {
    return { mtimeMs: 0, value: null }
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache
  try {
    return { mtimeMs, value: parseKennzahlen(await readFile(file, 'utf8')) }
  } catch {
    return { mtimeMs, value: cache?.value ?? null }
  }
}
