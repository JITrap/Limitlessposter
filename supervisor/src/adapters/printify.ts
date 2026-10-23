// Printify adapter: read-only access to Julius' print-on-demand orders and product costs
// (REST API v1, personal access token from `.env` → PRINTIFY_API_TOKEN). The supervisor
// calls `printifySummary` for the Zentrale; workers may call the CLI (`shops`, `orders`,
// `products`, `summary`). Only aggregates leave this module – no customer names, no addresses.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDotenv, stripBom } from '../config.js'

export const PRINTIFY_API = 'https://api.printify.com/v1'
const USER_AGENT = 'LimitlessOS/1.0 (+https://limitlessposter.com)'
const PAGE_LIMIT = 50 // Printify erlaubt höchstens 50 Einträge pro Seite (Fehler 8150 bei mehr)
const MAX_PAGES = 10

export type PrintifyEnv = Record<string, string | undefined>
export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
}>

export interface PrintifyShop {
  id: number
  title: string
  sales_channel: string
}

interface OrderLineItem {
  quantity?: number
  cost?: number
  shipping_cost?: number
  status?: string
  metadata?: { title?: string; price?: number; sku?: string; variant_label?: string }
}

interface PrintifyOrder {
  id: string
  status?: string
  total_price?: number
  total_shipping?: number
  total_tax?: number
  created_at?: string
  fulfilled_at?: string | null
  sent_to_production_at?: string | null
  line_items?: OrderLineItem[]
  // address_to and other personal fields exist in the API response and are deliberately never read.
}

interface PrintifyProduct {
  id: string
  title: string
  visible?: boolean
  variants?: Array<{ price?: number; cost?: number; is_enabled?: boolean }>
}

export interface PrintifySummary {
  ok: boolean
  /** German, when ok is false */
  fehler: string | null
  stand: string
  shop: { id: number; titel: string; kanal: string } | null
  auftraege: {
    offen: number
    in_produktion: number
    versendet_28t: number
    gesamt_28t: number
    /** EUR, retail incl. shipping as charged by the shop */
    umsatz_28t: number
    /** EUR, what Printify charged (production + shipping) */
    kosten_28t: number
    marge_28t: number
    mit_problemen: number
  }
  produkte: {
    gesamt: number
    sichtbar: number
    /** average margin (retail − production cost) over enabled variants, EUR */
    marge_durchschnitt: number | null
    marge_min: number | null
    marge_max: number | null
  }
}

export class PrintifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PrintifyError'
  }
}

export function tokenFrom(env: PrintifyEnv): string | null {
  const t = env.PRINTIFY_API_TOKEN?.trim()
  return t ? t : null
}

/** Reads `.env` from the repo root like the Shopify adapter (process env wins). */
export async function withDotenv(env: PrintifyEnv, repoRoot?: string): Promise<PrintifyEnv> {
  const root = repoRoot ?? env.LIMITLESS_REPO_ROOT ?? process.cwd()
  try {
    const parsed = parseDotenv(stripBom(await readFile(join(root, '.env'), 'utf8')))
    return { ...parsed, ...env }
  } catch {
    return env
  }
}

async function api<T>(path: string, token: string, fetchFn: FetchLike): Promise<T> {
  const res = await fetchFn(`${PRINTIFY_API}${path}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  if (!res.ok) {
    const hint = res.status === 401 ? 'Token ungültig oder abgelaufen (Printify → Mein Profil → Connections → Personal Access Tokens)' : res.status === 429 ? 'Printify-Limit erreicht (600 Anfragen/Minute)' : text.slice(0, 200)
    throw new PrintifyError(`Printify ${res.status}: ${hint}`, res.status)
  }
  return JSON.parse(text) as T
}

export async function listShops(token: string, fetchFn: FetchLike): Promise<PrintifyShop[]> {
  return api<PrintifyShop[]>('/shops.json', token, fetchFn)
}

async function paged<T>(path: string, token: string, fetchFn: FetchLike, stop?: (page: T[]) => boolean): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await api<{ data?: T[]; last_page?: number; current_page?: number }>(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE_LIMIT}&page=${page}`, token, fetchFn)
    const items = Array.isArray(res.data) ? res.data : []
    out.push(...items)
    if (!items.length || (stop && stop(items)) || (res.last_page !== undefined && page >= res.last_page)) break
  }
  return out
}

