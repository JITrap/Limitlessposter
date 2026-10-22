// Shopify Admin API adapter (spec §8, Task 15). Used by workers as a CLI:
//   node supervisor/dist/adapters/shopify.js products [--limit 50]
//   node supervisor/dist/adapters/shopify.js orders --days 60
//   node supervisor/dist/adapters/shopify.js update-product <gid> --title "…" --description-html "…"
//   node supervisor/dist/adapters/shopify.js upload-file <local png/jpg/mp4>   → public CDN url for Metricool media
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
  errors?: Array<{ message: string; extensions?: { code?: string } }>
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable?: number } } }
}

const isThrottled = (errors: GraphqlResponse<unknown>['errors']): boolean =>
  Boolean(errors?.some((e) => e.extensions?.code === 'THROTTLED' || /throttled/i.test(e.message)))

/**
 * POST to the pinned GraphQL Admin API version. A successful answer is always
 * returned (a request is never re-sent – that would duplicate mutations); when the
 * remaining throttle budget is low we pause before returning so the next call has
 * room. A real THROTTLED error is retried once after the pause.
 */
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
  const wait = (): Promise<void> => new Promise((r) => setTimeout(r, opts.throttleWaitMs ?? 1000))
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    })
    if (res.status === 429 && attempt === 0) {
      await wait()
      continue
    }
    if (!res.ok) throw new Error(`Shopify-Fehler: HTTP ${res.status} bei ${url}`)
    const json = (await res.json()) as GraphqlResponse<T>
    if (json.errors?.length) {
      if (isThrottled(json.errors) && attempt === 0) {
        await wait()
        continue
      }
      if (isThrottled(json.errors)) throw new Error('Shopify-Fehler: Durchsatzgrenze auch nach Wartezeit erreicht')
      throw new Error(`Shopify-Fehler: ${json.errors.map((e) => e.message).join('; ')}`)
    }
    if (json.data === undefined) throw new Error('Shopify-Fehler: Antwort ohne data')
    const available = json.extensions?.cost?.throttleStatus?.currentlyAvailable
    if (typeof available === 'number' && available < THROTTLE_MIN_AVAILABLE) await wait()
    return json.data
  }
  throw new Error('Shopify-Fehler: Durchsatzgrenze auch nach Wartezeit erreicht')
}

/**
 * Workers run without secrets in their environment; the adapter reads the repo's
 * `.env` itself for anything missing (process values win). The repo root is
 * `LIMITLESS_REPO_ROOT` or three levels above this file (src/adapters or dist/adapters).
 */
export async function withDotenv(env: ShopifyEnv): Promise<ShopifyEnv> {
  const repoRoot = env.LIMITLESS_REPO_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  try {
    const { readFile: rf } = await import('node:fs/promises')
    const { parseDotenv } = await import('../config.js')
    const file = parseDotenv(await rf(join(repoRoot, '.env'), 'utf8'))
    const merged: ShopifyEnv = { ...env }
    for (const [k, v] of Object.entries(file)) if (merged[k] === undefined || merged[k] === '') merged[k] = v
    return merged
  } catch {
    return env
  }
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

// Small pages keep the query far below Shopify's 1,000-point single-query cap.
const ORDERS_QUERY = `query Orders($query: String!, $after: String) {
  orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    nodes { id name createdAt currentTotalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 10) { nodes { title quantity originalTotalSet { shopMoney { amount } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`
const ORDERS_MAX_PAGES = 10

const UPDATE_MUTATION = `mutation UpdateProduct($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id title } userErrors { field message } }
}`

const STAGED_UPLOAD_MUTATION = `mutation Staged($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`

const FILE_CREATE_MUTATION = `mutation FileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) { files { id fileStatus } userErrors { field message } }
}`

const FILE_STATUS_QUERY = `query FileStatus($id: ID!) {
  node(id: $id) {
    id
    ... on MediaImage { fileStatus image { url } }
    ... on Video { fileStatus sources { url mimeType } }
    ... on GenericFile { fileStatus url }
  }
}`

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}

