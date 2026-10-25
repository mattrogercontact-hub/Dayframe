import { useState, type FormEvent } from 'react'
import { addDays, categoryNames, type CalendarEvent, type Category } from './calendar'
import type { EventInput, GoogleCalendarChoice } from './googleCalendar'
import type { KeyboardMode } from './storage'

export interface EventDraft extends EventInput { category: Category }

function datePart(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function timePart(value: Date) { return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}` }

function editableNotes(value: string) {
  if (!/<[a-z][\s\S]*>/i.test(value)) return value
  const document = new DOMParser().parseFromString(value, 'text/html')
  document.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
  document.querySelectorAll('p,div,li').forEach(node => node.append('\n'))
  return document.body.textContent?.replace(/\n{3,}/g, '\n\n').trim() || ''
}

export function EventEditor({ original, date, slotStart, connected, calendars, keyboardMode, onSave, onCancel }: {
  original: CalendarEvent | null; date: Date; slotStart?: Date; connected: boolean; calendars: GoogleCalendarChoice[];
  keyboardMode: KeyboardMode;
  onSave: (draft: EventDraft) => Promise<void>; onCancel: () => void
}) {
  const initialStart = original ? new Date(original.start) : slotStart || new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9)
  const initialEnd = original ? new Date(original.end) : new Date(initialStart.getTime() + 3600000)
  const [title, setTitle] = useState(original?.title || '')
  const [allDay, setAllDay] = useState(Boolean(original?.allDay))
  const [startDate, setStartDate] = useState(datePart(initialStart))
  const [endDate, setEndDate] = useState(datePart(original?.allDay ? addDays(initialEnd, -1) : initialEnd))
  const [startTime, setStartTime] = useState(timePart(initialStart))
  const [endTime, setEndTime] = useState(timePart(initialEnd))
  const [location, setLocation] = useState(original?.location || '')
  const initialNotes = editableNotes(original?.description || '')
  const [notes, setNotes] = useState(initialNotes)
  const [category, setCategory] = useState<Category>(original?.category || 'family')
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('none')
  const [repeatUntil, setRepeatUntil] = useState('')
  const writableCalendars = calendars.filter(calendar => ['owner', 'writer'].includes(calendar.accessRole || ''))
  const [calendarId, setCalendarId] = useState(original?.calendarId || writableCalendars[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function moveEndThirtyMinutesAfter(dateValue: string, timeValue: string) {
    const nextEnd = new Date(`${dateValue}T${timeValue}:00`)
    nextEnd.setMinutes(nextEnd.getMinutes() + 30)
    setEndDate(datePart(nextEnd))
    setEndTime(timePart(nextEnd))
  }

  function changeStartDate(value: string) {
    setStartDate(value)
    if (!value) return
    if (endDate < value) setEndDate(value)
    if (!allDay && endDate <= value && endTime < startTime) moveEndThirtyMinutesAfter(value, startTime)
  }

  function changeStartTime(value: string) {
    setStartTime(value)
    if (value && endDate === startDate && endTime < value) moveEndThirtyMinutesAfter(startDate, value)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!title.trim() || !startDate || !endDate || (!allDay && (!startTime || !endTime))) {
      setError('Enter a title, date, and time.'); return
    }
    const start = allDay ? startDate : new Date(`${startDate}T${startTime}`).toISOString()
    const end = allDay ? datePart(addDays(new Date(`${endDate}T00:00:00`), 1)) : new Date(`${endDate}T${endTime}`).toISOString()
    if (connected && !calendarId) { setError('Choose a calendar you can edit.'); return }
    if (allDay ? end <= start : new Date(end) <= new Date(start)) {
      setError('Enter a title and an end after the start.'); return
    }
    setBusy(true)
    try {
      await onSave({ calendarId, title: title.trim(), start, end, allDay, location: location.trim(),
        description: notes === initialNotes ? original?.description || '' : notes, category,
        ...(!original && connected && !calendarId.startsWith('icloud:') && repeat !== 'none' ? { repeat, repeatUntil: repeatUntil || undefined,
          repeatUntilUtc: repeatUntil && !allDay ? new Date(`${repeatUntil}T23:59:59`).toISOString() : undefined,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}) })
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <form className="event-editor" onSubmit={event => void submit(event)}>
    <label>Event name<input autoFocus inputMode={keyboardMode === 'dayframe' ? 'none' : 'text'} required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
    {connected ? <label>Calendar<select value={calendarId} required disabled={Boolean(original)} onChange={event => setCalendarId(event.target.value)}>
      {!calendarId && <option value="">Choose a calendar</option>}
      {writableCalendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label>
      : <label>Category<select value={category} onChange={event => setCategory(event.target.value as Category)}>
        {(Object.keys(categoryNames) as Category[]).map(value => <option key={value} value={value}>{categoryNames[value]}</option>)}</select></label>}
    <label className="editor-check"><input type="checkbox" checked={allDay} onChange={event => setAllDay(event.target.checked)} />All day</label>
    <div className="editor-dates"><label>Start date<input required type="date" value={startDate} onChange={event => changeStartDate(event.target.value)} /></label>
      {!allDay && <label>Start time<input required type="time" value={startTime} onChange={event => changeStartTime(event.target.value)} /></label>}
      <label>{allDay ? 'Last day' : 'End date'}<input required type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
      {!allDay && <label>End time<input required type="time" value={endTime} onChange={event => setEndTime(event.target.value)} /></label>}</div>
    {connected && !original && !calendarId.startsWith('icloud:') && <><label>Repeat<select aria-label="Repeat" value={repeat} onChange={event => setRepeat(event.target.value as typeof repeat)}>
      <option value="none">Does not repeat</option><option value="daily">Every day</option>
      <option value="weekly">Every week</option><option value="monthly">Every month</option>
      <option value="yearly">Every year</option></select></label>
      {repeat !== 'none' && <label>Repeat until (optional)<input type="date" min={startDate} value={repeatUntil}
        onChange={event => setRepeatUntil(event.target.value)} /></label>}</>}
    {original?.recurrence?.length && <p className="editor-hint">Changes apply to the entire series. The start date is its first occurrence; changing the date or time shifts the series while keeping its repeat pattern.</p>}
    <label>Location<input inputMode={keyboardMode === 'dayframe' ? 'none' : 'text'} maxLength={1000} value={location} onChange={event => setLocation(event.target.value)} /></label>
    <label>Notes<textarea inputMode={keyboardMode === 'dayframe' ? 'none' : 'text'} rows={5} maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
    {original?.description && /<[a-z][\s\S]*>/i.test(original.description) &&
      <p className="editor-hint">Existing formatting is kept unless you change the notes. Changed notes are saved as plain text.</p>}
    {error && <p className="calendar-error" role="alert">{error}</p>}
    <div className="editor-actions"><button type="button" onClick={onCancel}>Cancel</button>
      <button type="submit" disabled={busy || (connected && !writableCalendars.length)}>{busy ? 'Saving…' : original ? 'Save changes' : 'Add event'}</button></div>
  </form>
}
