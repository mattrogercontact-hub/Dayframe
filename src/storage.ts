import { seedEvents, type CalendarEvent, type EventProvider, type Face, type Theme } from './calendar'

export interface GroceryItem { id: string; name: string; done: boolean }
export type KeyboardMode = 'system' | 'dayframe'
export interface DisplaySettings { face: Face; theme: Theme; hiddenCalendarIds: string[]; keyboardMode: KeyboardMode }

const keys = {
  display: 'dayframe.display.v1',
  groceries: 'dayframe.groceries.v1',
  events: 'dayframe.events.v1',
}

const faces: Face[] = ['agenda', 'week', 'month']
const themes: Theme[] = ['light', 'dark', 'cozy', 'contrast']
const categories = ['work', 'family', 'errands', 'home', 'fun']

function read(key: string): unknown {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  } catch { return null }
}

export function save(key: keyof typeof keys, data: unknown): boolean {
  try {
    localStorage.setItem(keys[key], JSON.stringify({ version: 1, ...data as object }))
    return true
  } catch { return false }
}

export function storageAvailable(): boolean {
  try {
    localStorage.setItem('dayframe.probe', '1')
    localStorage.removeItem('dayframe.probe')
    return true
  } catch { return false }
}

export function loadDisplay(): DisplaySettings {
  const raw = read(keys.display)
  const saved = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  const systemTheme: Theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return {
    face: saved?.version === 1 && faces.includes(saved.face as Face) ? saved.face as Face : 'agenda',
    theme: saved?.version === 1 && themes.includes(saved.theme as Theme) ? saved.theme as Theme : systemTheme,
    hiddenCalendarIds: saved?.version === 1 && Array.isArray(saved.hiddenCalendarIds)
      ? saved.hiddenCalendarIds.filter((id): id is string => typeof id === 'string') : [],
    keyboardMode: saved?.version === 1 && saved.keyboardMode === 'dayframe' ? 'dayframe' : 'system',
  }
}

export function loadGroceries(): GroceryItem[] {
  const raw = read(keys.groceries)
  if (raw && typeof raw === 'object' && 'version' in raw && raw.version === 1 && 'items' in raw && Array.isArray(raw.items)) {
    return raw.items.filter((item: unknown): item is GroceryItem => {
      if (!item || typeof item !== 'object') return false
      const value = item as Record<string, unknown>
      return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.done === 'boolean'
    })
  }
  return [
    { id: 'sample-milk', name: 'Oat milk', done: false },
    { id: 'sample-apples', name: 'Apples', done: false },
    { id: 'sample-bread', name: 'Sourdough bread', done: false },
  ]
}

function validEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return typeof event.id === 'string' && typeof event.title === 'string' &&
    typeof event.start === 'string' && !Number.isNaN(Date.parse(event.start)) &&
    typeof event.end === 'string' && !Number.isNaN(Date.parse(event.end)) &&
    (event.allDay === undefined || typeof event.allDay === 'boolean') &&
    categories.includes(event.category as string) && (event.source === 'local-sample' || event.source === 'local')
}

export function loadEvents(today: Date): CalendarEvent[] {
  const raw = read(keys.events)
  if (raw && typeof raw === 'object' && 'version' in raw && raw.version === 1 && 'items' in raw && Array.isArray(raw.items)) {
    const events = raw.items.filter(validEvent)
    const original = events.find(event => event.id === 'sample-team')
    if (!original) return events
    // Earlier installs saved only the original five samples; keep them and add missing Week demos.
    const additions = seedEvents(new Date(original.start)).filter(event => !events.some(saved => saved.id === event.id))
    if (additions.length) {
      const updated = [...events, ...additions].sort((a, b) => a.start.localeCompare(b.start))
      save('events', { items: updated })
      return updated
    }
    return events
  }
  const events = seedEvents(today)
  save('events', { items: events })
  return events
}

// Replace this provider with a Google Calendar adapter later. Views only ask for date ranges.
export function localEventProvider(events: CalendarEvent[]): EventProvider {
  return {
    async getEvents(start, end) {
      return events.filter(event => new Date(event.start) < end && new Date(event.end) > start)
        .sort((a, b) => a.start.localeCompare(b.start))
    },
  }
}
