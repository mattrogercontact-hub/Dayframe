import type { CalendarEvent } from './calendar'

export interface ICloudCalendarChoice { id: string; name: string }
export interface ICloudStatus {
  configured: boolean; connected: boolean; writeEnabled: boolean;
  calendars: ICloudCalendarChoice[]; selectedIds: string[]
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/icloud${path}`, { cache: 'no-store', ...options })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'iCloud request failed.')
  return data as T
}

export function getICloudStatus() { return api<ICloudStatus>('/status') }
export function connectICloud(username: string, password: string) {
  return api<ICloudStatus>('/connect', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }) })
}
export function disconnectICloud() { return api<ICloudStatus>('/connect', { method: 'DELETE' }) }
export function getICloudCalendars() {
  return api<{ calendars: ICloudCalendarChoice[]; selectedIds: string[] }>('/calendars')
}
export function selectICloudCalendars(selectedIds: string[]) {
  return api<ICloudStatus>('/selection', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedIds }) })
}
export function getICloudEvents(start: Date, end: Date) {
  const query = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })
  return api<{ events: CalendarEvent[] }>(`/events?${query}`).then(result => result.events)
}
export function saveICloudEvent(input: { calendarId: string; title: string; start: string; end: string;
  allDay: boolean; location: string; description: string }, original?: CalendarEvent) {
  return api<{ saved: boolean }>('/event', { method: original ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input,
      objectUrl: original?.appleObjectUrl, etag: original?.etag }) })
}
