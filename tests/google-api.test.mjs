import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { OAuth2Client } from 'google-auth-library'

process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.DAYFRAME_TOKEN_KEY = randomBytes(32).toString('hex')
process.env.DAYFRAME_PRIVATE_DIR = path.join(tmpdir(), `dayframe-api-test-${randomUUID()}`)

const { handleCalendarRequest, calendarError, mapGoogleEvent, eventChanges } = await import('../server/google-api.mjs')

test('Google events map timed and all-day fields without losing calendar details', () => {
  const calendar = { id: 'home@example.com', name: 'Home & family', accessRole: 'owner', backgroundColor: '#a1b2c3', foregroundColor: '#ffffff' }
  const timed = mapGoogleEvent({ id: 'abc', summary: 'Dentist', start: { dateTime: '2026-10-20T09:00:00-04:00' },
    end: { dateTime: '2026-10-20T09:45:00-04:00' }, location: 'Main Street', description: 'Bring paperwork',
    htmlLink: 'https://calendar.google.com/calendar/event?eid=abc' }, calendar, 0)
  assert.equal(timed.id, 'google:home@example.com:abc')
  assert.equal(timed.calendarName, 'Home & family')
  assert.equal(timed.location, 'Main Street')
  assert.equal(timed.googleUrl, 'https://calendar.google.com/calendar/event?eid=abc')
  assert.equal(timed.calendarId, calendar.id)
  assert.equal(timed.googleEventId, 'abc')
  assert.equal(timed.editable, true)
  assert.equal(timed.source, 'google')
  assert.equal(timed.allDay, false)
  assert.equal(timed.color.background, '#a1b2c3')
  assert.equal(timed.color.foreground, '#172421')
  const override = mapGoogleEvent({ id: 'colored', colorId: '7', start: { dateTime: '2026-10-20T10:00:00-04:00' },
    end: { dateTime: '2026-10-20T11:00:00-04:00' } }, calendar, 0,
  { event: { '7': { background: '#123456', foreground: '#ffffff' } } })
  assert.equal(override.color.background, '#123456')
  assert.equal(override.color.foreground, '#ffffff')
  const paletteCalendar = mapGoogleEvent({ id: 'palette', start: { dateTime: '2026-10-20T10:00:00-04:00' },
    end: { dateTime: '2026-10-20T11:00:00-04:00' } },
  { id: 'other@example.com', name: 'Other', colorId: '3' }, 1,
  { calendar: { '3': { background: '#234567', foreground: '#ffffff' } } })
  assert.equal(paletteCalendar.color.background, '#234567')
  const allDay = mapGoogleEvent({ id: 'day', summary: 'Holiday', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }, calendar, 1)
  assert.equal(allDay.start, '2026-10-20T00:00:00')
  assert.equal(allDay.allDay, true)
  assert.equal(mapGoogleEvent({ id: 'gmail', eventType: 'fromGmail', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }, calendar, 1).editable, false)
  const instance = mapGoogleEvent({ id: 'repeat-1', recurringEventId: 'repeat-master',
    start: { dateTime: '2026-10-20T09:00:00-04:00' }, end: { dateTime: '2026-10-20T09:30:00-04:00' } }, calendar, 0)
  assert.equal(instance.recurringEventId, 'repeat-master')
  assert.equal(instance.editable, true)
  assert.equal(mapGoogleEvent({ id: 'gone', status: 'cancelled' }, calendar, 0), null)
})

test('event write validation preserves the selected time and rejects malformed dates', () => {
  const fields = { title: '  Dinner  ', start: '2026-10-22T18:00:00.000Z', end: '2026-10-22T19:00:00.000Z',
    allDay: false, location: 'Home', description: 'Bring dessert' }
  assert.equal(eventChanges(fields).summary, 'Dinner')
  assert.deepEqual(eventChanges(fields).start, { dateTime: fields.start })
  assert.equal(eventChanges({ ...fields, end: fields.start }), null)
  assert.equal(eventChanges({ ...fields, allDay: true, start: '2026-02-30', end: '2026-03-01' }), null)
  assert.deepEqual(eventChanges({ ...fields, allDay: true, start: '2026-10-22', end: '2026-10-23' }).end, { date: '2026-10-23' })
  assert.deepEqual(eventChanges({ ...fields, repeat: 'weekly', timeZone: 'America/New_York' }).recurrence, ['RRULE:FREQ=WEEKLY'])
  assert.equal(eventChanges({ ...fields, repeat: 'weekly', timeZone: 'Invalid/Zone' }), null)
  assert.equal(eventChanges({ ...fields, repeat: 'weekly', timeZone: 'America/New_York',
    repeatUntil: '2026-10-20', repeatUntilUtc: '2026-10-21T03:59:59.000Z' }), null)
})

