import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const address = process.env.DAYFRAME_TEST_URL || 'http://localhost:5173/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.route('**/api/apple/**', route => route.fulfill({ json: { subscriptions: [], events: [] } }))
  await page.route('**/api/icloud/**', route => route.fulfill({ json: {
    configured: true, connected: false, writeEnabled: false, calendars: [], selectedIds: [], events: [],
  } }))
  await page.clock.setFixedTime(new Date(new Date().setHours(9, 0, 0, 0)))
  const at = (hour, minute) => new Date(new Date().setHours(hour, minute, 0, 0)).toISOString()
  const googleEvent = { id: 'google:home@example.com:dentist', title: 'Dentist', start: at(9, 0), end: at(9, 45),
    allDay: false, category: 'family', calendarName: 'Home & family', calendarId: 'home@example.com',
    googleEventId: 'dentist', etag: 'etag-1', editable: true, location: 'Main Street', source: 'google',
    description: '<p>Bring <strong>insurance card</strong> &amp; forms.</p><ul><li>Photo ID</li><li><span style="font-weight: bold">Referral</span></li></ul><p><a href="https://example.com/forms">Open forms</a> <a href="javascript:alert(1)">Unsafe link</a></p><script>window.__unsafe = true</script>',
    color: { background: '#496f8f', foreground: '#fffdf8' } }
  const plainEvent = { ...googleEvent, id: 'google:home@example.com:notes', title: 'Notes', start: at(11, 0), end: at(11, 30),
    description: 'First line\nSecond line\nhttps://example.com/help' }
  const automaticEvent = { ...googleEvent, id: 'google:home@example.com:automatic', title: 'AutoEvent', start: at(14, 0), end: at(14, 30),
    description: 'To see detailed information for automatically created events like this one, use the official Google Calendar app. [https://g.co/calendar](https://g.co/calendar)',
    googleUrl: 'https://calendar.google.com/calendar/event?eid=automatic' }
  const recurringInstance = { ...googleEvent, id: 'google:home@example.com:weekly-20261023', title: 'Weekly standup',
    start: at(15, 0), end: at(15, 30), googleEventId: 'weekly-20261023', recurringEventId: 'weekly-master',
    etag: 'etag-instance', description: 'Recurring meeting' }
  const recurringMaster = { ...recurringInstance, id: 'google:home@example.com:weekly-master', googleEventId: 'weekly-master',
    recurringEventId: undefined, recurrence: ['RRULE:FREQ=WEEKLY'], etag: 'etag-master' }
  let selectedIds = ['home@example.com']
  let writeEnabled = true
  let eventRequests = 0
  let failEvents = false
  let events = [googleEvent, plainEvent, automaticEvent, recurringInstance]
  const writes = []
  await page.route('**/api/calendar/**', async route => {
    const url = new URL(route.request().url())
    const endpoint = url.pathname.split('/').at(-1)
    const send = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (endpoint === 'status') return send({ configured: true, connected: true, writeEnabled, selectedIds })
    if (endpoint === 'calendars') return send({ calendars: [
      { id: 'home@example.com', name: 'Home & family', primary: true, accessRole: 'owner' },
      { id: 'work@example.com', name: 'Work', primary: false, accessRole: 'writer' },
    ], selectedIds })
    if (endpoint === 'selection') {
      selectedIds = route.request().postDataJSON().selectedIds
      return send({ selectedIds })
    }
    if (endpoint === 'series') return send({ event: recurringMaster })
    if (endpoint === 'events') {
      eventRequests++
      if (failEvents) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily offline' }) })
      return send({ events })
    }
    if (endpoint === 'event') {
      const body = route.request().postDataJSON()
      writes.push({ method: route.request().method(), body })
      if (route.request().method() === 'DELETE') {
        events = events.filter(item => item.googleEventId !== body.eventId)
        return send({ deleted: true })
      }
      if (route.request().method() === 'POST') events = [...events, { ...googleEvent, id: 'google:home@example.com:new',
        googleEventId: 'new', etag: 'etag-new', title: body.title, start: body.start, end: body.end,
        description: body.description, location: body.location, allDay: body.allDay }]
      else events = events.map(item => item.googleEventId === body.eventId ? { ...item,
        title: body.title, start: body.start, end: body.end, description: body.description, location: body.location, etag: 'etag-2' } : item)
      return send({ saved: true })
    }
    if (endpoint === 'disconnect') return send({ connected: false })
    return route.abort()
  })
  await page.goto(address)
  await page.getByRole('button', { name: /Dentist.*Open details/ }).waitFor()
  await page.getByRole('button', { name: /Display/ }).click()
  const syncSettings = page.getByRole('dialog', { name: 'Display' })
  await syncSettings.locator('.calendar-health').getByText(/Google Calendar updated/).waitFor()
  failEvents = true
  await syncSettings.getByRole('button', { name: 'Retry sync' }).click()
  await syncSettings.locator('.calendar-health').getByText(/Google Calendar unavailable.*Last updated.*Temporarily offline/).waitFor()
  await page.getByRole('button', { name: /Dentist.*Open details/ }).waitFor()
  failEvents = false
  await syncSettings.getByRole('button', { name: 'Retry sync' }).click()
  await syncSettings.locator('.calendar-health').getByText(/Google Calendar updated/).waitFor()
  await page.screenshot({ path: 'output/google-status-in-display.png' })
  await syncSettings.getByRole('button', { name: 'Close Display' }).click()
  assert.equal(await page.locator('.calendar-sources').count(), 0)
  await page.getByRole('button', { name: /^Calendars/ }).click()
  const calendarFilter = page.getByRole('group', { name: 'Filter calendars' })
  const homeCalendar = calendarFilter.getByRole('checkbox', { name: /Home & family/ })
  assert.equal(await homeCalendar.isChecked(), true)
  await homeCalendar.uncheck()
  assert.deepEqual(selectedIds, ['home@example.com'])
  assert.equal(await page.getByRole('button', { name: /Dentist.*Open details/ }).count(), 0)
  await page.reload()
  await page.getByRole('button', { name: /^Calendars/ }).click()
  assert.equal(await calendarFilter.getByRole('checkbox', { name: /Home & family/ }).isChecked(), false)
  await calendarFilter.getByRole('checkbox', { name: /Home & family/ }).check()
  await page.getByRole('button', { name: /^Calendars/ }).click()
  await page.getByRole('button', { name: /Dentist.*Open details/ }).waitFor()
  assert.equal(await page.getByRole('button', { name: /Dentist.*Open details/ }).first()
    .evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(73, 111, 143)')
  await page.getByRole('button', { name: /Dentist.*Open details/ }).click()
  const details = page.getByRole('dialog', { name: 'Dentist' })
  assert.equal(await details.getByRole('toolbar', { name: 'Event actions' }).getByRole('button', { name: 'Edit event' }).count(), 1)
  assert.equal(await details.getByRole('toolbar', { name: 'Event actions' }).getByRole('button', { name: 'Close Dentist' }).count(), 1)
  await details.locator('dd').getByText('Home & family', { exact: true }).waitFor()
  await details.getByText('Main Street').waitFor()
  await details.locator('strong').getByText('insurance card').waitFor()
  await details.getByRole('listitem').getByText('Photo ID').waitFor()
  await details.getByRole('listitem').locator('strong').getByText('Referral').waitFor()
  await details.getByText('Open forms').waitFor()
  assert.equal(await details.getByRole('link', { name: 'Open forms' }).count(), 0)
  assert.equal(await details.getByRole('link', { name: 'Unsafe link' }).count(), 0)
  assert.equal(await details.getByText('window.__unsafe = true').count(), 0)
  assert.equal(await page.evaluate(() => window.__unsafe), undefined)
  await page.screenshot({ path: 'output/event-rich-details.png', fullPage: true })
  await details.getByRole('button', { name: 'Edit event' }).waitFor()
  await page.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /Notes.*Open details/ }).first().click()
  const plainDetails = page.getByRole('dialog', { name: 'Notes' })
  await plainDetails.getByText(/First line\s+Second line/).waitFor()
  assert.equal(await plainDetails.locator('.event-description').evaluate(element => getComputedStyle(element).whiteSpace), 'pre-wrap')
  await plainDetails.getByText('https://example.com/help').waitFor()
  assert.equal(await plainDetails.getByRole('link').count(), 0)
  await page.keyboard.press('Escape')
  await plainDetails.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /AutoEvent.*Open details/ }).first().click()
  const automaticDetails = page.getByRole('dialog', { name: 'AutoEvent' })
  await automaticDetails.getByText('Google provides a short placeholder for this automatically created event.').waitFor()
  assert.equal(await automaticDetails.getByRole('link').count(), 0)
  assert.equal(await automaticDetails.getByText(/g.co\/calendar/).count(), 0)
  await page.screenshot({ path: 'output/event-automatic-details.png', fullPage: true })
  await page.keyboard.press('Escape')
  await automaticDetails.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: /Dentist.*Open details/ }).first().click()
  await details.getByText('Open forms').waitFor()
  assert.equal(await details.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: 'output/event-rich-mobile.png', fullPage: true })
  await page.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 1920, height: 1080 })

  await page.getByRole('button', { name: 'Week', exact: true }).click()
  const weekEvent = page.locator('.timegrid-event[data-event-id="google:home@example.com:dentist"]')
  await weekEvent.waitFor()
  await weekEvent.getByText('Home & family').waitFor()
  assert.equal(await weekEvent.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(73, 111, 143)')
  const todayColumn = await page.evaluate(() => new Date().getDay())
  await page.locator('.timegrid-day').nth(todayColumn).getByRole('button', { name: /Add event on .* at 12:00 PM/ }).click()
  const weekSlotEditor = page.getByRole('dialog', { name: 'Add event' })
  assert.equal(await weekSlotEditor.getByLabel('Start time').inputValue(), '12:00')
  assert.equal(await weekSlotEditor.getByLabel('End time').inputValue(), '13:00')
  assert.equal(await weekSlotEditor.getByLabel('Calendar').inputValue(), 'home@example.com')
  assert.equal(await page.locator('.timegrid-placeholder').count(), 1)
  await weekSlotEditor.getByRole('button', { name: 'Cancel' }).click()
  assert.equal(await page.locator('.timegrid-placeholder').count(), 0)
  await page.getByRole('button', { name: 'Agenda', exact: true }).click()

  await page.getByRole('button', { name: 'Add event', exact: true }).click()
  const addDialog = page.getByRole('dialog', { name: 'Add event' })
  await addDialog.getByLabel('Event name').fill('Garden plans')
  await addDialog.getByLabel('Start time').fill('16:00')
  await addDialog.getByLabel('End time').fill('17:00')
  await addDialog.locator('select').last().selectOption('weekly')
  await page.screenshot({ path: 'output/google-add-event-form.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await addDialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: 'output/google-add-event-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await addDialog.getByRole('button', { name: 'Add event', exact: true }).click()
  await addDialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /Garden plans.*Open details/ }).waitFor()
  assert.equal(writes.at(-1).method, 'POST')
  assert.equal(writes.at(-1).body.calendarId, 'home@example.com')
  assert.equal(writes.at(-1).body.repeat, 'weekly')
  await page.getByRole('button', { name: /Dentist.*Open details/ }).first().click()
  await details.getByRole('button', { name: 'Edit event' }).click()
  const editDialog = page.getByRole('dialog', { name: 'Edit event' })
  await editDialog.getByLabel('Event name').fill('Dentist follow-up')
  await editDialog.getByRole('button', { name: 'Save changes' }).click()
  await editDialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /Dentist follow-up.*Open details/ }).first().waitFor()
  assert.equal(writes.at(-1).method, 'PUT')
  assert.equal(writes.at(-1).body.etag, 'etag-1')
  assert.equal(writes.at(-1).body.description, googleEvent.description)
  await page.screenshot({ path: 'output/google-event-edited.png', fullPage: true })

  await page.getByRole('button', { name: /Weekly standup.*Open details/ }).first().click()
  await page.getByRole('dialog', { name: 'Weekly standup' }).getByRole('button', { name: 'Edit event' }).click()
  const scopeDialog = page.getByRole('dialog', { name: 'Edit repeating event' })
  await scopeDialog.getByRole('button', { name: 'This occurrence' }).click()
  const occurrenceEditor = page.getByRole('dialog', { name: 'Edit event' })
  await occurrenceEditor.getByLabel('Event name').fill('Weekly standup exception')
  await occurrenceEditor.getByRole('button', { name: 'Save changes' }).click()
  assert.equal(writes.at(-1).body.scope, 'occurrence')
  assert.equal(writes.at(-1).body.eventId, 'weekly-20261023')
  await page.getByRole('button', { name: /Weekly standup exception.*Open details/ }).first().click()
  await page.getByRole('dialog', { name: 'Weekly standup exception' }).getByRole('button', { name: 'Edit event' }).click()
  await scopeDialog.getByRole('button', { name: 'Entire series' }).click()
  const seriesEditor = page.getByRole('dialog', { name: 'Edit event' })
  await seriesEditor.getByText(/Changes apply to the entire series/).waitFor()
  await seriesEditor.getByRole('button', { name: 'Save changes' }).click()
  assert.equal(writes.at(-1).body.scope, 'series')
  assert.equal(writes.at(-1).body.eventId, 'weekly-master')
  await page.getByRole('button', { name: /Garden plans.*Open details/ }).first().click()
  await page.getByRole('dialog', { name: 'Garden plans' }).getByRole('button', { name: 'Delete event' }).click()
  const deleteDialog = page.getByRole('dialog', { name: 'Delete event?' })
  await deleteDialog.getByRole('button', { name: 'Delete event', exact: true }).click()
  await deleteDialog.waitFor({ state: 'hidden' })
  assert.equal(writes.at(-1).method, 'DELETE')
  assert.equal(writes.at(-1).body.eventId, 'new')
  await page.getByRole('button', { name: /Garden plans.*Open details/ }).first().waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('button', { name: /Garden plans.*Open details/ }).count(), 0)

  writeEnabled = false
  await page.reload()
  await page.getByRole('button', { name: 'Add event', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add event' }).getByRole('link', { name: 'Enable event editing' }).waitFor()
  await page.getByRole('dialog', { name: 'Add event' }).getByRole('button', { name: 'Close Add event' }).click()

  await page.getByRole('button', { name: /Display/ }).click()
  const settings = page.getByRole('dialog', { name: 'Display' })
  await settings.getByText('Connected for viewing.').waitFor()
  await settings.getByRole('checkbox', { name: /Home & family/ }).waitFor()
  assert.deepEqual(await page.locator('a[href]').evaluateAll(elements => elements.map(element => element.getAttribute('href'))
    .filter(href => href && !href.startsWith('/api/calendar/'))), [])
  await page.screenshot({ path: 'output/google-connected.png', fullPage: true })
  await settings.getByRole('checkbox', { name: 'Work' }).check()
  assert.deepEqual(selectedIds, ['home@example.com', 'work@example.com'])
  await settings.getByRole('button', { name: 'Close Display' }).click()
  await page.getByRole('button', { name: /^Calendars/ }).click()
  await calendarFilter.getByRole('checkbox', { name: /^Work/ }).waitFor()
  await page.screenshot({ path: 'output/calendar-filter-google.png' })
  await page.getByRole('button', { name: /^Calendars/ }).click()
  await page.getByRole('button', { name: /Display/ }).click()
  assert.ok(eventRequests >= 2)
  await settings.getByRole('button', { name: 'Disconnect' }).click()
  await settings.getByText('Connect Google Calendar').waitFor()
  await settings.getByRole('button', { name: 'Close Display' }).click()
  await page.getByRole('button', { name: /Lunch with Alex.*Open details/ }).waitFor()
  console.log(`Google Calendar browser checks passed at ${address}: connected events, add/edit requests, reconnect prompt, rich and plain descriptions without outbound links, automatic-event placeholder, selection, and local fallback.`)
} finally { await browser.close() }
