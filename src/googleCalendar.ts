import type { CalendarEvent, EventProvider } from './calendar'

export interface GoogleCalendarStatus { configured: boolean; connected: boolean; writeEnabled?: boolean; selectedIds: string[] }
export interface GoogleCalendarChoice { id: string; name: string; primary: boolean; accessRole?: string }
export interface EventInput { calendarId: string; title: string; start: string; end: string; allDay: boolean; location: string; description: string;
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'; repeatUntil?: string; repeatUntilUtc?: string; timeZone?: string }

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/calendar${path}`, { cache: 'no-store', ...options })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Calendar request failed.')
  return data as T
}

export function getGoogleStatus() { return api<GoogleCalendarStatus>('/status') }

export function getGoogleCalendars() {
  return api<{ calendars: GoogleCalendarChoice[]; selectedIds: string[] }>('/calendars')
}

export function saveGoogleSelection(selectedIds: string[]) {
  return api<{ selectedIds: string[] }>('/selection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selectedIds }) })
}

export function disconnectGoogle() { return api<{ connected: boolean }>('/disconnect', { method: 'POST' }) }

export function saveGoogleEvent(input: EventInput, original?: CalendarEvent, scope?: 'occurrence' | 'series') {
  const body = original ? { ...input, eventId: original.googleEventId, etag: original.etag, scope } : input
  return api<{ saved: boolean }>('/event', { method: original ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export function getGoogleSeries(event: CalendarEvent) {
  const query = new URLSearchParams({ calendarId: event.calendarId || '', eventId: event.recurringEventId || '' })
  return api<{ event: CalendarEvent }>(`/series?${query}`).then(result => result.event)
}

export function deleteGoogleEvent(event: CalendarEvent, scope?: 'occurrence' | 'series') {
  return api<{ deleted: boolean }>('/event', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calendarId: event.calendarId, eventId: event.googleEventId, etag: event.etag, scope }) })
}

export function googleEventProvider(): EventProvider {
  return {
    async getEvents(start, end) {
      const query = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })
      const result = await api<{ events: CalendarEvent[] }>(`/events?${query}`)
      return result.events
    },
  }
}
