import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

process.env.DAYFRAME_PRIVATE_DIR = await mkdtemp(path.join(tmpdir(), 'dayframe-apple-test-'))
process.env.DAYFRAME_TOKEN_KEY = 'a'.repeat(64)
const { appleFeedUrl, handleAppleRequest } = await import('../server/apple-api.mjs')
const { parseAppleCalendar } = await import('../server/apple-calendar.mjs')

const feed = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:weekly-1\r
DTSTART;VALUE=DATE:20261023\r
DTEND;VALUE=DATE:20261024\r
RRULE:FREQ=DAILY;COUNT=3\r
SUMMARY:Family trip\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:appointment-1\r
DTSTART:20261023T130000Z\r
DTEND:20261023T140000Z\r
SUMMARY:Appointment\r
LOCATION:Main Street\r
END:VEVENT\r
END:VCALENDAR\r
`

test('Apple calendar parser expands repeating all-day events and keeps source names', () => {
  const events = parseAppleCalendar(feed, { id: 'apple:test', name: 'Family iCloud' },
    new Date('2026-10-23T00:00:00Z'), new Date('2026-10-27T00:00:00Z'))
  assert.equal(events.length, 4)
  assert.deepEqual(events.filter(event => event.allDay).map(event => event.start),
    ['2026-10-23T00:00:00', '2026-10-24T00:00:00', '2026-10-25T00:00:00'])
  assert.equal(events.find(event => event.title === 'Appointment').calendarName, 'Family iCloud')
  assert.equal(events.find(event => event.title === 'Appointment').source, 'apple')
})

test('Apple calendar parser uses changed occurrences and skips cancelled ones', () => {
  const changed = feed.replace('END:VCALENDAR\r\n', `BEGIN:VEVENT\r
UID:weekly-1\r
RECURRENCE-ID;VALUE=DATE:20261024\r
DTSTART;VALUE=DATE:20261026\r
DTEND;VALUE=DATE:20261027\r
SUMMARY:Moved trip\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:weekly-1\r
RECURRENCE-ID;VALUE=DATE:20261025\r
DTSTART;VALUE=DATE:20261025\r
DTEND;VALUE=DATE:20261026\r
STATUS:CANCELLED\r
END:VEVENT\r
END:VCALENDAR\r
`)
  const events = parseAppleCalendar(changed, { id: 'apple:test', name: 'Family iCloud' },
    new Date('2026-10-23T00:00:00Z'), new Date('2026-10-28T00:00:00Z'))
  assert.deepEqual(events.filter(event => event.allDay).map(event => [event.title, event.start]),
    [['Family trip', '2026-10-23T00:00:00'], ['Moved trip', '2026-10-26T00:00:00']])
})

test('Apple calendar parser honors a feed-provided time zone', () => {
  const zoned = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VTIMEZONE\r
TZID:America/New_York\r
BEGIN:DAYLIGHT\r
DTSTART:20260308T020000\r
TZOFFSETFROM:-0500\r
TZOFFSETTO:-0400\r
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r
END:DAYLIGHT\r
BEGIN:STANDARD\r
DTSTART:20261101T020000\r
TZOFFSETFROM:-0400\r
TZOFFSETTO:-0500\r
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r
END:STANDARD\r
END:VTIMEZONE\r
BEGIN:VEVENT\r
UID:zoned\r
DTSTART;TZID=America/New_York:20261023T090000\r
DTEND;TZID=America/New_York:20261023T100000\r
SUMMARY:School event\r
END:VEVENT\r
END:VCALENDAR\r
`
  const events = parseAppleCalendar(zoned, { id: 'apple:test', name: 'Family iCloud' },
    new Date('2026-10-23T00:00:00Z'), new Date('2026-10-24T00:00:00Z'))
  assert.equal(events[0].start, '2026-10-23T13:00:00.000Z')
})

test('Apple feed links stay on iCloud published calendars', () => {
  assert.equal(appleFeedUrl('webcal://p01-caldav.icloud.com/published/2/abc'),
    'https://p01-caldav.icloud.com/published/2/abc')
  assert.equal(appleFeedUrl('https://127.0.0.1/published/2/abc'), null)
  assert.equal(appleFeedUrl('https://icloud.com.evil.test/published/2/abc'), null)
  assert.equal(appleFeedUrl('https://icloud.com@evil.test/published/2/abc'), null)
})

test('Apple subscription API keeps feed links on the server and returns read-only events', async () => {
  const seen = []
  const server = createServer((req, res) => {
    void handleAppleRequest(req, res, async (url, options) => {
      seen.push({ url, redirect: options.redirect })
      return new Response(feed, { status: 200, headers: { 'Content-Type': 'text/calendar' } })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${server.address().port}`
  try {
    const put = await fetch(`${address}/api/apple/subscription`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Family iCloud', url: 'webcal://p01-caldav.icloud.com/published/2/abc' }) })
    assert.equal(put.status, 200)
    const saved = await put.json()
    assert.equal(saved.subscriptions.length, 1)
    assert.equal(JSON.stringify(saved).includes('abc'), false)
    const list = await fetch(`${address}/api/apple/events?start=2026-10-23T00:00:00.000Z&end=2026-10-27T00:00:00.000Z`)
    assert.equal(list.status, 200)
    assert.equal((await list.json()).events.length, 4)
    assert.equal(seen.every(item => item.redirect === 'manual'), true)
    assert.equal(seen[0].url, 'https://p01-caldav.icloud.com/published/2/abc')
    const removed = await fetch(`${address}/api/apple/subscription?id=${encodeURIComponent(saved.subscriptions[0].id)}`, { method: 'DELETE' })
    assert.deepEqual((await removed.json()).subscriptions, [])
  } finally { server.close() }
})
