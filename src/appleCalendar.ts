import type { CalendarEvent } from './calendar'

export interface AppleCalendarChoice { id: string; name: string }
export interface AppleCalendarStatus { subscriptions: AppleCalendarChoice[] }

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/apple${path}`, { cache: 'no-store', ...options })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Apple Calendar request failed.')
  return data as T
}

export function getAppleStatus() { return api<AppleCalendarStatus>('/status') }

export function addAppleCalendar(name: string, url: string) {
  return api<AppleCalendarStatus>('/subscription', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, url }) })
}

export function removeAppleCalendar(id: string) {
  return api<AppleCalendarStatus>(`/subscription?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function getAppleEvents(start: Date, end: Date) {
  const query = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })
  return api<{ events: CalendarEvent[] }>(`/events?${query}`).then(result => result.events)
}
