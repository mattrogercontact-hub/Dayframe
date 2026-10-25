import ICAL from 'ical.js'

function asCalendarTime(time) {
  if (time.isDate) return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}T00:00:00`
  return time.toJSDate().toISOString()
}

function eventWithin(start, end, rangeStart, rangeEnd) {
  return new Date(start) < rangeEnd && new Date(end) > rangeStart
}

export function parseAppleCalendar(ics, { id, name }, rangeStart, rangeEnd, sourceKind = 'apple') {
  const root = new ICAL.Component(ICAL.parse(ics))
  if (root.name !== 'vcalendar') throw new Error('Apple did not return a calendar feed.')
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(new ICAL.Timezone(zone))
  }
  const components = root.getAllSubcomponents('vevent')
  const exceptions = new Map()
  for (const component of components) {
    if (!component.hasProperty('recurrence-id')) continue
    const uid = component.getFirstPropertyValue('uid')
    if (!exceptions.has(uid)) exceptions.set(uid, [])
    exceptions.get(uid).push(component)
  }
  const items = []
  for (const component of components) {
    if (component.hasProperty('recurrence-id') || !component.hasProperty('dtstart')) continue
    const event = new ICAL.Event(component)
    for (const exception of exceptions.get(event.uid) || []) event.relateException(new ICAL.Event(exception))
    const push = (occurrenceStart, occurrenceEnd, source) => {
      const start = asCalendarTime(occurrenceStart)
      const end = asCalendarTime(occurrenceEnd)
      if (!eventWithin(start, end, rangeStart, rangeEnd)) return
      if (source.component.getFirstPropertyValue('status')?.toUpperCase() === 'CANCELLED') return
      items.push({ id: `${sourceKind}:${id}:${event.uid}:${occurrenceStart.toString()}`, source: sourceKind, calendarId: id,
        calendarName: name, title: source.summary || 'Untitled event', start, end,
        allDay: occurrenceStart.isDate, category: 'family', description: source.description || undefined,
        location: source.location || undefined, editable: false })
    }
    if (!event.isRecurring()) {
      push(event.startDate, event.endDate, event)
      continue
    }
    const iterator = event.iterator()
    let occurrence
    let count = 0
    while ((occurrence = iterator.next())) {
      if (++count > 25000) throw new Error('Apple calendar has too many recurring dates to display.')
      const details = event.getOccurrenceDetails(occurrence)
      push(details.startDate, details.endDate, details.item)
      if (details.startDate.toJSDate() >= rangeEnd) break
    }
  }
  return items.sort((a, b) => a.start.localeCompare(b.start))
}