/** Local file → public Shopify CDN url (stagedUploadsCreate → POST → fileCreate → poll READY). */
export async function uploadFile(
  filePath: string,
  env: ShopifyEnv,
  token: string,
  fetchImpl: typeof fetch,
  opts: { pollMs?: number; maxPolls?: number } = {},
): Promise<{ id: string; url: string; contentType: 'IMAGE' | 'VIDEO' }> {
  const { basename, extname } = await import('node:path')
  const { readFile: rf, stat } = await import('node:fs/promises')
  let size: number
  try {
    size = (await stat(filePath)).size
  } catch {
    throw new Error(`Datei nicht gefunden: ${filePath}`)
  }
  const ext = extname(filePath).toLowerCase()
  const mimeType = MIME[ext]
  if (!mimeType) throw new Error(`Dateityp ${ext || '(ohne Endung)'} wird nicht unterstützt (png, jpg, webp, gif, mp4, mov)`)
  const contentType: 'IMAGE' | 'VIDEO' = mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE'
  const filename = basename(filePath)

  const staged = await graphql<{
    stagedUploadsCreate: {
      stagedTargets: Array<{ url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }>
      userErrors: Array<{ message: string }>
    }
  }>(STAGED_UPLOAD_MUTATION, { input: [{ filename, mimeType, resource: contentType, fileSize: String(size), httpMethod: 'POST' }] }, env, token, fetchImpl)
  if (staged.stagedUploadsCreate.userErrors.length) throw new Error(`Shopify-Upload abgelehnt: ${staged.stagedUploadsCreate.userErrors.map((e) => e.message).join('; ')}`)
  const target = staged.stagedUploadsCreate.stagedTargets[0]
  if (!target) throw new Error('Shopify-Upload: kein Upload-Ziel erhalten')

  const form = new FormData()
  for (const p of target.parameters) form.append(p.name, p.value)
  form.append('file', new Blob([await rf(filePath)], { type: mimeType }), filename)
  const up = await fetchImpl(target.url, { method: 'POST', body: form })
  if (!up.ok) throw new Error(`Shopify-Upload fehlgeschlagen (HTTP ${up.status})`)

  const created = await graphql<{ fileCreate: { files: Array<{ id: string; fileStatus: string }>; userErrors: Array<{ message: string }> } }>(
    FILE_CREATE_MUTATION,
    { files: [{ originalSource: target.resourceUrl, contentType, alt: filename }] },
    env,
    token,
    fetchImpl,
  )
  if (created.fileCreate.userErrors.length) throw new Error(`Shopify fileCreate abgelehnt: ${created.fileCreate.userErrors.map((e) => e.message).join('; ')}`)
  const id = created.fileCreate.files[0]?.id
  if (!id) throw new Error('Shopify fileCreate: keine Datei-ID erhalten')

  const pollMs = opts.pollMs ?? 2000
  const maxPolls = opts.maxPolls ?? 45
  for (let i = 0; i < maxPolls; i++) {
    const data = await graphql<{
      node: { id: string; fileStatus: string; image?: { url: string } | null; sources?: Array<{ url: string }>; url?: string } | null
    }>(FILE_STATUS_QUERY, { id }, env, token, fetchImpl)
    const node = data.node
    if (node?.fileStatus === 'FAILED') throw new Error('Shopify konnte die Datei nicht verarbeiten (FAILED)')
    if (node?.fileStatus === 'READY') {
      const url = node.image?.url ?? node.sources?.[0]?.url ?? node.url
      if (url) return { id, url, contentType }
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error('Shopify-Datei ist nach der Wartezeit noch nicht bereit – später erneut versuchen')
}

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

export async function main(argv: string[], rawEnv: ShopifyEnv, io: CliIo): Promise<number> {
  const [cmd] = argv
  const now = io.now ?? (() => new Date())
  const env = await withDotenv(rawEnv)
  const dataDir = dataDirFrom(env)
  const usage =
    'Verwendung: shopify.js products [--limit N] | orders --days N | update-product <gid> [--title T] [--description-html H] | upload-file <pfad>\n'
  try {
    if (cmd === 'upload-file') {
      const filePath = argv[1]
      if (!filePath) {
        io.stderr(usage)
        return 1
      }
      // Check the file before touching the network so a typo fails fast and clearly.
      const { stat } = await import('node:fs/promises')
      try {
        await stat(filePath)
      } catch {
        io.stderr(`Datei nicht gefunden: ${filePath}\n`)
        return 1
      }
      const token = await getAccessToken(env, fileTokenCache(dataDir), io.fetch, now)
      const res = await uploadFile(filePath, env, token, io.fetch, { pollMs: Number(env.LIMITLESS_UPLOAD_POLL_MS ?? 2000) })
      io.stdout(JSON.stringify({ ok: true, ...res }) + '\n')
      return 0
    }
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
      type OrderNode = {
        id: string
        name: string
        createdAt: string
        currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
        lineItems: { nodes: Array<{ title: string; quantity: number; originalTotalSet: { shopMoney: { amount: string } } }> }
      }
      const orders: OrderNode[] = []
      let after: string | null = null
      for (let page = 0; page < ORDERS_MAX_PAGES; page++) {
        const data: { orders: { nodes: OrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await graphql(
          ORDERS_QUERY,
          { query: `created_at:>=${localDay(since)}`, after },
          env,
          token,
          io.fetch,
        )
        orders.push(...data.orders.nodes)
        if (!data.orders.pageInfo?.hasNextPage || !data.orders.pageInfo.endCursor) break
        after = data.orders.pageInfo.endCursor
      }
      const byProduct = new Map<string, { title: string; qty: number; revenue: number }>()
      let revenue = 0
      let currency = 'EUR'
      for (const o of orders) {
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
            count: orders.length,
            truncated: orders.length >= 50 * ORDERS_MAX_PAGES,
            revenue: round(revenue),
            currency,
            byProduct: [...byProduct.values()].map((p) => ({ ...p, revenue: round(p.revenue) })).sort((a, b) => b.revenue - a.revenue),
            last: orders.slice(0, 10).map((o) => ({ name: o.name, createdAt: o.createdAt, total: round(Number(o.currentTotalPriceSet.shopMoney.amount)) })),
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
