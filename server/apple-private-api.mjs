import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import ICAL from 'ical.js'
import { DAVClient } from 'tsdav'
import { parseAppleCalendar } from './apple-calendar.mjs'

loadEnv({ path: path.resolve('.env.local'), quiet: true })
const privateDir = path.resolve(process.env.DAYFRAME_PRIVATE_DIR || '.dayframe-private')
const storeFile = path.join(privateDir, 'icloud-account.enc.json')
const serverUrl = 'https://caldav.icloud.com'

function key() {
  const value = process.env.DAYFRAME_TOKEN_KEY
  return value && /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null
}

async function readAccount(secret) {
  try {
    const envelope = JSON.parse(await readFile(storeFile, 'utf8'))
    const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error('Saved iCloud account cannot be read. Check DAYFRAME_TOKEN_KEY.', { cause: error })
  }
}

async function writeAccount(secret, account) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secret, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(account), 'utf8'), cipher.final()])
  await mkdir(privateDir, { recursive: true })
  const temporary = `${storeFile}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64') }), { mode: 0o600 })
  await rename(temporary, storeFile)
}

function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(data))
}

function sameOrigin(req) {
  const host = req.headers.host || ''
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) &&
    (!req.headers.origin || req.headers.origin === `http://${host}`)
}

async function bodyOf(req) {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (text.length > 12000) throw new Error('Request is too large.')
  }
  return JSON.parse(text)
}

function iCloudUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^(?:[a-z0-9-]+\.)?icloud\.com$/i.test(url.hostname)
  } catch { return false }
}

function calendarId(url) { return `icloud:${createHash('sha256').update(url).digest('hex').slice(0, 20)}` }
function calendarList(calendars) {
  return calendars.filter(item => iCloudUrl(item.url) && (!item.components || item.components.includes('VEVENT')))
    .map(item => ({ id: calendarId(item.url), name: typeof item.displayName === 'string' ? item.displayName : 'iCloud Calendar' }))
}

async function liveClient(account) {
  const client = new DAVClient({ serverUrl, credentials: { username: account.username, password: account.password },
    authMethod: 'Basic', defaultAccountType: 'caldav', fetchOptions: { signal: AbortSignal.timeout(15000) } })
  await client.login({ loadCollections: true, loadObjects: false })
  return client
}

function discovered(client) { return (client.account?.calendars || []).filter(item =>
  iCloudUrl(item.url) && (!item.components || item.components.includes('VEVENT'))) }
function chosenCalendar(client, account, id) {
  return discovered(client).find(item => calendarId(item.url) === id && account.selectedIds?.includes(id))
}

function validEvent(body) {
  if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200 ||
    typeof body.allDay !== 'boolean' || typeof body.start !== 'string' || typeof body.end !== 'string' ||
    typeof body.location !== 'string' || body.location.length > 1000 ||
    typeof body.description !== 'string' || body.description.length > 10000) return false
  if (body.allDay) return /^\d{4}-\d{2}-\d{2}$/.test(body.start) && /^\d{4}-\d{2}-\d{2}$/.test(body.end) &&
    !Number.isNaN(Date.parse(body.start)) && !Number.isNaN(Date.parse(body.end)) && body.end > body.start
  return !Number.isNaN(Date.parse(body.start)) && !Number.isNaN(Date.parse(body.end)) &&
    new Date(body.end) > new Date(body.start)
}

function updateComponent(component, body) {
  const start = body.allDay ? ICAL.Time.fromDateString(body.start) : ICAL.Time.fromJSDate(new Date(body.start), true)
  const end = body.allDay ? ICAL.Time.fromDateString(body.end) : ICAL.Time.fromJSDate(new Date(body.end), true)
  component.updatePropertyWithValue('summary', body.title.trim())
  component.updatePropertyWithValue('dtstart', start)
  component.updatePropertyWithValue('dtend', end)
  component.updatePropertyWithValue('location', body.location.trim())
  component.updatePropertyWithValue('description', body.description)
  component.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
}

