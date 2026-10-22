import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAccessToken, graphql, main, withDotenv, type TokenCache, API_VERSION } from '../../src/adapters/shopify.js'

const env = {
  SHOPIFY_STORE_DOMAIN: 'limitlessposter.myshopify.com',
  SHOPIFY_CLIENT_ID: 'cid',
  SHOPIFY_CLIENT_SECRET: 'sec',
}

type Call = { url: string; init: RequestInit }

function fakeFetch(handler: (url: string, init: RequestInit) => unknown | Promise<unknown>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    const body = await handler(url, init)
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetch: f, calls }
}

function memCache(initial: { token: string; expiresAt: string } | null = null): TokenCache & { value: { token: string; expiresAt: string } | null } {
  const c = {
    value: initial,
    async read() {
      return c.value
    },
    async write(v: { token: string; expiresAt: string }) {
      c.value = v
    },
  }
  return c
}

describe('getAccessToken', () => {
  const now = () => new Date('2026-10-22T10:00:00')

  it('fetches a token with the client-credentials grant and caches it', async () => {
    const { fetch, calls } = fakeFetch(() => ({ access_token: 'tok1', expires_in: 86400 }))
    const cache = memCache()
    const t = await getAccessToken(env, cache, fetch, now)
    expect(t).toBe('tok1')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://limitlessposter.myshopify.com/admin/oauth/access_token')
    expect(calls[0].init.method).toBe('POST')
    expect(String(calls[0].init.body)).toContain('grant_type=client_credentials')
    expect(String(calls[0].init.body)).toContain('client_id=cid')
    expect(cache.value!.token).toBe('tok1')
    expect(cache.value!.expiresAt).toBe('2026-10-23T10:00:00.000Z'.replace('T10', 'T08')) // 24 h later, stored in UTC ISO
    const again = await getAccessToken(env, cache, fetch, now)
    expect(again).toBe('tok1')
    expect(calls).toHaveLength(1)
  })

  it('refreshes when the cached token expires within 10 minutes', async () => {
    const { fetch, calls } = fakeFetch(() => ({ access_token: 'tok2', expires_in: 86400 }))
    const cache = memCache({ token: 'old', expiresAt: new Date(now().getTime() + 5 * 60_000).toISOString() })
    expect(await getAccessToken(env, cache, fetch, now)).toBe('tok2')
    expect(calls).toHaveLength(1)
  })

  it('throws a German error when credentials are missing or the grant fails', async () => {
    const { fetch } = fakeFetch(() => new Response('nope', { status: 401 }))
    await expect(getAccessToken({ ...env, SHOPIFY_CLIENT_SECRET: '' }, memCache(), fetch, now)).rejects.toThrow(/SHOPIFY_CLIENT_SECRET/)
    await expect(getAccessToken(env, memCache(), fetch, now)).rejects.toThrow(/Shopify-Token.*401/)
  })
})