test('local OAuth entry requests calendar read and event write access and rejects invalid callback state', async t => {
  const server = createServer((req, res) => {
    void handleCalendarRequest(req, res).catch(error => calendarError(res, error))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const port = server.address().port
  process.env.GOOGLE_REDIRECT_URI = `http://localhost:${port}/api/calendar/callback`
  const base = `http://127.0.0.1:${port}/api/calendar`
  const status = await (await fetch(`${base}/status`)).json()
  assert.equal(status.configured, true)
  assert.equal(status.connected, false)

  const connect = await fetch(`${base}/connect`, { redirect: 'manual' })
  assert.equal(connect.status, 302)
  const destination = new URL(connect.headers.get('location'))
  assert.equal(destination.hostname, 'accounts.google.com')
  assert.deepEqual(destination.searchParams.get('scope').split(' ').sort(), [
    'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly',
  ])
  assert.equal(destination.searchParams.get('access_type'), 'offline')
  assert.ok(destination.searchParams.get('state'))
  assert.match(connect.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/)
  const invalid = await fetch(`${base}/callback?state=wrong&code=fake`)
  assert.equal(invalid.status, 400)
  const noConnection = await fetch(`${base}/events?start=2026-10-20T00:00:00Z&end=2026-10-21T00:00:00Z`)
  assert.equal(noConnection.status, 401)
})

test('event write routes enforce granted scope, calendar role, and edit version', async t => {
  const originalGetToken = OAuth2Client.prototype.getToken
  const originalRequest = OAuth2Client.prototype.request
  const calls = []
  OAuth2Client.prototype.getToken = async () => ({ tokens: { refresh_token: 'test-refresh',
    scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events' } })
  OAuth2Client.prototype.request = async function (options) {
    calls.push(options)
    if (options.url.includes('/users/me/calendarList')) return { data: { items: [
      { id: 'home@example.com', summary: 'Home', primary: true, accessRole: 'owner' },
      { id: 'other@example.com', summary: 'Other', accessRole: 'reader' },
    ] } }
    if (options.method === 'POST' || options.method === 'PATCH' || options.method === 'DELETE') return { data: { id: 'saved' } }
    if (options.url.includes('/events/instance')) return { data: { etag: 'fresh-etag', eventType: 'default', recurringEventId: 'master' } }
    if (options.url.includes('/events/master')) return { data: { id: 'master', etag: 'fresh-etag', eventType: 'default',
      summary: 'Weekly dinner', start: { dateTime: '2026-10-22T18:00:00Z' }, end: { dateTime: '2026-10-22T19:00:00Z' },
      recurrence: ['RRULE:FREQ=WEEKLY'] } }
    if (options.url.includes('/events/')) return { data: { etag: 'fresh-etag', eventType: 'default' } }
    throw new Error(`Unexpected Google request: ${options.url}`)
  }
  t.after(() => { OAuth2Client.prototype.getToken = originalGetToken; OAuth2Client.prototype.request = originalRequest })
  const server = createServer((req, res) => { void handleCalendarRequest(req, res).catch(error => calendarError(res, error)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/api/calendar`
  const connect = await fetch(`${base}/connect`, { redirect: 'manual' })
  const target = new URL(connect.headers.get('location'))
  const cookie = connect.headers.get('set-cookie').split(';')[0]
  const callback = await fetch(`${base}/callback?state=${target.searchParams.get('state')}&code=test`,
    { headers: { Cookie: cookie }, redirect: 'manual' })
  assert.equal(callback.status, 303)
  const status = await (await fetch(`${base}/status`)).json()
  assert.equal(status.writeEnabled, true)
  const body = { calendarId: 'home@example.com', title: 'Dinner', start: '2026-10-22T18:00:00.000Z',
    end: '2026-10-22T19:00:00.000Z', allDay: false, location: 'Home', description: 'Bring dessert' }
  const request = (method, data) => fetch(`${base}/event`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  assert.equal((await request('POST', body)).status, 200)
  assert.equal(calls.at(-1).method, 'POST')
  assert.equal(calls.at(-1).data.summary, 'Dinner')
  assert.equal((await request('POST', { ...body, calendarId: 'other@example.com' })).status, 403)
  assert.equal((await request('PUT', { ...body, eventId: 'abc', etag: 'stale-etag' })).status, 409)
  assert.equal((await request('PUT', { ...body, eventId: 'abc', etag: 'fresh-etag' })).status, 200)
  assert.equal(calls.at(-1).method, 'PATCH')
  assert.equal(calls.at(-1).headers['If-Match'], 'fresh-etag')
  assert.equal((await request('POST', { ...body, repeat: 'weekly', timeZone: 'America/New_York' })).status, 200)
  assert.deepEqual(calls.at(-1).data.recurrence, ['RRULE:FREQ=WEEKLY'])
  assert.equal((await request('PUT', { ...body, eventId: 'instance', etag: 'fresh-etag' })).status, 403)
  assert.equal((await request('PUT', { ...body, eventId: 'instance', etag: 'fresh-etag', scope: 'occurrence' })).status, 200)
  assert.equal((await request('PUT', { ...body, eventId: 'master', etag: 'fresh-etag' })).status, 403)
  assert.equal((await request('PUT', { ...body, eventId: 'master', etag: 'fresh-etag', scope: 'series' })).status, 200)
  const series = await fetch(`${base}/series?calendarId=home%40example.com&eventId=master`)
  assert.equal(series.status, 200)
  assert.deepEqual((await series.json()).event.recurrence, ['RRULE:FREQ=WEEKLY'])
  assert.equal((await request('DELETE', { calendarId: body.calendarId, eventId: 'instance', etag: 'fresh-etag' })).status, 403)
  assert.equal((await request('DELETE', { calendarId: body.calendarId, eventId: 'instance', etag: 'fresh-etag', scope: 'occurrence' })).status, 200)
  assert.equal(calls.at(-1).method, 'DELETE')
  assert.equal((await request('DELETE', { calendarId: body.calendarId, eventId: 'master', etag: 'fresh-etag' })).status, 403)
  assert.equal((await request('DELETE', { calendarId: body.calendarId, eventId: 'master', etag: 'fresh-etag', scope: 'series' })).status, 200)
})

test('Keep connection reads a selected checklist and reports unavailable access', async t => {
  const originalGetToken = OAuth2Client.prototype.getToken
  const originalRequest = OAuth2Client.prototype.request
  let unavailable = false
  OAuth2Client.prototype.getToken = async () => ({ tokens: { refresh_token: 'keep-test-refresh', scope: 'https://www.googleapis.com/auth/keep.readonly' } })
  OAuth2Client.prototype.request = async function (options) {
    if (unavailable) throw { response: { status: 403 } }
    if (options.url.includes('/v1/notes?')) return { data: { notes: [
      { name: 'notes/shopping', title: 'Shopping', body: { list: { listItems: [{ text: { text: 'Milk' } }] } } },
      { name: 'notes/plain', title: 'Plain', body: { text: { text: 'Not a list' } } },
    ] } }
    if (options.url.endsWith('/v1/notes/shopping')) return { data: { title: 'Shopping', body: { list: { listItems: [
      { text: { text: 'Milk' }, checked: false, childListItems: [{ text: { text: 'Oat milk' }, checked: true }] },
      { text: { text: 'Bread' }, checked: true },
    ] } } } }
    throw new Error(`Unexpected Keep request: ${options.url}`)
  }
  t.after(() => { OAuth2Client.prototype.getToken = originalGetToken; OAuth2Client.prototype.request = originalRequest })
  const server = createServer((req, res) => { void handleCalendarRequest(req, res).catch(error => calendarError(res, error)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/api/calendar`
  const connect = await fetch(`${base}/keep/connect`, { redirect: 'manual' })
  const target = new URL(connect.headers.get('location'))
  assert.equal(target.searchParams.get('scope'), 'https://www.googleapis.com/auth/keep.readonly')
  const callback = await fetch(`${base}/callback?state=${target.searchParams.get('state')}&code=test`, {
    headers: { Cookie: connect.headers.get('set-cookie').split(';')[0] }, redirect: 'manual',
  })
  assert.equal(callback.status, 303)
  assert.equal(callback.headers.get('location'), '/?keep=connected')
  const status = await (await fetch(`${base}/keep/status`)).json()
  assert.equal(status.connected, true)
  assert.equal(status.selectedNoteName, null)
  const notes = await (await fetch(`${base}/keep/notes`)).json()
  assert.deepEqual(notes.notes.map(note => note.title), ['Shopping'])
  const selection = await fetch(`${base}/keep/selection`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'notes/shopping' }) })
  assert.equal(selection.status, 200)
  assert.equal((await (await fetch(`${base}/keep/status`)).json()).selectedNoteName, 'notes/shopping')
  const list = await (await fetch(`${base}/keep/items`)).json()
  assert.deepEqual(list.note.items.map(item => [item.text, item.checked, item.level]), [
    ['Milk', false, 0], ['Oat milk', true, 1], ['Bread', true, 0],
  ])
  unavailable = true
  const denied = await fetch(`${base}/keep/items`)
  assert.equal(denied.status, 403)
  assert.match((await denied.json()).error, /unavailable for this account/)
})