function createIcs(body) {
  const root = new ICAL.Component('vcalendar')
  root.addPropertyWithValue('version', '2.0')
  root.addPropertyWithValue('prodid', '-//Dayframe//iCloud Calendar//EN')
  const event = new ICAL.Component('vevent')
  event.addPropertyWithValue('uid', randomUUID())
  root.addSubcomponent(event)
  updateComponent(event, body)
  return root.toString()
}

function normalObjectUrl(url, calendar) {
  return iCloudUrl(url) && url.startsWith(calendar.url.endsWith('/') ? calendar.url : `${calendar.url}/`)
}

function status(account) {
  return { configured: Boolean(key()), connected: Boolean(account), writeEnabled: process.env.DAYFRAME_ICLOUD_WRITE_ENABLED === '1',
    calendars: account?.calendars || [], selectedIds: account?.selectedIds || [] }
}

export async function handlePrivateAppleRequest(req, res, clientFactory = liveClient) {
  const url = new URL(req.url || '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/icloud/')) return false
  if (!sameOrigin(req)) { reply(res, 403, { error: 'Open Dayframe on this computer.' }); return true }
  const secret = key()
  if (!secret) { reply(res, 503, { error: 'Set DAYFRAME_TOKEN_KEY before connecting iCloud.' }); return true }
  const account = await readAccount(secret)
  const route = url.pathname.slice('/api/icloud'.length)
  if (route === '/status' && req.method === 'GET') { reply(res, 200, status(account)); return true }
  if (route === '/connect' && req.method === 'PUT') {
    let body
    try { body = await bodyOf(req) } catch { reply(res, 400, { error: 'Enter your Apple Account email and app-specific password.' }); return true }
    if (typeof body?.username !== 'string' || !/^\S+@\S+\.\S+$/.test(body.username) || body.username.length > 320 ||
      typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 100) {
      reply(res, 400, { error: 'Enter your Apple Account email and app-specific password.' }); return true
    }
    const candidate = { username: body.username.trim(), password: body.password, selectedIds: [] }
    let client
    try { client = await clientFactory(candidate) }
    catch { reply(res, 401, { error: 'iCloud sign-in failed. Check the app-specific password and try again.' }); return true }
    const calendars = calendarList(discovered(client))
    if (!calendars.length) { reply(res, 422, { error: 'No iCloud event calendars were found.' }); return true }
    candidate.calendars = calendars
    candidate.selectedIds = account?.username === candidate.username ? (account.selectedIds || []).filter(id => calendars.some(c => c.id === id)) : []
    await writeAccount(secret, candidate)
    reply(res, 200, status(candidate)); return true
  }
  if (route === '/connect' && req.method === 'DELETE') {
    await unlink(storeFile).catch(error => { if (error.code !== 'ENOENT') throw error })
    reply(res, 200, status(null)); return true
  }
  if (!account) { reply(res, 401, { error: 'Connect your iCloud account first.' }); return true }
  if (route === '/calendars' && req.method === 'GET') {
    const client = await clientFactory(account)
    const calendars = calendarList(discovered(client))
    await writeAccount(secret, { ...account, calendars, selectedIds: account.selectedIds.filter(id => calendars.some(c => c.id === id)) })
    reply(res, 200, { calendars, selectedIds: account.selectedIds.filter(id => calendars.some(c => c.id === id)) }); return true
  }
  if (route === '/selection' && req.method === 'PUT') {
    let body
    try { body = await bodyOf(req) } catch { reply(res, 400, { error: 'Choose iCloud calendars.' }); return true }
    if (!Array.isArray(body?.selectedIds) || body.selectedIds.length > 20 ||
      body.selectedIds.some(id => typeof id !== 'string' || !account.calendars.some(calendar => calendar.id === id))) {
      reply(res, 400, { error: 'Choose iCloud calendars.' }); return true
    }
    const next = { ...account, selectedIds: [...new Set(body.selectedIds)] }
    await writeAccount(secret, next)
    reply(res, 200, status(next)); return true
  }
  if (route === '/events' && req.method === 'GET') {
    const start = new Date(url.searchParams.get('start') || '')
    const end = new Date(url.searchParams.get('end') || '')
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || end - start > 45 * 86400000) {
      reply(res, 400, { error: 'Choose a range of at most 45 days.' }); return true
    }
    const client = await clientFactory(account)
    const groups = await Promise.all(discovered(client).filter(calendar => account.selectedIds.includes(calendarId(calendar.url)))
      .map(async calendar => {
        const id = calendarId(calendar.url)
        const label = account.calendars.find(item => item.id === id)?.name || 'iCloud Calendar'
        const objects = await client.fetchCalendarObjects({ calendar, timeRange: { start: start.toISOString(), end: end.toISOString() } })
        return objects.flatMap(object => {
          if (!normalObjectUrl(object.url, calendar) || typeof object.data !== 'string') return []
          const parsed = parseAppleCalendar(object.data, { id, name: label }, start, end, 'icloud')
          const root = new ICAL.Component(ICAL.parse(object.data))
          const components = root.getAllSubcomponents('vevent')
          const editable = components.length === 1 && !components[0].hasProperty('rrule') &&
            !components[0].hasProperty('rdate') && !components[0].hasProperty('recurrence-id')
          return parsed.map(event => ({ ...event, appleObjectUrl: object.url, etag: object.etag, editable }))
        })
      }))
    reply(res, 200, { events: groups.flat().sort((a, b) => a.start.localeCompare(b.start)) }); return true
  }
  if (route === '/event' && (req.method === 'POST' || req.method === 'PUT')) {
    if (process.env.DAYFRAME_ICLOUD_WRITE_ENABLED !== '1') {
      reply(res, 403, { error: 'iCloud editing is waiting for approval and a test calendar.' }); return true
    }
    let body
    try { body = await bodyOf(req) } catch { reply(res, 400, { error: 'Enter valid event details.' }); return true }
    if (!validEvent(body) || typeof body.calendarId !== 'string') {
      reply(res, 400, { error: 'Enter a title and a valid start and end time.' }); return true
    }
    const client = await clientFactory(account)
    const calendar = chosenCalendar(client, account, body.calendarId)
    if (!calendar) { reply(res, 403, { error: 'Choose a selected iCloud calendar.' }); return true }
    let response
    if (req.method === 'POST') {
      response = await client.createCalendarObject({ calendar, filename: `${randomUUID()}.ics`, iCalString: createIcs(body),
        headers: { 'If-None-Match': '*' } })
    } else {
      if (typeof body.objectUrl !== 'string' || !normalObjectUrl(body.objectUrl, calendar) || typeof body.etag !== 'string') {
        reply(res, 400, { error: 'Refresh the event before editing.' }); return true
      }
      const objects = await client.fetchCalendarObjects({ calendar, objectUrls: [body.objectUrl] })
      const original = objects.find(item => item.url === body.objectUrl)
      if (!original || original.etag !== body.etag || typeof original.data !== 'string') {
        reply(res, 409, { error: 'This iCloud event changed. Refresh before editing.' }); return true
      }
      const root = new ICAL.Component(ICAL.parse(original.data))
      const components = root.getAllSubcomponents('vevent')
      if (components.length !== 1 || ['rrule', 'rdate', 'recurrence-id'].some(name => components[0].hasProperty(name))) {
        reply(res, 403, { error: 'Repeating iCloud events cannot be edited in Dayframe yet.' }); return true
      }
      updateComponent(components[0], body)
      response = await client.updateCalendarObject({ calendarObject: { url: original.url, data: root.toString(), etag: original.etag } })
    }
    if (!response.ok) { reply(res, response.status === 412 ? 409 : 502,
      { error: response.status === 412 ? 'This iCloud event changed. Refresh before editing.' : 'iCloud did not save the event.' }); return true }
    reply(res, 200, { saved: true }); return true
  }
  reply(res, 404, { error: 'Unknown iCloud action.' }); return true
}

export function privateAppleError(res, error) {
  reply(res, 502, { error: error instanceof Error ? error.message : 'iCloud could not refresh.' })
}
