import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react(), {
  name: 'dayframe-calendar-api',
  async configureServer(server) {
    // @ts-expect-error The local API is a Node ESM module shared with the production server.
    const { handleCalendarRequest, calendarError } = await import('./server/google-api.mjs')
    // @ts-expect-error The local Apple API is a Node ESM module shared with the production server.
    const { handleAppleRequest, appleError } = await import('./server/apple-api.mjs')
    // @ts-expect-error The private CalDAV API runs only on the local Node server.
    const { handlePrivateAppleRequest, privateAppleError } = await import('./server/apple-private-api.mjs')
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/api/calendar/')) {
        void handleCalendarRequest(req, res).catch((error: unknown) => calendarError(res, error))
      } else if (req.url?.startsWith('/api/apple/')) {
        void handleAppleRequest(req, res).catch((error: unknown) => appleError(res, error))
      } else if (req.url?.startsWith('/api/icloud/')) {
        void handlePrivateAppleRequest(req, res).catch((error: unknown) => privateAppleError(res, error))
      } else next()
    })
  },
}], base: './' })
