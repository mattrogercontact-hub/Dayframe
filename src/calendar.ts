export type Face = 'agenda' | 'week' | 'month'
export type Theme = 'light' | 'dark' | 'cozy' | 'contrast'
export type Category = 'work' | 'family' | 'errands' | 'home' | 'fun'

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  allDay?: boolean
  category: Category
  calendarName?: string
  calendarId?: string
  googleEventId?: string
  appleObjectUrl?: string
  recurringEventId?: string
  recurrence?: string[]
  etag?: string
  editable?: boolean
  color?: { background: string; foreground: string }
  description?: string
  googleUrl?: string
  location?: string
  source: 'local-sample' | 'local' | 'google' | 'apple' | 'icloud'
}

export interface EventProvider {
  getEvents(start: Date, end: Date): Promise<CalendarEvent[]>
}

export const faceNames: Record<Face, string> = {
  agenda: 'Agenda', week: 'Week', month: 'Month',
}

export const themeNames: Record<Theme, string> = {
  light: 'Light', dark: 'Dark', cozy: 'Cozy', contrast: 'High contrast',
}

export const categoryNames: Record<Category, string> = {
  work: 'Work', family: 'Family', errands: 'Errands', home: 'Home', fun: 'Together',
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  return addDays(day, -day.getDay())
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function monthGrid(date: Date): Date[] {
  const first = startOfWeek(startOfMonth(date))
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1)
  const needed = Math.ceil((Math.round((nextMonth.getTime() - first.getTime()) / 86400000)) / 7) * 7
  return Array.from({ length: Math.max(35, needed) }, (_, index) => addDays(first, index))
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function eventsOn(events: CalendarEvent[], date: Date): CalendarEvent[] {
  const beginning = startOfDay(date)
  const end = addDays(beginning, 1)
  return events.filter(event => new Date(event.start) < end && new Date(event.end) > beginning)
    .sort((a, b) => a.start.localeCompare(b.start))
}

export function dateRange(face: Face, cursor: Date): [Date, Date] {
  if (face === 'agenda') return [startOfDay(cursor), addDays(cursor, 1)]
  if (face === 'month') {
    const grid = monthGrid(cursor)
    return [grid[0], addDays(grid[grid.length - 1], 1)]
  }
  const week = startOfWeek(cursor)
  return [week, addDays(week, 7)]
}

export function seedEvents(date: Date): CalendarEvent[] {
  const at = (hour: number, minute: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute).toISOString()
  const thursday = addDays(startOfWeek(date), 4)
  const sunday = startOfWeek(date)
  const on = (day: Date, hour: number, minute: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).toISOString()
  const items: Omit<CalendarEvent, 'source'>[] = [
    { id: 'sample-team', title: 'Team meeting', start: at(8, 30), end: at(9, 0), category: 'work', description: 'A little time to get everyone on the same page.' },
    { id: 'sample-lunch', title: 'Lunch with Alex', start: at(12, 15), end: at(13, 15), category: 'family', description: 'Catch up over lunch.' },
    { id: 'sample-groceries', title: 'Pick up groceries', start: at(15, 30), end: at(16, 0), category: 'errands', description: 'Take a look at the grocery list before heading out.' },
    { id: 'sample-dinner', title: 'Dinner at home', start: at(18, 0), end: at(19, 0), category: 'home', description: 'An easy evening around the table.' },
    { id: 'sample-movie', title: 'Movie night', start: at(19, 30), end: at(21, 30), category: 'fun', description: 'Pick something good and settle in.' },
    { id: 'sample-sunday', title: 'Slow Sunday', start: on(sunday, 0, 0), end: on(addDays(sunday, 1), 0, 0), allDay: true, category: 'home', description: 'A day to take at your own pace.' },
    { id: 'sample-check-in', title: 'Quick check-in', start: on(thursday, 9, 0), end: on(thursday, 9, 30), category: 'work', description: 'A short morning check-in.' },
    { id: 'sample-library', title: 'Library visit', start: on(thursday, 9, 15), end: on(thursday, 10, 15), category: 'family', description: 'Pick up something good to read.' },
    { id: 'sample-project', title: 'Quiet project time', start: on(thursday, 13, 0), end: on(thursday, 15, 0), category: 'home', description: 'A longer block for the things that need space.' },
  ]
  return items.map(event => ({ ...event, source: 'local-sample' as const })).sort((a, b) => a.start.localeCompare(b.start))
}

export const WEEK_HOUR_HEIGHT = 76

export interface WeekEventPlacement {
  event: CalendarEvent
  top: number
  height: number
  column: number
  columns: number
}

export function layoutDayEvents(events: CalendarEvent[], day?: Date): WeekEventPlacement[] {
  const minimumMinutes = 44 / WEEK_HOUR_HEIGHT * 60
  const entries = events.filter(event => !event.allDay).map(event => {
    const originalStart = new Date(event.start)
    const originalEnd = new Date(event.end)
    const dayStart = day ? startOfDay(day) : startOfDay(originalStart)
    const dayEnd = addDays(dayStart, 1)
    const start = new Date(Math.max(originalStart.getTime(), dayStart.getTime()))
    const end = new Date(Math.min(originalEnd.getTime(), dayEnd.getTime()))
    const startMinute = (start.getTime() - dayStart.getTime()) / 60000
    const duration = Math.max(1, (end.getTime() - start.getTime()) / 60000)
    return { event, startMinute, renderedEnd: startMinute + Math.max(duration, minimumMinutes), duration }
  }).sort((a, b) => a.startMinute - b.startMinute || b.duration - a.duration)
  const placed: WeekEventPlacement[] = []
  let group: typeof entries = []
  let groupEnd = -1

  function placeGroup() {
    const active: { end: number; column: number }[] = []
    const groupPlaced: WeekEventPlacement[] = []
    for (const entry of group) {
      for (let index = active.length - 1; index >= 0; index--) {
        if (active[index].end <= entry.startMinute) active.splice(index, 1)
      }
      let column = 0
      while (active.some(item => item.column === column)) column++
      active.push({ end: entry.renderedEnd, column })
      groupPlaced.push({ event: entry.event, top: Math.min(24 * WEEK_HOUR_HEIGHT - 44, entry.startMinute / 60 * WEEK_HOUR_HEIGHT),
        height: Math.max(44, entry.duration / 60 * WEEK_HOUR_HEIGHT), column, columns: 1 })
    }
    const columns = Math.max(1, ...groupPlaced.map(item => item.column + 1))
    placed.push(...groupPlaced.map(item => ({ ...item, columns })))
  }

  for (const entry of entries) {
    if (group.length && entry.startMinute >= groupEnd) {
      placeGroup()
      group = []
    }
    group.push(entry)
    groupEnd = Math.max(groupEnd, entry.renderedEnd)
  }
  if (group.length) placeGroup()
  return placed
}

export function formatTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

export function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date)
}

export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(date)
}

export function formatWeekRange(date: Date): string {
  const start = startOfWeek(date)
  const end = addDays(start, 6)
  if (start.getMonth() === end.getMonth()) {
    return `${new Intl.DateTimeFormat('en-US', { month: 'long' }).format(start)} ${start.getDate()}–${end.getDate()}`
  }
  return `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(start)} – ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(end)}`
}

export function greeting(date: Date): string {
  const hour = date.getHours()
  return hour < 12 ? 'Good morning, Matt' : hour < 17 ? 'Good afternoon, Matt' : 'Good evening, Matt'
}

export function currentOrNext(events: CalendarEvent[], now: Date): CalendarEvent | undefined {
  return events.find(event => !event.allDay && new Date(event.start) < addDays(startOfDay(now), 1) && new Date(event.end) > now)
}