describe('graphql', () => {
  it('posts to the pinned API version with the access token header', async () => {
    const { fetch, calls } = fakeFetch(() => ({ data: { shop: { name: 'LimitlessPoster' } }, extensions: { cost: { throttleStatus: { currentlyAvailable: 1000 } } } }))
    const data = await graphql<{ shop: { name: string } }>('{ shop { name } }', {}, env, 'tok', fetch)
    expect(data.shop.name).toBe('LimitlessPoster')
    expect(calls[0].url).toBe(`https://limitlessposter.myshopify.com/admin/api/${API_VERSION}/graphql.json`)
    expect((calls[0].init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('tok')
    expect(API_VERSION).toBe('2026-10')
  })

  it('throws a German error with the GraphQL error message', async () => {
    const { fetch } = fakeFetch(() => ({ errors: [{ message: 'Field does not exist' }] }))
    await expect(graphql('{ x }', {}, env, 'tok', fetch)).rejects.toThrow(/Shopify-Fehler.*Field does not exist/)
  })

  it('returns data from a successful call even when the throttle budget is low (never re-sends a mutation)', async () => {
    const { fetch, calls } = fakeFetch(() => ({ data: { ok: true }, extensions: { cost: { throttleStatus: { currentlyAvailable: 10 } } } }))
    const data = await graphql<{ ok: boolean }>('mutation { ok }', {}, env, 'tok', fetch, { throttleWaitMs: 5 })
    expect(data.ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('retries once after a THROTTLED error, then gives up with a German error', async () => {
    let n = 0
    const { fetch, calls } = fakeFetch(() => {
      n++
      return n === 1
        ? { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }
        : { data: { ok: true }, extensions: { cost: { throttleStatus: { currentlyAvailable: 900 } } } }
    })
    expect((await graphql<{ ok: boolean }>('{ ok }', {}, env, 'tok', fetch, { throttleWaitMs: 5 })).ok).toBe(true)
    expect(calls).toHaveLength(2)
    const always = fakeFetch(() => ({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }))
    await expect(graphql('{ ok }', {}, env, 'tok', always.fetch, { throttleWaitMs: 5 })).rejects.toThrow(/Durchsatzgrenze/)
  })

  it('reads SHOPIFY_* from the repo .env when the process env lacks them (secrets are stripped from workers)', async () => {
    const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises')
    const repo = await mkdtemp(join(tmpdir(), 'los-shopenv-'))
    await mkdir(join(repo, 'supervisor', 'data'), { recursive: true })
    await writeFile(join(repo, '.env'), 'SHOPIFY_STORE_DOMAIN=x.myshopify.com\nSHOPIFY_CLIENT_ID=cid\nSHOPIFY_CLIENT_SECRET=sec\n', 'utf8')
    const merged = await withDotenv({ PATH: '/bin', LIMITLESS_REPO_ROOT: repo })
    expect(merged.SHOPIFY_CLIENT_SECRET).toBe('sec')
    expect(merged.SHOPIFY_STORE_DOMAIN).toBe('x.myshopify.com')
    const kept = await withDotenv({ SHOPIFY_CLIENT_SECRET: 'proc', LIMITLESS_REPO_ROOT: repo })
    expect(kept.SHOPIFY_CLIENT_SECRET).toBe('proc')
  })
})

describe('CLI main', () => {
  let dataDir: string
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'los-shopify-'))
  })

  const productsResponse = {
    data: {
      products: {
        nodes: [
          {
            id: 'gid://shopify/Product/1',
            title: 'Poster Berge',
            handle: 'poster-berge',
            status: 'ACTIVE',
            descriptionHtml: '<p>x</p>',
            totalInventory: 12,
            updatedAt: '2026-10-20T10:00:00Z',
            priceRangeV2: { minVariantPrice: { amount: '29.90', currencyCode: 'EUR' } },
          },
        ],
      },
    },
    extensions: { cost: { throttleStatus: { currentlyAvailable: 900 } } },
  }

  const route = (url: string, body: RequestInit): unknown => {
    if (url.endsWith('/access_token')) return { access_token: 'tok', expires_in: 86400 }
    const q = JSON.parse(String(body.body)) as { query: string }
    if (q.query.includes('products(')) return productsResponse
    if (q.query.includes('orders(')) {
      const vars = (JSON.parse(String(body.body)) as { variables: { after?: string | null } }).variables
      const page1 = {
        nodes: [
          {
            id: 'gid://shopify/Order/1',
            name: '#1001',
            createdAt: '2026-10-21T09:00:00Z',
            currentTotalPriceSet: { shopMoney: { amount: '59.80', currencyCode: 'EUR' } },
            lineItems: { nodes: [{ title: 'Poster Berge', quantity: 2, originalTotalSet: { shopMoney: { amount: '59.80' } } }] },
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: 'c1' },
      }
      const page2 = {
        nodes: [
          {
            id: 'gid://shopify/Order/2',
            name: '#1002',
            createdAt: '2026-10-20T09:00:00Z',
            currentTotalPriceSet: { shopMoney: { amount: '29.90', currencyCode: 'EUR' } },
            lineItems: { nodes: [{ title: 'Poster Meer', quantity: 1, originalTotalSet: { shopMoney: { amount: '29.90' } } }] },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      }
      return { data: { orders: vars.after ? page2 : page1 }, extensions: { cost: { throttleStatus: { currentlyAvailable: 900 } } } }
    }
    if (q.query.includes('productUpdate')) return { data: { productUpdate: { product: { id: 'gid://shopify/Product/1', title: 'Neu' }, userErrors: [] } }, extensions: { cost: { throttleStatus: { currentlyAvailable: 900 } } } }
    return { errors: [{ message: 'unbekannte Abfrage' }] }
  }

  it('products prints a compact JSON list', async () => {
    const { fetch } = fakeFetch(route)
    const out: string[] = []
    const code = await main(['products', '--limit', '5'], { ...env, LIMITLESS_DATA_DIR: dataDir }, { fetch, stdout: (s) => out.push(s), stderr: () => {} })
    expect(code).toBe(0)
    const list = JSON.parse(out.join('')) as Array<Record<string, unknown>>
    expect(list[0]).toMatchObject({ id: 'gid://shopify/Product/1', title: 'Poster Berge', handle: 'poster-berge', totalInventory: 12, price: '29.90', currency: 'EUR' })
  })

  it('orders paginates with small pages (query cost ≤ 1000) and aggregates revenue by product', async () => {
    const { fetch, calls } = fakeFetch(route)
    const out: string[] = []
    const code = await main(['orders', '--days', '60'], { ...env, LIMITLESS_DATA_DIR: dataDir }, { fetch, stdout: (s) => out.push(s), stderr: () => {} })
    expect(code).toBe(0)
    const r = JSON.parse(out.join('')) as { count: number; revenue: number; currency: string; byProduct: Array<{ title: string; qty: number; revenue: number }> }
    expect(r).toMatchObject({ count: 2, revenue: 89.7, currency: 'EUR' })
    expect(r.byProduct).toEqual([
      { title: 'Poster Berge', qty: 2, revenue: 59.8 },
      { title: 'Poster Meer', qty: 1, revenue: 29.9 },
    ])
    const orderQueries = calls.filter((c) => String(c.init.body).includes('orders('))
    expect(orderQueries).toHaveLength(2)
    expect(String(orderQueries[0].init.body)).toContain('created_at:>=')
    expect(String(orderQueries[0].init.body)).toMatch(/orders\(first: 50/)
    expect(String(orderQueries[0].init.body)).toMatch(/lineItems\(first: 10\)/)
    expect((JSON.parse(String(orderQueries[1].init.body)) as { variables: { after: string } }).variables.after).toBe('c1')
  })

  it('update-product refuses without LIMITLESS_ALLOW_WRITES=1', async () => {
    const { fetch, calls } = fakeFetch(route)
    const err: string[] = []
    const code = await main(['update-product', 'gid://shopify/Product/1', '--title', 'Neu'], { ...env, LIMITLESS_DATA_DIR: dataDir }, { fetch, stdout: () => {}, stderr: (s) => err.push(s) })
    expect(code).toBe(2)
    expect(err.join('')).toMatch(/Schreiben nicht freigegeben/)
    expect(calls.filter((c) => String(c.init.body ?? '').includes('productUpdate'))).toHaveLength(0)
  })

  it('update-product writes, increments the daily counter and stops at the limit', async () => {
    const { fetch } = fakeFetch(route)
    const e = { ...env, LIMITLESS_DATA_DIR: dataDir, LIMITLESS_ALLOW_WRITES: '1', LIMITLESS_DAILY_SHOP_CHANGE_LIMIT: '2' }
    const err: string[] = []
    expect(await main(['update-product', 'gid://shopify/Product/1', '--title', 'Neu'], e, { fetch, stdout: () => {}, stderr: () => {} })).toBe(0)
    expect(await main(['update-product', 'gid://shopify/Product/1', '--description-html', '<p>b</p>'], e, { fetch, stdout: () => {}, stderr: () => {} })).toBe(0)
    const counters = JSON.parse(await readFile(join(dataDir, 'counters.json'), 'utf8')) as { date: string; shopChanges: number }
    expect(counters.shopChanges).toBe(2)
    expect(await main(['update-product', 'gid://shopify/Product/1', '--title', 'Drei'], e, { fetch, stdout: () => {}, stderr: (s) => err.push(s) })).toBe(3)
    expect(err.join('')).toMatch(/Tageslimit/)
  })

  it('resets the counter on a new day', async () => {
    await writeFile(join(dataDir, 'counters.json'), JSON.stringify({ date: '2000-01-01', shopChanges: 99 }), 'utf8')
    const { fetch } = fakeFetch(route)
    const e = { ...env, LIMITLESS_DATA_DIR: dataDir, LIMITLESS_ALLOW_WRITES: '1' }
    expect(await main(['update-product', 'gid://shopify/Product/1', '--title', 'Neu'], e, { fetch, stdout: () => {}, stderr: () => {} })).toBe(0)
    const counters = JSON.parse(await readFile(join(dataDir, 'counters.json'), 'utf8')) as { shopChanges: number }
    expect(counters.shopChanges).toBe(1)
  })

  it('prints usage for unknown commands', async () => {
    const err: string[] = []
    expect(await main(['nope'], env, { fetch: fakeFetch(route).fetch, stdout: () => {}, stderr: (s) => err.push(s) })).toBe(1)
    expect(err.join('')).toMatch(/products|orders|update-product/)
  })
})

describe('CLI upload-file', () => {
  it('stages, uploads, creates and polls the file until READY, then prints the CDN url', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const dataDir = await mkdtemp(join(tmpdir(), 'los-upload-'))
    const file = join(dataDir, 'slide.png')
    await writeFile(file, Buffer.from('89504e470d0a1a0a', 'hex'))
    let polls = 0
    const { fetch, calls } = fakeFetch(async (url, init) => {
      if (url.endsWith('/access_token')) return { access_token: 'tok', expires_in: 86400 }
      if (url === 'https://upload.example/target') return new Response('', { status: 201 })
      const q = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> }
      if (q.query.includes('stagedUploadsCreate')) {
        return {
          data: {
            stagedUploadsCreate: {
              stagedTargets: [{ url: 'https://upload.example/target', resourceUrl: 'https://upload.example/resource/slide.png', parameters: [{ name: 'key', value: 'k' }] }],
              userErrors: [],
            },
          },
          extensions: { cost: { throttleStatus: { currentlyAvailable: 900 } } },
        }
      }
      if (q.query.includes('fileCreate')) {
        return { data: { fileCreate: { files: [{ id: 'gid://shopify/MediaImage/9', fileStatus: 'UPLOADED' }], userErrors: [] } }, extensions: { cost: { throttleStatus: { currentlyAvailable: 900 } } } }
      }
      if (q.query.includes('node(')) {
        polls++
        return polls < 2
          ? { data: { node: { id: 'gid://shopify/MediaImage/9', fileStatus: 'PROCESSING' } }, extensions: { cost: { throttleStatus: { currentlyAvailable: 900 } } } }
          : { data: { node: { id: 'gid://shopify/MediaImage/9', fileStatus: 'READY', image: { url: 'https://cdn.shopify.com/s/files/slide.png' } } }, extensions: { cost: { throttleStatus: { currentlyAvailable: 900 } } } }
      }
      return { errors: [{ message: 'unbekannt' }] }
    })
    const out: string[] = []
    const code = await main(['upload-file', file], { ...env, LIMITLESS_DATA_DIR: dataDir, LIMITLESS_UPLOAD_POLL_MS: '1' }, { fetch, stdout: (s) => out.push(s), stderr: () => {} })
    expect(code).toBe(0)
    expect(JSON.parse(out.join(''))).toEqual({ ok: true, id: 'gid://shopify/MediaImage/9', url: 'https://cdn.shopify.com/s/files/slide.png', contentType: 'IMAGE' })
    const staged = calls.find((c) => String(c.init.body ?? '').includes('stagedUploadsCreate'))!
    const vars = (JSON.parse(String(staged.init.body)) as { variables: { input: Array<Record<string, unknown>> } }).variables.input[0]
    expect(vars).toMatchObject({ filename: 'slide.png', mimeType: 'image/png', resource: 'IMAGE', httpMethod: 'POST', fileSize: '8' })
    const upload = calls.find((c) => c.url === 'https://upload.example/target')!
    expect(upload.init.method).toBe('POST')
    expect(upload.init.body).toBeInstanceOf(FormData)
  })

  it('classifies mp4 as VIDEO and fails on a missing file', async () => {
    const err: string[] = []
    expect(await main(['upload-file', '/gibt/es/nicht.mp4'], env, { fetch: fakeFetch(() => ({})).fetch, stdout: () => {}, stderr: (s) => err.push(s) })).toBe(1)
    expect(err.join('')).toMatch(/nicht gefunden/)
  })
})
