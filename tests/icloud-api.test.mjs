import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const privateDir = await mkdtemp(path.join(tmpdir(), 'dayframe-icloud-test-'))
process.env.DAYFRAME_PRIVATE_DIR = privateDir
process.env.DAYFRAME_TOKEN_KEY = 'b'.repeat(64)
const { handlePrivateAppleRequest, privateAppleError } = await import('../server/apple-private-api.mjs')
const calendar = { url: 'https://p01-caldav.icloud.com/123/calendars/test/', displayName: 'Test iCloud', components: ['VEVENT'] }
const object = { url: `${calendar.url}test.ics`, etag: '"v1"', data: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-1\r\nDTSTART:20261023T130000Z\r\nDTEND:20261023T140000Z\r\nSUMMARY:Original\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n` }
const writes = []
async function clientFactory(account) {
  if (account.password !== 'example-app-password') throw new Error('Bad login')
  return { account: { calendars: [calendar] },
    fetchCalendarObjects: async () => [object],
    createCalendarObject: async details => { writes.push({ kind: 'create', details }); return new Response(null, { status: 201 }) },
    updateCalendarObject: async details => { writes.push({ kind: 'update', details }); return new Response(null, { status: 204 }) } }
}
const server = createServer((req, res) => {
  void handlePrivateAppleRequest(req, res, clientFactory).catch(error => privateAppleError(res, error))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/api/icloud`
const send = (route, method, body) => fetch(`${base}${route}`, { method,
  headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

test('private iCloud connection keeps credentials encrypted and writes disabled by default', async () => {
  try {
    const rejected = await send('/connect', 'PUT', { username: 'user@example.com', password: 'wrong-password' })
    assert.equal(rejected.status, 401)
    const connected = await send('/connect', 'PUT', { username: 'user@example.com', password: 'example-app-password' })
    assert.equal(connected.status, 200)
    const state = await connected.json()
    assert.equal(state.connected, true)
    assert.equal(state.writeEnabled, false)
    assert.equal(state.calendars[0].name, 'Test iCloud')
    assert.equal(JSON.stringify(state).includes('example-app-password'), false)
    const encrypted = await readFile(path.join(privateDir, 'icloud-account.enc.json'), 'utf8')
    assert.equal(encrypted.includes('example-app-password'), false)
    const id = state.calendars[0].id
    const selected = await send('/selection', 'PUT', { selectedIds: [id] })
    assert.deepEqual((await selected.json()).selectedIds, [id])
    const events = await fetch(`${base}/events?start=2026-10-23T00:00:00.000Z&end=2026-10-24T00:00:00.000Z`)
    const item = (await events.json()).events[0]
    assert.equal(item.title, 'Original')
    assert.equal(item.source, 'icloud')
    assert.equal(item.editable, true)
    const input = { calendarId: id, title: 'Updated', allDay: false, start: '2026-10-23T15:00:00.000Z',
      end: '2026-10-23T16:00:00.000Z', location: '', description: '' }
    assert.equal((await send('/event', 'POST', input)).status, 403)
    assert.equal(writes.length, 0)
    process.env.DAYFRAME_ICLOUD_WRITE_ENABLED = '1'
    assert.equal((await send('/event', 'POST', input)).status, 200)
    assert.equal(writes[0].kind, 'create')
    assert.match(writes[0].details.iCalString, /SUMMARY:Updated/)
    assert.equal((await send('/event', 'PUT', { ...input, objectUrl: object.url, etag: '"old"' })).status, 409)
    assert.equal((await send('/event', 'PUT', { ...input, objectUrl: object.url, etag: object.etag })).status, 200)
    assert.equal(writes[1].kind, 'update')
    assert.match(writes[1].details.calendarObject.data, /SUMMARY:Updated/)
    assert.equal((await send('/event', 'PUT', { ...input, objectUrl: 'https://evil.example/test.ics', etag: object.etag })).status, 400)
    assert.equal((await send('/selection', 'PUT', { selectedIds: ['icloud:unlisted'] })).status, 400)
    assert.equal((await send('/connect', 'DELETE')).status, 200)
    assert.equal((await (await fetch(`${base}/status`)).json()).connected, false)
  } finally {
    delete process.env.DAYFRAME_ICLOUD_WRITE_ENABLED
    server.close()
  }
})
