import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { summarize, printifySummary, notConfigured, main, withDotenv, type FetchLike } from '../../src/adapters/printify.js'

const NOW = new Date('2026-11-06T10:00:00Z')
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString()

const SHOPS = [{ id: 1, title: 'LimitlessPoster', sales_channel: 'shopify' }, { id: 2, title: 'Etsy-Test', sales_channel: 'etsy' }]
const ORDERS = [
  {
    id: 'o1', status: 'fulfilled', total_price: 7999, total_shipping: 0, created_at: daysAgo(5), fulfilled_at: daysAgo(2),
    address_to: { first_name: 'Max', last_name: 'Muster', address1: 'Musterstraße 1', email: 'max@example.com' },
    line_items: [{ quantity: 1, cost: 2500, shipping_cost: 500, status: 'fulfilled', metadata: { title: 'The World Is Yours', price: 7999, variant_label: '28 × 36 / Schwarz' } }],
  },
  {
    id: 'o2', status: 'in-production', total_price: 8499, total_shipping: 0, created_at: daysAgo(2),
    address_to: { first_name: 'Erika', address1: 'Beispielweg 2' },
    line_items: [{ quantity: 1, cost: 3000, shipping_cost: 500, status: 'in-production', metadata: { title: 'Stay Hungry' } }],
  },
  {
    id: 'o3', status: 'fulfilled', total_price: 9499, total_shipping: 0, created_at: daysAgo(40),
    line_items: [{ quantity: 2, cost: 3500, shipping_cost: 500, status: 'fulfilled', metadata: { title: 'Alt' } }],
  },
]
const PRODUCTS = [
  { id: 'p1', title: 'The World Is Yours', visible: true, variants: [{ price: 7999, cost: 2500, is_enabled: true }, { price: 8499, cost: 3000, is_enabled: true }] },
  { id: 'p2', title: 'Stay Hungry', visible: false, variants: [{ price: 9499, cost: 3500, is_enabled: true }, { price: 100, cost: 99, is_enabled: false }] },
]

function fakeFetch(calls: string[], opts: { status?: number } = {}): FetchLike {
  return async (url, init) => {
    calls.push(url)
    expect(init?.headers?.authorization).toBe('Bearer tok')
    expect(init?.headers?.['user-agent']).toMatch(/LimitlessOS/)
    if (opts.status) return { ok: false, status: opts.status, text: async () => '{"error":"x"}' }
    const body = url.endsWith('/shops.json')
      ? SHOPS
      : url.includes('/orders.json')
        ? { current_page: 1, last_page: 1, data: ORDERS }
        : url.includes('/products.json')
          ? { current_page: 1, last_page: 1, data: PRODUCTS }
          : {}
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  }
}

describe('summarize', () => {
  it('aggregates orders of the last 28 days and margins of enabled variants', () => {
    const s = summarize(SHOPS[0], ORDERS as never, PRODUCTS as never, NOW)
    expect(s.ok).toBe(true)
    expect(s.shop).toEqual({ id: 1, titel: 'LimitlessPoster', kanal: 'shopify' })
    expect(s.auftraege).toEqual({ offen: 0, in_produktion: 1, versendet_28t: 1, gesamt_28t: 2, umsatz_28t: 164.98, kosten_28t: 65, marge_28t: 99.98, mit_problemen: 0 })
    expect(s.produkte).toEqual({ gesamt: 2, sichtbar: 1, marge_durchschnitt: 56.66, marge_min: 54.99, marge_max: 59.99 })
  })
})

describe('printifySummary', () => {
  it('reports "nicht verbunden" without a token and makes no request', async () => {
    const calls: string[] = []
    const s = await printifySummary({}, fakeFetch(calls), NOW)
    expect(s.ok).toBe(false)
    expect(s.fehler).toMatch(/PRINTIFY_API_TOKEN fehlt/)
    expect(calls).toEqual([])
    expect(notConfigured(NOW).auftraege.offen).toBe(0)
  })

  it('picks the Shopify-connected shop and fetches orders and products', async () => {
    const calls: string[] = []
    const s = await printifySummary({ PRINTIFY_API_TOKEN: 'tok' }, fakeFetch(calls), NOW)
    expect(s.ok).toBe(true)
    expect(s.shop?.id).toBe(1)
    expect(calls[0]).toMatch(/\/shops\.json$/)
    expect(calls.some((u) => u.includes('/shops/1/orders.json?limit=50&page=1'))).toBe(true)
    expect(calls.some((u) => u.includes('/shops/1/products.json?limit=50&page=1'))).toBe(true)
    expect(s.auftraege.marge_28t).toBe(99.98)
  })

  it('turns a 401 into a German hint instead of throwing', async () => {
    const s = await printifySummary({ PRINTIFY_API_TOKEN: 'tok' }, fakeFetch([], { status: 401 }), NOW)
    expect(s.ok).toBe(false)
    expect(s.fehler).toMatch(/401.*Token ungültig/)
  })
})

describe('CLI', () => {
  const io = (): { out: string[]; err: string[]; io: Parameters<typeof main>[2] } => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, io: { stdout: (s) => out.push(s), stderr: (s) => err.push(s), fetch: fakeFetch([]), now: () => NOW } }
  }

  it('orders prints aggregates and statuses but never the address block', async () => {
    const { out, io: o } = io()
    const code = await main(['orders', '--days', '28'], { PRINTIFY_API_TOKEN: 'tok', LIMITLESS_REPO_ROOT: tmpdir() }, o)
    expect(code).toBe(0)
    const text = out.join('')
    expect(text).toContain('"umsatz": 79.99')
    expect(text).toContain('"kosten": 30')
    expect(text).not.toMatch(/Muster|Beispielweg|example\.com|address/)
    expect(JSON.parse(text)).toHaveLength(2) // the 40-day-old order is outside --days 28
  })

  it('exits 2 with a hint when the token is missing (except summary, which reports ok:false)', async () => {
    const a = io()
    expect(await main(['shops'], { LIMITLESS_REPO_ROOT: tmpdir() }, a.io)).toBe(2)
    expect(a.err.join('')).toMatch(/PRINTIFY_API_TOKEN fehlt/)
    const b = io()
    expect(await main(['summary'], { LIMITLESS_REPO_ROOT: tmpdir() }, b.io)).toBe(0)
    expect(JSON.parse(b.out.join('')).ok).toBe(false)
  })

  it('products lists margins per product', async () => {
    const { out, io: o } = io()
    expect(await main(['products'], { PRINTIFY_API_TOKEN: 'tok', LIMITLESS_REPO_ROOT: tmpdir() }, o)).toBe(0)
    const rows = JSON.parse(out.join('')) as Array<{ titel: string; marge_min: number; varianten: number }>
    expect(rows[0]).toMatchObject({ titel: 'The World Is Yours', marge_min: 54.99, varianten: 2 })
    expect(rows[1].varianten).toBe(1)
  })

  it('withDotenv reads the token from .env in the repo root (process env wins)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-pf-'))
    await writeFile(join(root, '.env'), '﻿PRINTIFY_API_TOKEN=aus-datei\nX=1\n', 'utf8')
    expect((await withDotenv({}, root)).PRINTIFY_API_TOKEN).toBe('aus-datei')
    expect((await withDotenv({ PRINTIFY_API_TOKEN: 'prozess' }, root)).PRINTIFY_API_TOKEN).toBe('prozess')
  })
})
