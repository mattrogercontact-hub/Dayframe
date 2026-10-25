import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const address = process.env.DAYFRAME_TEST_URL || 'http://localhost:5173/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.clock.setFixedTime(new Date(new Date().setHours(9, 0, 0, 0)))
  const day = new Date()
  const at = (hour) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).toISOString()
  const event = { id: 'icloud:test:event', title: 'iCloud test appointment', start: at(10), end: at(11),
    category: 'family', calendarName: 'Dayframe Test', calendarId: 'icloud:test', source: 'icloud',
    editable: true, appleObjectUrl: 'https://p01-caldav.icloud.com/test/event.ics', etag: '"v1"' }
  let connected = false
  let selectedIds = []
  let writeEnabled = false
  const calendars = [{ id: 'icloud:test', name: 'Dayframe Test' }]
  let saved = null
  await page.route('**/api/calendar/**', route => route.fulfill({ json: { configured: false, connected: false, selectedIds: [] } }))
  await page.route('**/api/apple/**', route => route.fulfill({ json: { subscriptions: [] } }))
  await page.route('**/api/icloud/**', route => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname.endsWith('/connect') && method === 'PUT') connected = true
    if (url.pathname.endsWith('/connect') && method === 'DELETE') { connected = false; selectedIds = [] }
    if (url.pathname.endsWith('/selection') && method === 'PUT') selectedIds = route.request().postDataJSON().selectedIds
    if (url.pathname.endsWith('/event') && method === 'PUT') saved = route.request().postDataJSON()
    const response = url.pathname.endsWith('/events') ? { events: selectedIds.length ? [event] : [] }
      : url.pathname.endsWith('/event') ? { saved: true }
        : { configured: true, connected, writeEnabled, calendars: connected ? calendars : [], selectedIds }
    return route.fulfill({ json: response })
  })
  await page.goto(address)
  await page.getByRole('button', { name: /Display/ }).click()
  const settings = page.getByRole('dialog', { name: 'Display' })
  const privateSettings = settings.getByRole('group', { name: /iCloud account/ })
  await privateSettings.getByLabel('Apple Account email').fill('test@example.com')
  await privateSettings.getByLabel('App-specific password').fill('example-app-password')
  await privateSettings.getByRole('button', { name: 'Connect iCloud' }).click()
  await privateSettings.getByText('Dayframe Test', { exact: true }).waitFor()
  assert.equal(await privateSettings.getByLabel('App-specific password').count(), 0)
  await privateSettings.getByRole('checkbox', { name: 'Dayframe Test' }).click()
  await page.waitForFunction(() => document.querySelector('.apple-settings input[type="checkbox"]:checked') !== null)
  await settings.getByRole('button', { name: 'Close Display' }).click()
  await page.getByRole('button', { name: /iCloud test appointment.*Open details/ }).waitFor()
  await page.getByRole('button', { name: /iCloud test appointment.*Open details/ }).click()
  let details = page.getByRole('dialog', { name: 'iCloud test appointment' })
  assert.equal(await details.getByRole('button', { name: 'Edit event' }).count(), 0)
  await page.screenshot({ path: 'output/icloud-private-readonly.png', fullPage: true })
  writeEnabled = true
  await page.reload()
  await page.getByRole('button', { name: /iCloud test appointment.*Open details/ }).click()
  details = page.getByRole('dialog', { name: 'iCloud test appointment' })
  await details.getByRole('button', { name: 'Edit event' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit event' })
  await editor.getByLabel('Event name').fill('Changed iCloud appointment')
  await editor.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null)
  assert.equal(saved.title, 'Changed iCloud appointment')
  assert.equal(saved.objectUrl, event.appleObjectUrl)
  assert.equal(saved.etag, event.etag)
  console.log(`Private iCloud browser checks passed at ${address}: connect, select, read-only guard, and guarded edit request.`)
} finally { await browser.close() }
