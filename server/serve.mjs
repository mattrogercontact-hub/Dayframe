import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleCalendarRequest, calendarError } from './google-api.mjs'
import { handleAppleRequest, appleError } from './apple-api.mjs'
import { handlePrivateAppleRequest, privateAppleError } from './apple-private-api.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json' }

createServer(async (req, res) => {
  try {
    if (await handleCalendarRequest(req, res)) return
    if (await handleAppleRequest(req, res)) return
    if (await handlePrivateAppleRequest(req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
    const pathname = new URL(req.url, 'http://localhost').pathname
    const target = path.resolve(root, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`)
    if (!target.startsWith(`${root}${path.sep}`)) { res.writeHead(403); res.end(); return }
    const file = await stat(target).then(info => info.isFile()).catch(() => false) ? target : path.join(root, 'index.html')
    const content = await readFile(file)
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' })
    res.end(req.method === 'HEAD' ? undefined : content)
  } catch (error) {
    if (req.url?.startsWith('/api/calendar/')) calendarError(res, error)
    else if (req.url?.startsWith('/api/apple/')) appleError(res, error)
    else if (req.url?.startsWith('/api/icloud/')) privateAppleError(res, error)
    else { res.writeHead(500); res.end('Dayframe could not load.') }
  }
}).listen(Number(process.env.PORT || 5173), '127.0.0.1', () => {
  console.log(`Dayframe is ready at http://localhost:${process.env.PORT || 5173}/`)
})