/** Orders newer than `since`; stops paging once a page is entirely older (API returns newest first). */
export async function listOrders(shopId: number, token: string, fetchFn: FetchLike, since: Date): Promise<PrintifyOrder[]> {
  const all = await paged<PrintifyOrder>(`/shops/${shopId}/orders.json`, token, fetchFn, (page) => page.every((o) => new Date(o.created_at ?? 0) < since))
  return all.filter((o) => new Date(o.created_at ?? 0) >= since)
}

export async function listProducts(shopId: number, token: string, fetchFn: FetchLike): Promise<PrintifyProduct[]> {
  return paged<PrintifyProduct>(`/shops/${shopId}/products.json`, token, fetchFn)
}

const eur = (cents: number | undefined): number => Math.round(Number(cents ?? 0)) / 100
const round2 = (n: number): number => Math.round(n * 100) / 100
const OPEN_STATUSES = new Set(['pending', 'on-hold', 'payment-not-submitted', 'callback-received', 'sending-to-production'])
const PRODUCTION_STATUSES = new Set(['in-production', 'partially-fulfilled'])

/** Aggregates only – safe to show on the Zentrale and to write into the vault. */
export function summarize(shop: PrintifyShop | null, orders: PrintifyOrder[], products: PrintifyProduct[], now: Date): PrintifySummary {
  const since28 = new Date(now.getTime() - 28 * 86_400_000)
  const a = { offen: 0, in_produktion: 0, versendet_28t: 0, gesamt_28t: 0, umsatz_28t: 0, kosten_28t: 0, marge_28t: 0, mit_problemen: 0 }
  for (const o of orders) {
    const status = String(o.status ?? '')
    if (OPEN_STATUSES.has(status)) a.offen++
    if (PRODUCTION_STATUSES.has(status)) a.in_produktion++
    if (status === 'has-issues') a.mit_problemen++
    if (new Date(o.created_at ?? 0) >= since28) {
      a.gesamt_28t++
      if (status === 'fulfilled') a.versendet_28t++
      a.umsatz_28t += eur(o.total_price) + eur(o.total_shipping)
      for (const li of o.line_items ?? []) a.kosten_28t += (eur(li.cost) + eur(li.shipping_cost)) * Number(li.quantity ?? 1)
    }
  }
  a.umsatz_28t = round2(a.umsatz_28t)
  a.kosten_28t = round2(a.kosten_28t)
  a.marge_28t = round2(a.umsatz_28t - a.kosten_28t)

  const margins: number[] = []
  let sichtbar = 0
  for (const p of products) {
    if (p.visible) sichtbar++
    for (const v of p.variants ?? []) {
      if (v.is_enabled === false) continue
      if (typeof v.price === 'number' && typeof v.cost === 'number') margins.push(eur(v.price) - eur(v.cost))
    }
  }
  const avg = margins.length ? round2(margins.reduce((s, m) => s + m, 0) / margins.length) : null
  return {
    ok: true,
    fehler: null,
    stand: now.toISOString(),
    shop: shop ? { id: shop.id, titel: shop.title, kanal: shop.sales_channel } : null,
    auftraege: a,
    produkte: {
      gesamt: products.length,
      sichtbar,
      marge_durchschnitt: avg,
      marge_min: margins.length ? round2(Math.min(...margins)) : null,
      marge_max: margins.length ? round2(Math.max(...margins)) : null,
    },
  }
}

export function notConfigured(now: Date): PrintifySummary {
  return {
    ok: false,
    fehler: 'Printify nicht verbunden – PRINTIFY_API_TOKEN fehlt in der .env',
    stand: now.toISOString(),
    shop: null,
    auftraege: { offen: 0, in_produktion: 0, versendet_28t: 0, gesamt_28t: 0, umsatz_28t: 0, kosten_28t: 0, marge_28t: 0, mit_problemen: 0 },
    produkte: { gesamt: 0, sichtbar: 0, marge_durchschnitt: null, marge_min: null, marge_max: null },
  }
}

