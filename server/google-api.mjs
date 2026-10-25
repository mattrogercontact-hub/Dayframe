import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OAuth2Client } from 'google-auth-library'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: path.resolve('.env.local'), quiet: true })

const readScope = 'https://www.googleapis.com/auth/calendar.readonly'
const writeScope = 'https://www.googleapis.com/auth/calendar.events'
const keepScope = 'https://www.googleapis.com/auth/keep.readonly'
const scope = [readScope, writeScope]
const privateDir = path.resolve(process.env.DAYFRAME_PRIVATE_DIR || '.dayframe-private')
const tokenFile = path.join(privateDir, 'google-calendar.enc.json')
const keepTokenFile = path.join(privateDir, 'google-keep.enc.json')
const categories = ['family', 'work', 'home', 'errands', 'fun']
const pending = new Map()

function configuration() {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_REDIRECT_URI: redirectUri, DAYFRAME_TOKEN_KEY: tokenKey } = process.env
  const key = tokenKey && /^[0-9a-f]{64}$/i.test(tokenKey) ? Buffer.from(tokenKey, 'hex') : null
  return { clientId, clientSecret, redirectUri: redirectUri || 'http://localhost:5173/api/calendar/callback', key,
    configured: Boolean(clientId && clientSecret && key) }
}

function clientFor(settings, refreshToken) {
  const client = new OAuth2Client(settings.clientId, settings.clientSecret, settings.redirectUri)
  if (refreshToken) client.setCredentials({ refresh_token: refreshToken })
  return client
}

async function readStore(key, file = tokenFile) {
  try {
    const envelope = JSON.parse(await readFile(file, 'utf8'))
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error('Saved Google connection cannot be read. Check DAYFRAME_TOKEN_KEY.', { cause: error })
  }
}

async function writeStore(key, value, file = tokenFile) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  await mkdir(privateDir, { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 })
  await rename(temporary, file)
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}

function fail(res, status, message) { json(res, status, { error: message }) }

function sameOrigin(req) {
  const host = req.headers.host || ''
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return false
  return !req.headers.origin || req.headers.origin === `http://${host}`
}

async function requestBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 20000) throw new Error('Request is too large')
  }
  return JSON.parse(body)
}

async function googlePages(client, url) {
  const items = []
  let pageToken
  do {
    const page = new URL(url)
    if (pageToken) page.searchParams.set('pageToken', pageToken)
    const result = await client.request({ url: page.toString() })
    items.push(...(result.data.items || []))
    pageToken = result.data.nextPageToken
  } while (pageToken)
  return items
}

async function calendarsFor(client) {
  const items = await googlePages(client, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250')
  return items.filter(item => item.id && !item.deleted).map(item => ({ id: item.id, name: item.summary || item.id,
    primary: Boolean(item.primary), accessRole: item.accessRole, colorId: item.colorId,
    backgroundColor: item.backgroundColor, foregroundColor: item.foregroundColor }))
}

function canWriteCalendar(calendar) { return calendar && ['owner', 'writer'].includes(calendar.accessRole) }
function writeGranted(store) { return Array.isArray(store?.scopes) && store.scopes.includes(writeScope) }

export function eventChanges(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const { title, start, end, allDay, location, description } = body
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof start !== 'string' ||
    typeof end !== 'string' || typeof allDay !== 'boolean' || typeof location !== 'string' || location.length > 1000 ||
    typeof description !== 'string' || description.length > 10000) return null
  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
      Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) ||
      new Date(start).toISOString().slice(0, 10) !== start || new Date(end).toISOString().slice(0, 10) !== end || end <= start) return null
  } else if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(end) ||
    Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) ||
    new Date(end) <= new Date(start)) return null
  const fields = { summary: title.trim(), start: allDay ? { date: start } : { dateTime: start },
    end: allDay ? { date: end } : { dateTime: end }, location: location.trim(), description }
  if (body.repeat && body.repeat !== 'none') {
    const frequency = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[body.repeat]
    if (!frequency || typeof body.timeZone !== 'string') return null
    try { new Intl.DateTimeFormat('en-US', { timeZone: body.timeZone }) } catch { return null }
    if (body.repeatUntil && (!/^\d{4}-\d{2}-\d{2}$/.test(body.repeatUntil) || body.repeatUntil < start.slice(0, 10))) return null
    let until = ''
    if (body.repeatUntil) {
      if (allDay) until = `;UNTIL=${body.repeatUntil.replaceAll('-', '')}`
      else {
        const date = new Date(body.repeatUntilUtc || '')
        if (Number.isNaN(date.getTime()) || date.toISOString() !== body.repeatUntilUtc || date < new Date(start)) return null
        until = `;UNTIL=${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`
      }
    }
    if (!allDay) {
      fields.start.timeZone = body.timeZone
      fields.end.timeZone = body.timeZone
    }
    fields.recurrence = [`RRULE:FREQ=${frequency}${until}`]
  }
  return fields
}

