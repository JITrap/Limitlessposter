// Shopify Admin API adapter (spec §8, Task 15). Used by workers as a CLI:
//   node supervisor/dist/adapters/shopify.js products [--limit 50]
//   node supervisor/dist/adapters/shopify.js orders --days 60
//   node supervisor/dist/adapters/shopify.js update-product <gid> --title "…" --description-html "…"
// Auth: client-credentials grant of a Dev-Dashboard custom app (token cached 24 h).
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const API_VERSION = '2026-10'
const TOKEN_REFRESH_MARGIN_MS = 10 * 60_000
const THROTTLE_MIN_AVAILABLE = 50

export interface ShopifyEnv {
  SHOPIFY_STORE_DOMAIN?: string
  SHOPIFY_CLIENT_ID?: string
  SHOPIFY_CLIENT_SECRET?: string
  [key: string]: string | undefined
}

export interface TokenCache {
  read(): Promise<{ token: string; expiresAt: string } | null>
  write(v: { token: string; expiresAt: string }): Promise<void>
}

function need(env: ShopifyEnv, key: 'SHOPIFY_STORE_DOMAIN' | 'SHOPIFY_CLIENT_ID' | 'SHOPIFY_CLIENT_SECRET'): string {
  const v = env[key]?.trim()
  if (!v) throw new Error(`Umgebungsvariable ${key} fehlt – siehe docs/anleitung/shopify-app.md`)
  return v
}

export function fileTokenCache(dataDir: string): TokenCache {
  const file = join(dataDir, 'shopify-token.json')
  return {
    async read() {
      try {
        return JSON.parse(await readFile(file, 'utf8')) as { token: string; expiresAt: string }
      } catch {
        return null
      }
    },
    async write(v) {
      await mkdir(dataDir, { recursive: true })
      await writeFile(file, JSON.stringify(v), 'utf8')
    },
  }
}

/** POST /admin/oauth/access_token with grant_type=client_credentials; cached until 10 min before expiry. */
export async function getAccessToken(
  env: ShopifyEnv,
  cache: TokenCache,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<string> {
  const domain = need(env, 'SHOPIFY_STORE_DOMAIN')
  const clientId = need(env, 'SHOPIFY_CLIENT_ID')
  const clientSecret = need(env, 'SHOPIFY_CLIENT_SECRET')

  const cached = await cache.read()
  if (cached && new Date(cached.expiresAt).getTime() - now().getTime() > TOKEN_REFRESH_MARGIN_MS) return cached.token

  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  const res = await fetchImpl(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`Shopify-Token konnte nicht geholt werden (HTTP ${res.status}) – Client-ID/Secret und App-Installation prüfen`)
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) throw new Error('Shopify-Token-Antwort ohne access_token')
  const expiresAt = new Date(now().getTime() + (json.expires_in ?? 86_400) * 1000).toISOString()
  await cache.write({ token: json.access_token, expiresAt })
  return json.access_token
}

interface GraphqlResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable?: number } } }
}

/** POST to the pinned GraphQL Admin API version; one retry when the throttle budget is low. */
export async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  env: ShopifyEnv,
  token: string,
  fetchImpl: typeof fetch = fetch,
  opts: { throttleWaitMs?: number } = {},
): Promise<T> {
  const domain = need(env, 'SHOPIFY_STORE_DOMAIN')
  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) throw new Error(`Shopify-Fehler: HTTP ${res.status} bei ${url}`)
    const json = (await res.json()) as GraphqlResponse<T>
    if (json.errors?.length) throw new Error(`Shopify-Fehler: ${json.errors.map((e) => e.message).join('; ')}`)
    const available = json.extensions?.cost?.throttleStatus?.currentlyAvailable
    if (attempt === 0 && typeof available === 'number' && available < THROTTLE_MIN_AVAILABLE) {
      await new Promise((r) => setTimeout(r, opts.throttleWaitMs ?? 1000))
      continue
    }
    if (json.data === undefined) throw new Error('Shopify-Fehler: Antwort ohne data')
    return json.data
  }
  throw new Error('Shopify-Fehler: Durchsatzgrenze auch nach Wartezeit erreicht')
}

// --- CLI ---------------------------------------------------------------------

export interface CliIo {
  fetch: typeof fetch
  stdout: (s: string) => void
  stderr: (s: string) => void
  now?: () => Date
}

const PRODUCTS_QUERY = `query Products($first: Int!) {
  products(first: $first, sortKey: UPDATED_AT, reverse: true) {
    nodes { id title handle status descriptionHtml totalInventory updatedAt
      priceRangeV2 { minVariantPrice { amount currencyCode } } }
  }
}`

const ORDERS_QUERY = `query Orders($query: String!) {
  orders(first: 250, query: $query, sortKey: CREATED_AT, reverse: true) {
    nodes { id name createdAt currentTotalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 50) { nodes { title quantity originalTotalSet { shopMoney { amount } } } } }
  }
}`

const UPDATE_MUTATION = `mutation UpdateProduct($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id title } userErrors { field message } }
}`

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function dataDirFrom(env: ShopifyEnv): string {
  if (env.LIMITLESS_DATA_DIR) return env.LIMITLESS_DATA_DIR
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data')
}

const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function bumpShopCounter(dataDir: string, limit: number, now: Date): Promise<boolean> {
  const file = join(dataDir, 'counters.json')
  let cur: { date: string; shopChanges: number } = { date: localDay(now), shopChanges: 0 }
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as { date?: string; shopChanges?: number }
    if (raw.date === localDay(now)) cur = { date: raw.date, shopChanges: Number(raw.shopChanges ?? 0) }
  } catch {
    // fresh day
  }
  if (cur.shopChanges >= limit) return false
  cur.shopChanges += 1
  await mkdir(dataDir, { recursive: true })
  await writeFile(file, JSON.stringify(cur), 'utf8')
  return true
}

