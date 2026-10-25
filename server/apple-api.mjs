import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { parseAppleCalendar } from './apple-calendar.mjs'

loadEnv({ path: path.resolve('.env.local'), quiet: true })

const privateDir = path.resolve(process.env.DAYFRAME_PRIVATE_DIR || '.dayframe-private')
const storeFile = path.join(privateDir, 'apple-calendar.enc.json')

function encryptionKey() {
  const value = process.env.DAYFRAME_TOKEN_KEY
  return value && /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null
}

async function readStore(key) {
  try {
    const envelope = JSON.parse(await readFile(storeFile, 'utf8'))
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return { subscriptions: [] }
    throw new Error('Saved Apple calendars cannot be read. Check DAYFRAME_TOKEN_KEY.', { cause: error })
  }
}

async function writeStore(key, value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  await mkdir(privateDir, { recursive: true })
  const temporary = `${storeFile}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64') }), { mode: 0o600 })
  await rename(temporary, storeFile)
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}

function sameOrigin(req) {
  const host = req.headers.host || ''
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) &&
    (!req.headers.origin || req.headers.origin === `http://${host}`)
}

export function appleFeedUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null
  let address
  try { address = new URL(value.replace(/^webcal:\/\//i, 'https://')) } catch { return null }
  if (address.protocol !== 'https:' || address.username || address.password || address.port ||
    !/^(?:[a-z0-9-]+\.)?icloud\.com$/i.test(address.hostname) ||
    !address.pathname.startsWith('/published/') || address.hash) return null
  return address.toString()
}

async function calendarText(url, fetcher) {
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(12000),
    headers: { Accept: 'text/calendar' } })
  if (!response.ok) throw new Error('Apple calendar could not be downloaded. Check the sharing link.')
  const length = Number(response.headers.get('content-length') || 0)
  if (length > 4_000_000) throw new Error('Apple calendar feed is too large.')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 4_000_000) { await reader.cancel(); throw new Error('Apple calendar feed is too large.') }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function requestBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 5000) throw new Error('Request is too large.')
  }
  return JSON.parse(body)
}

export async function handleAppleRequest(req, res, fetcher = fetch) {
  const url = new URL(req.url || '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/apple/')) return false
  if (!sameOrigin(req)) { json(res, 403, { error: 'Open Dayframe on this computer.' }); return true }
  const key = encryptionKey()
  if (!key) { json(res, 503, { error: 'Set DAYFRAME_TOKEN_KEY before connecting Apple Calendar.' }); return true }
  const store = await readStore(key)
  const subscriptions = Array.isArray(store.subscriptions) ? store.subscriptions : []
  if (url.pathname === '/api/apple/status' && req.method === 'GET') {
    json(res, 200, { subscriptions: subscriptions.map(({ id, name }) => ({ id, name })) })
    return true
  }
  if (url.pathname === '/api/apple/subscription' && req.method === 'PUT') {
    let body
    try { body = await requestBody(req) } catch { json(res, 400, { error: 'Enter a calendar name and sharing link.' }); return true }
    const feedUrl = appleFeedUrl(body?.url)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!feedUrl || !name || name.length > 100) {
      json(res, 400, { error: 'Enter a name and an iCloud public calendar link.' }); return true
    }
    const id = `apple:${createHash('sha256').update(feedUrl).digest('hex').slice(0, 16)}`
    if (!subscriptions.some(item => item.id === id) && subscriptions.length >= 10) {
      json(res, 400, { error: 'Dayframe can show up to ten Apple calendars.' }); return true
    }
    const calendar = { id, name }
    try {
      const text = await calendarText(feedUrl, fetcher)
      parseAppleCalendar(text, calendar, new Date(), new Date(Date.now() + 86400000))
    } catch (error) { json(res, 422, { error: error.message || 'Could not read the calendar.' }); return true }
    await writeStore(key, { subscriptions: [...subscriptions.filter(item => item.id !== id), { ...calendar, url: feedUrl }] })
    json(res, 200, { subscriptions: [...subscriptions.filter(item => item.id !== id), calendar]
      .map(({ id: itemId, name: itemName }) => ({ id: itemId, name: itemName })) })
    return true
  }
  if (url.pathname === '/api/apple/subscription' && req.method === 'DELETE') {
    const id = url.searchParams.get('id')
    await writeStore(key, { subscriptions: subscriptions.filter(item => item.id !== id) })
    json(res, 200, { subscriptions: subscriptions.filter(item => item.id !== id).map(({ id: itemId, name }) => ({ id: itemId, name })) })
    return true
  }
  if (url.pathname === '/api/apple/events' && req.method === 'GET') {
    const start = new Date(url.searchParams.get('start') || '')
    const end = new Date(url.searchParams.get('end') || '')
    const length = end.getTime() - start.getTime()
    if (Number.isNaN(length) || length <= 0 || length > 45 * 86400000) {
      json(res, 400, { error: 'Choose a valid range of at most 45 days.' }); return true
    }
    const groups = await Promise.all(subscriptions.map(async calendar => {
      const text = await calendarText(calendar.url, fetcher)
      return parseAppleCalendar(text, calendar, start, end)
    }))
    json(res, 200, { events: groups.flat().sort((a, b) => a.start.localeCompare(b.start)) })
    return true
  }
  json(res, 404, { error: 'Unknown Apple calendar action.' })
  return true
}

export function appleError(res, error) {
  json(res, 502, { error: error instanceof Error ? error.message : 'Apple Calendar could not refresh.' })
}