function validColor(value) { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) }

function luminance(hex) {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function readableColor(background, preferred) {
  if (!validColor(background)) return undefined
  const contrast = color => {
    const high = Math.max(luminance(background), luminance(color))
    const low = Math.min(luminance(background), luminance(color))
    return (high + 0.05) / (low + 0.05)
  }
  const dark = '#172421'
  const light = '#fffdf8'
  const foreground = validColor(preferred) && contrast(preferred) >= 4.5 ? preferred
    : contrast(dark) >= contrast(light) ? dark : light
  return { background, foreground }
}

export function mapGoogleEvent(item, calendar, index, palette = {}) {
  if (!item.id || item.status === 'cancelled') return null
  const allDay = Boolean(item.start?.date && item.end?.date)
  const start = item.start?.dateTime || (allDay ? `${item.start.date}T00:00:00` : null)
  const end = item.end?.dateTime || (allDay ? `${item.end.date}T00:00:00` : null)
  if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return null
  const override = item.colorId && palette.event?.[item.colorId]
  const calendarColor = calendar.colorId && palette.calendar?.[calendar.colorId]
  const color = readableColor(override?.background || calendar.backgroundColor || calendarColor?.background,
    override?.foreground || calendar.foregroundColor || calendarColor?.foreground)
  return { id: `google:${calendar.id}:${item.id}`, title: item.summary || 'Untitled event', start, end,
    allDay, category: categories[index % categories.length], calendarName: calendar.name,
    color, description: item.description || undefined, location: item.location || undefined,
    googleUrl: item.htmlLink || undefined, calendarId: calendar.id, googleEventId: item.id, etag: item.etag,
    recurringEventId: item.recurringEventId || undefined, recurrence: item.recurrence || undefined,
    editable: canWriteCalendar(calendar) && (!item.eventType || item.eventType === 'default') &&
      !item.locked, source: 'google' }
}

async function authorizedClient(settings, store) {
  const client = clientFor(settings, store.refreshToken)
  return client
}

async function refreshStoreIfNeeded(settings, store, client, file = tokenFile) {
  const rotated = client.credentials.refresh_token
  if (rotated && rotated !== store.refreshToken) await writeStore(settings.key, { ...store, refreshToken: rotated }, file)
}

async function keepNotesFor(client) {
  const notes = []
  let pageToken
  let pages = 0
  do {
    const address = new URL('https://keep.googleapis.com/v1/notes')
    address.searchParams.set('pageSize', '100')
    if (pageToken) address.searchParams.set('pageToken', pageToken)
    const result = await client.request({ url: address.toString() })
    notes.push(...(result.data.notes || []).filter(note => !note.trashed && note.body?.list))
    pageToken = result.data.nextPageToken
    pages += 1
  } while (pageToken && notes.length < 500 && pages < 20)
  return notes.map(note => ({ name: note.name, title: note.title || 'Untitled list',
    itemCount: note.body.list.listItems?.length || 0, updated: note.updateTime }))
}

function keepListItems(items = [], level = 0, parent = '') {
  return items.flatMap((item, index) => [
    { id: item.name || `${parent}${index}`, text: item.text?.text || '', checked: Boolean(item.checked), level },
    ...(level === 0 ? keepListItems(item.childListItems || [], 1, `${parent}${index}-`) : []),
  ])
}

export async function handleCalendarRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost:5173'}`)
  if (!url.pathname.startsWith('/api/calendar/')) return false
  if (!sameOrigin(req)) { fail(res, 403, 'This connector is available only from localhost.'); return true }
  const settings = configuration()
  const route = url.pathname.slice('/api/calendar'.length)
  if (route === '/status' && req.method === 'GET') {
    if (!settings.configured) { json(res, 200, { configured: false, connected: false, selectedIds: [] }); return true }
    const store = await readStore(settings.key)
    json(res, 200, { configured: true, connected: Boolean(store?.refreshToken), writeEnabled: writeGranted(store),
      selectedIds: store?.selectedIds || [] })
    return true
  }
  if (route === '/keep/status' && req.method === 'GET') {
    if (!settings.configured) { json(res, 200, { configured: false, connected: false, selectedNoteName: null }); return true }
    const store = await readStore(settings.key, keepTokenFile)
    json(res, 200, { configured: true, connected: Boolean(store?.refreshToken), selectedNoteName: store?.selectedNoteName || null })
    return true
  }
  if (!settings.configured) { fail(res, 503, 'Google Calendar needs server configuration.'); return true }
  if ((route === '/connect' || route === '/keep/connect') && req.method === 'GET') {
    const state = randomBytes(32).toString('hex')
    const kind = route === '/keep/connect' ? 'keep' : 'calendar'
    pending.set(state, { expiry: Date.now() + 10 * 60 * 1000, kind })
    const client = clientFor(settings)
    const destination = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent',
      include_granted_scopes: kind === 'calendar', scope: kind === 'calendar' ? scope : keepScope, state })
    const secure = settings.redirectUri.startsWith('https:') ? '; Secure' : ''
    res.writeHead(302, { Location: destination, 'Set-Cookie': `dayframe_oauth=${state}; HttpOnly; SameSite=Lax; Path=/api/calendar; Max-Age=600${secure}`, 'Cache-Control': 'no-store' })
    res.end()
    return true
  }
  if (route === '/callback' && req.method === 'GET') {
    const state = url.searchParams.get('state')
    const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('dayframe_oauth='))?.slice('dayframe_oauth='.length)
    const pendingRequest = state && pending.get(state)
    if (state) pending.delete(state)
    if (!state || cookie !== state || !pendingRequest || pendingRequest.expiry < Date.now() || !url.searchParams.get('code')) {
      fail(res, 400, 'Google authorization was cancelled or expired. Please try Connect again.')
      return true
    }
    const client = clientFor(settings)
    const { tokens } = await client.getToken(url.searchParams.get('code'))
    if (!tokens.refresh_token) { fail(res, 502, 'Google did not return offline access. Please try Connect again.'); return true }
    client.setCredentials(tokens)
    if (pendingRequest.kind === 'keep') {
      const prior = await readStore(settings.key, keepTokenFile)
      await writeStore(settings.key, { refreshToken: tokens.refresh_token, selectedNoteName: prior?.selectedNoteName || null }, keepTokenFile)
      res.writeHead(303, { Location: '/?keep=connected', 'Set-Cookie': 'dayframe_oauth=; HttpOnly; SameSite=Lax; Path=/api/calendar; Max-Age=0', 'Cache-Control': 'no-store' })
      res.end()
      return true
    }
    const calendars = await calendarsFor(client)
    const prior = await readStore(settings.key)
    const available = new Set(calendars.map(calendar => calendar.id))
    const selectedIds = prior?.selectedIds?.filter(id => available.has(id)) ||
      calendars.filter(calendar => calendar.primary).map(calendar => calendar.id)
    if (!selectedIds.length && calendars[0]) selectedIds.push(calendars[0].id)
    await writeStore(settings.key, { refreshToken: tokens.refresh_token, selectedIds,
      scopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ') : [] })
    res.writeHead(303, { Location: '/?calendar=connected', 'Set-Cookie': 'dayframe_oauth=; HttpOnly; SameSite=Lax; Path=/api/calendar; Max-Age=0', 'Cache-Control': 'no-store' })
    res.end()
    return true
  }
  if (route.startsWith('/keep/')) {
    const store = await readStore(settings.key, keepTokenFile)
    if (!store?.refreshToken) { fail(res, 401, 'Connect Google Keep first.'); return true }
    const client = await authorizedClient(settings, store)
    try {
      if (route === '/keep/notes' && req.method === 'GET') {
        const notes = await keepNotesFor(client)
        await refreshStoreIfNeeded(settings, store, client, keepTokenFile)
        json(res, 200, { notes, selectedNoteName: store.selectedNoteName || null })
        return true
      }
      if (route === '/keep/selection' && req.method === 'PUT') {
        let body
        try { body = await requestBody(req) } catch { fail(res, 400, 'Choose a valid Keep list.'); return true }
        const notes = await keepNotesFor(client)
        if (typeof body.name !== 'string' || !notes.some(note => note.name === body.name)) {
          fail(res, 400, 'Choose a list from your Google Keep notes.'); return true
        }
        await writeStore(settings.key, { ...store, selectedNoteName: body.name }, keepTokenFile)
        json(res, 200, { selectedNoteName: body.name })
        return true
      }
      if (route === '/keep/items' && req.method === 'GET') {
        if (!store.selectedNoteName || !/^notes\/[^/]+$/.test(store.selectedNoteName)) {
          fail(res, 404, 'Choose a Keep list in Display settings.'); return true
        }
        const result = await client.request({ url: `https://keep.googleapis.com/v1/${store.selectedNoteName}` })
        const note = result.data
        if (note.trashed || !note.body?.list) { fail(res, 404, 'This Keep list is no longer available.'); return true }
        await refreshStoreIfNeeded(settings, store, client, keepTokenFile)
        json(res, 200, { note: { title: note.title || 'Untitled list', updated: note.updateTime,
          items: keepListItems(note.body.list.listItems) } })
        return true
      }
    } catch (error) {
      if (error?.response?.status === 403) { fail(res, 403, 'Google Keep API is unavailable for this account or project.'); return true }
      if (error?.response?.status === 401) { fail(res, 401, 'Google Keep connection expired. Reconnect in Display.'); return true }
      fail(res, 502, 'Google Keep could not be reached. Try again later.')
      return true
    }
  }
  const store = await readStore(settings.key)
  if (!store?.refreshToken) { fail(res, 401, 'Connect Google Calendar first.'); return true }
  const client = await authorizedClient(settings, store)
  if (route === '/event' && req.method === 'DELETE') {
    if (!writeGranted(store)) { fail(res, 403, 'Reconnect Google Calendar to allow event deletion.'); return true }
    let body
    try { body = await requestBody(req) } catch { fail(res, 400, 'Choose an event to delete.'); return true }
    if (typeof body?.calendarId !== 'string' || typeof body?.eventId !== 'string' ||
      typeof body?.etag !== 'string' || !body.calendarId || !body.eventId || !body.etag ||
      body.calendarId.length > 500 || body.eventId.length > 1000) {
      fail(res, 400, 'Choose an event to delete.'); return true
    }
    const calendars = await calendarsFor(client)
    const calendar = calendars.find(item => item.id === body.calendarId && (store.selectedIds || []).includes(item.id))
    if (!canWriteCalendar(calendar)) { fail(res, 403, 'This calendar cannot be edited.'); return true }
    const eventUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(body.calendarId)}/events/${encodeURIComponent(body.eventId)}`
    const original = (await client.request({ url: eventUrl })).data
    if (original.etag !== body.etag) { fail(res, 409, 'This event changed in Google Calendar. Refresh before deleting it.'); return true }
    if (original.locked || (original.eventType && original.eventType !== 'default') ||
      (original.recurringEventId && body.scope !== 'occurrence') ||
      (original.recurrence && body.scope !== 'series') ||
      (body.scope === 'series' && !original.recurrence)) {
      fail(res, 403, 'This event cannot be deleted in the selected way.'); return true
    }
    try { await client.request({ url: eventUrl, method: 'DELETE', headers: { 'If-Match': body.etag } }) }
    catch (error) {
      if (error?.response?.status === 412) { fail(res, 409, 'This event changed in Google Calendar. Refresh before deleting it.'); return true }
      throw error
    }
    await refreshStoreIfNeeded(settings, store, client)
    json(res, 200, { deleted: true })
    return true
  }
  if (route === '/series' && req.method === 'GET') {
    const calendarId = url.searchParams.get('calendarId')
    const eventId = url.searchParams.get('eventId')
    if (!calendarId || !eventId || calendarId.length > 500 || eventId.length > 1000) {
      fail(res, 400, 'Choose a repeating event.'); return true
    }
    const calendars = await calendarsFor(client)
    const calendar = calendars.find(item => item.id === calendarId && (store.selectedIds || []).includes(item.id))
    if (!canWriteCalendar(calendar) || !writeGranted(store)) { fail(res, 403, 'This calendar cannot be edited.'); return true }
    const original = (await client.request({ url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}` })).data
    if (!original.recurrence || original.locked || (original.eventType && original.eventType !== 'default')) {
      fail(res, 403, 'This repeating series cannot be edited here.'); return true
    }
    json(res, 200, { event: mapGoogleEvent(original, calendar, 0) })
    return true
  }
  if (route === '/event' && (req.method === 'POST' || req.method === 'PUT')) {
    if (!writeGranted(store)) { fail(res, 403, 'Reconnect Google Calendar to allow event editing.'); return true }
    let body
    try { body = await requestBody(req) } catch { fail(res, 400, 'Invalid event details.'); return true }
    const fields = eventChanges(body)
    if (!fields || typeof body.calendarId !== 'string' || !body.calendarId || body.calendarId.length > 500) {
      fail(res, 400, 'Enter a title and a valid start and end time.'); return true
    }
    const calendars = await calendarsFor(client)
    const calendar = calendars.find(item => item.id === body.calendarId && (store.selectedIds || []).includes(item.id))
    if (!canWriteCalendar(calendar)) { fail(res, 403, 'Choose a selected calendar you can edit.'); return true }
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(body.calendarId)}/events`
    if (req.method === 'POST') {
      await client.request({ url: base, method: 'POST', data: fields })
    } else {
      if (typeof body.eventId !== 'string' || !body.eventId || body.eventId.length > 1000 ||
        typeof body.etag !== 'string' || !body.etag) { fail(res, 400, 'Refresh the event before editing it.'); return true }
      const eventUrl = `${base}/${encodeURIComponent(body.eventId)}`
      const original = (await client.request({ url: eventUrl })).data
      if (original.etag !== body.etag) { fail(res, 409, 'This event changed in Google Calendar. Refresh before editing.'); return true }
      if (original.locked || (original.eventType && original.eventType !== 'default') ||
        (original.recurringEventId && body.scope !== 'occurrence') ||
        (original.recurrence && body.scope !== 'series') ||
        (body.scope === 'series' && !original.recurrence) || fields.recurrence) {
        fail(res, 403, 'This event cannot be edited in the selected way.'); return true
      }
      try { await client.request({ url: eventUrl, method: 'PATCH', headers: { 'If-Match': body.etag }, data: fields }) }
      catch (error) {
        if (error?.response?.status === 412) { fail(res, 409, 'This event changed in Google Calendar. Refresh before editing.'); return true }
        throw error
      }
    }
    await refreshStoreIfNeeded(settings, store, client)
    json(res, 200, { saved: true })
    return true
  }
  if (route === '/calendars' && req.method === 'GET') {
    const calendars = await calendarsFor(client)
    await refreshStoreIfNeeded(settings, store, client)
    json(res, 200, { calendars, selectedIds: store.selectedIds || [] })
    return true
  }
  if (route === '/selection' && req.method === 'PUT') {
    let body
    try { body = await requestBody(req) } catch { fail(res, 400, 'Invalid calendar selection.'); return true }
    if (!Array.isArray(body.selectedIds) || body.selectedIds.length > 20 || body.selectedIds.some(id => typeof id !== 'string')) {
      fail(res, 400, 'Invalid calendar selection.'); return true
    }
    const calendars = await calendarsFor(client)
    const available = new Set(calendars.map(calendar => calendar.id))
    if (body.selectedIds.some(id => !available.has(id))) { fail(res, 400, 'Choose calendars from the available list.'); return true }
    const selectedIds = [...new Set(body.selectedIds)]
    await writeStore(settings.key, { ...store, selectedIds })
    json(res, 200, { selectedIds })
    return true
  }
  if (route === '/events' && req.method === 'GET') {
    const start = new Date(url.searchParams.get('start') || '')
    const end = new Date(url.searchParams.get('end') || '')
    const length = end.getTime() - start.getTime()
    if (Number.isNaN(length) || length <= 0 || length > 45 * 86400000) { fail(res, 400, 'Choose a valid range of at most 45 days.'); return true }
    const calendars = await calendarsFor(client)
    const selected = (store.selectedIds || []).map(id => calendars.find(calendar => calendar.id === id)).filter(Boolean)
    const palette = selected.length ? (await client.request({ url: 'https://www.googleapis.com/calendar/v3/colors' })).data : {}
    const batches = await Promise.all(selected.map(async (calendar, index) => {
      const address = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`)
      address.searchParams.set('timeMin', start.toISOString())
      address.searchParams.set('timeMax', end.toISOString())
      address.searchParams.set('singleEvents', 'true')
      address.searchParams.set('orderBy', 'startTime')
      address.searchParams.set('maxResults', '2500')
      return (await googlePages(client, address.toString())).map(item => mapGoogleEvent(item, calendar, index, palette)).filter(Boolean)
    }))
    await refreshStoreIfNeeded(settings, store, client)
    json(res, 200, { events: batches.flat().sort((a, b) => a.start.localeCompare(b.start)) })
    return true
  }
  if (route === '/disconnect' && req.method === 'POST') {
    try { await client.revokeToken(store.refreshToken) } catch { /* Local disconnect still succeeds. */ }
    await writeStore(settings.key, { refreshToken: null, selectedIds: [] })
    json(res, 200, { connected: false })
    return true
  }
  fail(res, 404, 'Unknown calendar action.')
  return true
}

export function calendarError(res, error) {
  const status = error?.code === 401 || error?.response?.status === 401 || error?.message?.includes('invalid_grant') ? 401 : 502
  fail(res, status, status === 401 ? 'Google Calendar connection expired. Please reconnect.' : 'Google Calendar could not be reached. Please try again.')
}