export async function main(argv: string[], env: ShopifyEnv, io: CliIo): Promise<number> {
  const [cmd] = argv
  const now = io.now ?? (() => new Date())
  const dataDir = dataDirFrom(env)
  const usage = 'Verwendung: shopify.js products [--limit N] | orders --days N | update-product <gid> [--title T] [--description-html H]\n'
  try {
    if (cmd === 'products') {
      const token = await getAccessToken(env, fileTokenCache(dataDir), io.fetch, now)
      const first = Math.min(250, Number(arg(argv, '--limit') ?? 50))
      const data = await graphql<{ products: { nodes: Array<Record<string, unknown>> } }>(PRODUCTS_QUERY, { first }, env, token, io.fetch)
      const list = data.products.nodes.map((p) => {
        const price = (p.priceRangeV2 as { minVariantPrice?: { amount?: string; currencyCode?: string } } | undefined)?.minVariantPrice
        return {
          id: p.id,
          title: p.title,
          handle: p.handle,
          status: p.status,
          descriptionHtml: p.descriptionHtml,
          totalInventory: p.totalInventory,
          price: price?.amount ?? null,
          currency: price?.currencyCode ?? null,
          updatedAt: p.updatedAt,
        }
      })
      io.stdout(JSON.stringify(list, null, 2) + '\n')
      return 0
    }
    if (cmd === 'orders') {
      const token = await getAccessToken(env, fileTokenCache(dataDir), io.fetch, now)
      const days = Number(arg(argv, '--days') ?? 60)
      const since = new Date(now().getTime() - days * 86_400_000)
      const data = await graphql<{
        orders: {
          nodes: Array<{
            id: string
            name: string
            createdAt: string
            currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
            lineItems: { nodes: Array<{ title: string; quantity: number; originalTotalSet: { shopMoney: { amount: string } } }> }
          }>
        }
      }>(ORDERS_QUERY, { query: `created_at:>=${localDay(since)}` }, env, token, io.fetch)
      const byProduct = new Map<string, { title: string; qty: number; revenue: number }>()
      let revenue = 0
      let currency = 'EUR'
      for (const o of data.orders.nodes) {
        revenue += Number(o.currentTotalPriceSet.shopMoney.amount)
        currency = o.currentTotalPriceSet.shopMoney.currencyCode || currency
        for (const li of o.lineItems.nodes) {
          const e = byProduct.get(li.title) ?? { title: li.title, qty: 0, revenue: 0 }
          e.qty += li.quantity
          e.revenue += Number(li.originalTotalSet.shopMoney.amount)
          byProduct.set(li.title, e)
        }
      }
      const round = (n: number): number => Math.round(n * 100) / 100
      io.stdout(
        JSON.stringify(
          {
            days,
            count: data.orders.nodes.length,
            revenue: round(revenue),
            currency,
            byProduct: [...byProduct.values()].map((p) => ({ ...p, revenue: round(p.revenue) })).sort((a, b) => b.revenue - a.revenue),
            last: data.orders.nodes.slice(0, 10).map((o) => ({ name: o.name, createdAt: o.createdAt, total: round(Number(o.currentTotalPriceSet.shopMoney.amount)) })),
          },
          null,
          2,
        ) + '\n',
      )
      return 0
    }
    if (cmd === 'update-product') {
      if (env.LIMITLESS_ALLOW_WRITES !== '1') {
        io.stderr('Schreiben nicht freigegeben (needs_approval) – nur Vorschläge in die Aufgaben-Notiz schreiben.\n')
        return 2
      }
      const id = argv[1]
      if (!id?.startsWith('gid://shopify/Product/')) {
        io.stderr('update-product braucht eine Produkt-GID (gid://shopify/Product/…)\n')
        return 1
      }
      const title = arg(argv, '--title')
      const descriptionHtml = arg(argv, '--description-html')
      if (!title && !descriptionHtml) {
        io.stderr('update-product: --title oder --description-html angeben\n')
        return 1
      }
      const limit = Number(env.LIMITLESS_DAILY_SHOP_CHANGE_LIMIT ?? 5)
      if (!(await bumpShopCounter(dataDir, limit, now()))) {
        io.stderr(`Tageslimit für Shop-Änderungen (${limit}) erreicht – morgen wieder.\n`)
        return 3
      }
      const token = await getAccessToken(env, fileTokenCache(dataDir), io.fetch, now)
      const product: Record<string, unknown> = { id }
      if (title) product.title = title
      if (descriptionHtml) product.descriptionHtml = descriptionHtml
      const data = await graphql<{ productUpdate: { product: { id: string; title: string } | null; userErrors: Array<{ message: string }> } }>(
        UPDATE_MUTATION,
        { product },
        env,
        token,
        io.fetch,
      )
      if (data.productUpdate.userErrors.length) {
        io.stderr(`Shopify lehnt die Änderung ab: ${data.productUpdate.userErrors.map((e) => e.message).join('; ')}\n`)
        return 1
      }
      io.stdout(JSON.stringify({ ok: true, product: data.productUpdate.product }) + '\n')
      return 0
    }
    io.stderr(usage)
    return 1
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env as ShopifyEnv, {
    fetch,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  }).then((code) => process.exit(code))
}
