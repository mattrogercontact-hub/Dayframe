import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const address = process.env.DAYFRAME_TEST_URL || 'http://localhost:5173/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let selectedNoteName = null
  let unavailable = false
  const notes = [{ name: 'notes/shopping', title: 'Shopping', itemCount: 3 },
    { name: 'notes/holiday', title: 'Holiday supplies', itemCount: 1 }]
  const reading = { title: 'Shopping', items: [
    { id: '1', text: 'Milk', checked: false, level: 0 },
    { id: '2', text: 'Oat milk', checked: true, level: 1 },
    { id: '3', text: 'Bread', checked: false, level: 0 },
  ] }
  await page.route('**/api/calendar/**', route => {
    const url = new URL(route.request().url())
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/api/calendar/keep/status') return send({ configured: true, connected: true, selectedNoteName })
    if (url.pathname === '/api/calendar/keep/notes') return send({ notes, selectedNoteName })
    if (url.pathname === '/api/calendar/keep/selection') {
      selectedNoteName = route.request().postDataJSON().name
      return send({ selectedNoteName })
    }
    if (url.pathname === '/api/calendar/keep/items') return unavailable
      ? send({ error: 'Google Keep API is unavailable for this account or project.' }, 403)
      : send({ note: reading })
    if (url.pathname === '/api/calendar/status') return send({ configured: false, connected: false, selectedIds: [] })
    return route.abort()
  })
  await page.goto(address)
  await page.getByRole('button', { name: 'Display' }).click()
  const display = page.getByRole('dialog', { name: 'Display' })
  await display.getByRole('group', { name: 'Google Keep shopping list' }).getByRole('combobox', { name: 'Shopping list' }).selectOption('notes/shopping')
  await page.screenshot({ path: 'output/keep-display-picker.png', fullPage: true })
  await display.getByRole('button', { name: 'Show this list' }).click()
  await display.getByText('Selected list: Shopping').waitFor()
  await page.keyboard.press('Escape')
  const card = page.locator('.grocery-card')
  await card.getByRole('heading', { name: 'Shopping' }).waitFor()
  await card.getByText('Milk', { exact: true }).waitFor()
  await card.getByText('Bread', { exact: true }).waitFor()
  assert.equal(await card.getByRole('link').count(), 0)
  assert.equal(await card.getByText('Oat milk').locator('..').evaluate(element => element.classList.contains('is-done')), true)
  assert.equal(await card.getByRole('textbox', { name: 'Add a grocery item' }).count(), 0)
  await page.screenshot({ path: 'output/keep-agenda.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: 'output/keep-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.reload()
  await card.getByRole('heading', { name: 'Shopping' }).waitFor()
  unavailable = true
  await card.getByRole('button', { name: 'Refresh' }).click()
  await card.getByText('Google Keep API is unavailable for this account or project.').waitFor()
  await card.getByText('Milk', { exact: true }).waitFor()
  await page.screenshot({ path: 'output/keep-unavailable.png', fullPage: true })
  await page.getByRole('button', { name: 'Groceries', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Groceries' })
  await drawer.getByRole('heading', { name: 'Shopping' }).waitFor()
  await drawer.getByText('Local list on this display').waitFor()
  await drawer.getByRole('textbox', { name: 'Add a grocery item' }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Keep browser view, persistence, failure state, and local list passed')
} finally {
  await browser.close()
}
