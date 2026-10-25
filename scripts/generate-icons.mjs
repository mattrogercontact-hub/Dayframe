import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const svg = await readFile('public/icon.svg', 'utf8')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`)
    await page.locator('img').screenshot({ path: `public/icon-${size}.png`, omitBackground: true })
  }
} finally {
  await browser.close()
}
