import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const address = process.env.DAYFRAME_TEST_URL || 'http://localhost:5173/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.route('**/api/icloud/**', route => route.fulfill({ json: {
    configured: true, connected: false, writeEnabled: false, calendars: [], selectedIds: [], events: [],
  } }))
  await page.clock.setFixedTime(new Date(new Date().setHours(9, 0, 0, 0)))
  const day = new Date()
  const at = (hour, minute) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).toISOString()
  const appleEvent = { id: 'apple:family:appointment', title: 'Apple appointment', start: at(10, 0), end: at(11, 0),
    category: 'family', calendarName: 'Family iCloud', calendarId: 'apple:family', source: 'apple', editable: false }
  const googleEvent = { id: 'google:home:meeting', title: 'Google meeting', start: at(13, 0), end: at(14, 0),
    category: 'work', calendarName: 'Home Google', calendarId: 'home', source: 'google', editable: false }
  let subscriptions = []
  let googleConnected = false
  await page.route('**/api/calendar/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/status')) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ configured: googleConnected, connected: googleConnected, selectedIds: googleConnected ? ['home'] : [] }) })
    if (url.pathname.endsWith('/calendars')) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ calendars: [{ id: 'home', name: 'Home Google', accessRole: 'reader' }], selectedIds: ['home'] }) })
    if (url.pathname.endsWith('/events')) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ events: [googleEvent] }) })
    return route.abort()
  })
  await page.route('**/api/apple/**', route => {
    const url = new URL(route.request().url())
    let response
    if (url.pathname.endsWith('/subscription') && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      subscriptions = [{ id: 'apple:family', name: body.name }]
      response = { subscriptions }
    } else if (url.pathname.endsWith('/subscription') && route.request().method() === 'DELETE') {
      subscriptions = []
      response = { subscriptions }
    } else if (url.pathname.endsWith('/status')) response = { subscriptions }
    else if (url.pathname.endsWith('/events')) response = { events: subscriptions.length ? [appleEvent] : [] }
    else return route.abort()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  })
  await page.goto(address)
  await page.getByRole('button', { name: /Display/ }).click()
  const settings = page.getByRole('dialog', { name: 'Display' })
  await settings.getByRole('group', { name: /Apple Calendar/ }).getByLabel('Calendar name').fill('Family iCloud')
  await settings.getByLabel('iCloud public calendar link').fill('webcal://p01-caldav.icloud.com/published/2/sample')
  await settings.getByRole('button', { name: 'Add read-only calendar' }).click()
  await settings.getByText('Family iCloud', { exact: true }).waitFor()
  await settings.getByRole('button', { name: 'Close Display' }).click()
  await page.getByRole('button', { name: /Apple appointment.*Open details/ }).waitFor()
  await page.getByRole('button', { name: /Display/ }).click()
  await settings.locator('.calendar-health').getByText(/Apple Calendar updated/).waitFor()
  await page.screenshot({ path: 'output/apple-status-in-display.png' })
  await settings.getByRole('button', { name: 'Close Display' }).click()
  await page.getByRole('button', { name: /Apple appointment.*Open details/ }).click()
  const details = page.getByRole('dialog', { name: 'Apple appointment' })
  await details.getByText('Read-only event from Apple Calendar.').waitFor()
  assert.equal(await details.getByRole('button', { name: 'Edit event' }).count(), 0)
  await page.screenshot({ path: 'output/apple-readonly-event.png', fullPage: true })
  await details.getByRole('button', { name: 'Close Apple appointment' }).click()
  await page.getByRole('button', { name: /^Calendars/ }).click()
  await page.getByRole('checkbox', { name: /Family iCloud/ }).uncheck()
  assert.equal(await page.getByRole('button', { name: /Apple appointment.*Open details/ }).count(), 0)
  googleConnected = true
  await page.reload()
  await page.getByRole('button', { name: /Google meeting.*Open details/ }).waitFor()
  await page.getByRole('button', { name: /^Calendars/ }).click()
  await page.getByRole('checkbox', { name: /Family iCloud/ }).check()
  await page.getByRole('button', { name: /Apple appointment.*Open details/ }).waitFor()
  await page.getByRole('button', { name: /Google meeting.*Open details/ }).waitFor()
  console.log(`Apple Calendar browser checks passed at ${address}: read-only add, display, event details, and filter.`)
} finally { await browser.close() }