/** The whole picture in three calls; the shop is the first Shopify-connected one, else the first. */
export async function printifySummary(env: PrintifyEnv, fetchFn: FetchLike = fetch as unknown as FetchLike, now: Date = new Date()): Promise<PrintifySummary> {
  const token = tokenFrom(env)
  if (!token) return notConfigured(now)
  try {
    const shops = await listShops(token, fetchFn)
    const shop = shops.find((s) => /shopify/i.test(s.sales_channel)) ?? shops[0] ?? null
    if (!shop) return { ...notConfigured(now), fehler: 'Printify: kein Shop im Konto' }
    const since = new Date(now.getTime() - 60 * 86_400_000)
    const [orders, products] = await Promise.all([listOrders(shop.id, token, fetchFn, since), listProducts(shop.id, token, fetchFn)])
    return summarize(shop, orders, products, now)
  } catch (err) {
    return { ...notConfigured(now), fehler: err instanceof Error ? err.message : String(err) }
  }
}

// --- CLI ----------------------------------------------------------------------------------------

export interface CliIo {
  stdout: (s: string) => void
  stderr: (s: string) => void
  fetch: FetchLike
  now?: () => Date
}

export async function main(argv: string[], rawEnv: PrintifyEnv, io: CliIo): Promise<number> {
  const [cmd] = argv
  const env = await withDotenv(rawEnv)
  const now = io.now ?? (() => new Date())
  const usage = 'Verwendung: printify.js summary | shops | orders [--days N] | products\n'
  const token = tokenFrom(env)
  try {
    if (cmd === 'summary') {
      io.stdout(JSON.stringify(await printifySummary(env, io.fetch, now()), null, 2) + '\n')
      return 0
    }
    if (!token) {
      io.stderr('PRINTIFY_API_TOKEN fehlt in der .env (Printify → Mein Profil → Connections → Personal Access Tokens)\n')
      return 2
    }
    if (cmd === 'shops') {
      io.stdout(JSON.stringify(await listShops(token, io.fetch), null, 2) + '\n')
      return 0
    }
    const shopFor = async (): Promise<PrintifyShop> => {
      const shops = await listShops(token, io.fetch)
      const shop = shops.find((s) => /shopify/i.test(s.sales_channel)) ?? shops[0]
      if (!shop) throw new PrintifyError('Printify: kein Shop im Konto', 404)
      return shop
    }
    if (cmd === 'orders') {
      const i = argv.indexOf('--days')
      const days = i >= 0 ? Number(argv[i + 1]) : 28
      const shop = await shopFor()
      const orders = await listOrders(shop.id, token, io.fetch, new Date(now().getTime() - days * 86_400_000))
      // aggregates and per-order status only – never the address block
      const rows = orders.map((o) => ({
        id: o.id,
        status: o.status ?? null,
        created_at: o.created_at ?? null,
        fulfilled_at: o.fulfilled_at ?? null,
        umsatz: round2(eur(o.total_price) + eur(o.total_shipping)),
        kosten: round2((o.line_items ?? []).reduce((s, li) => s + (eur(li.cost) + eur(li.shipping_cost)) * Number(li.quantity ?? 1), 0)),
        positionen: (o.line_items ?? []).map((li) => ({ titel: li.metadata?.title ?? null, variante: li.metadata?.variant_label ?? null, menge: li.quantity ?? 1, status: li.status ?? null })),
      }))
      io.stdout(JSON.stringify(rows, null, 2) + '\n')
      return 0
    }
    if (cmd === 'products') {
      const shop = await shopFor()
      const products = await listProducts(shop.id, token, io.fetch)
      const rows = products.map((p) => {
        const vs = (p.variants ?? []).filter((v) => v.is_enabled !== false)
        const margins = vs.filter((v) => typeof v.price === 'number' && typeof v.cost === 'number').map((v) => eur(v.price) - eur(v.cost))
        return {
          id: p.id,
          titel: p.title,
          sichtbar: Boolean(p.visible),
          varianten: vs.length,
          preis_min: vs.length ? round2(Math.min(...vs.map((v) => eur(v.price)))) : null,
          kosten_min: vs.length ? round2(Math.min(...vs.map((v) => eur(v.cost)))) : null,
          marge_min: margins.length ? round2(Math.min(...margins)) : null,
          marge_max: margins.length ? round2(Math.max(...margins)) : null,
        }
      })
      io.stdout(JSON.stringify(rows, null, 2) + '\n')
      return 0
    }
    io.stderr(usage)
    return 1
  } catch (err) {
    io.stderr((err instanceof Error ? err.message : String(err)) + '\n')
    return err instanceof PrintifyError && err.status === 401 ? 2 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env as PrintifyEnv, {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    fetch: fetch as unknown as FetchLike,
  }).then((code) => process.exit(code))
}
