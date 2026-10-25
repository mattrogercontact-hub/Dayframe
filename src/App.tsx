import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import {
  addDays, categoryNames, dateRange, eventsOn, faceNames, formatLongDate,
  formatMonth, formatTime, formatWeekRange, layoutDayEvents, monthGrid, sameDay,
  startOfWeek, themeNames, WEEK_HOUR_HEIGHT,
  type CalendarEvent, type Face, type Theme,
} from './calendar'
import { EventDescription } from './description'
import { EventEditor, type EventDraft } from './EventEditor'
import { TouchKeyboard } from './TouchKeyboard'
import { addAppleCalendar, getAppleEvents, getAppleStatus, removeAppleCalendar, type AppleCalendarStatus } from './appleCalendar'
import { connectICloud, disconnectICloud, getICloudEvents, getICloudStatus, saveICloudEvent,
  selectICloudCalendars, type ICloudStatus } from './icloudCalendar'
import pencilIcon from 'bootstrap-icons/icons/pencil.svg?url'
import trashIcon from 'bootstrap-icons/icons/trash.svg?url'
import closeIcon from 'bootstrap-icons/icons/x-lg.svg?url'
import brandIcon from 'bootstrap-icons/icons/calendar-heart.svg?url'
import agendaIcon from 'bootstrap-icons/icons/card-list.svg?url'
import weekIcon from 'bootstrap-icons/icons/calendar-week.svg?url'
import monthIcon from 'bootstrap-icons/icons/calendar-month.svg?url'
import displayIcon from 'bootstrap-icons/icons/gear.svg?url'
import windowsIcon from 'bootstrap-icons/icons/windows.svg?url'
import keyboardIcon from 'bootstrap-icons/icons/keyboard.svg?url'
import { deleteGoogleEvent, disconnectGoogle, getGoogleCalendars, getGoogleSeries, getGoogleStatus, googleEventProvider, saveGoogleEvent, saveGoogleSelection,
  type GoogleCalendarChoice, type GoogleCalendarStatus } from './googleCalendar'
import { loadDisplay, loadEvents, localEventProvider, save, storageAvailable, type KeyboardMode } from './storage'
import { fetchWeather, loadWeather, saveWeather, searchWeatherLocations, weatherDescription, weatherSymbol,
  type WeatherLocation, type SavedWeather } from './weather'

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const faces: Face[] = ['agenda', 'week', 'month']
const faceIcons: Record<Face, string> = { agenda: agendaIcon, week: weekIcon, month: monthIcon }
const themes: Theme[] = ['light', 'dark', 'cozy', 'contrast']
const eventLabel = (event: CalendarEvent) => event.calendarName || categoryNames[event.category]
const syncTimeLabel = (date: Date, now: Date) => sameDay(date, now) ? formatTime(date) : `${formatLongDate(date)} at ${formatTime(date)}`
const eventStyle = (event: CalendarEvent): CSSProperties | undefined => event.color
  ? { '--event-bg': event.color.background, '--event-ink': event.color.foreground } as CSSProperties : undefined

function AppDialog({ title, eyebrow, onDismiss, children, drawer = false, eventHeader = false, iconClose = false, onEdit, onDelete }: {
  title: string; eyebrow?: string; onDismiss: () => void; children: ReactNode; drawer?: boolean;
  eventHeader?: boolean; iconClose?: boolean; onEdit?: () => void; onDelete?: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      // StrictMode also runs this cleanup during development; only explicit dismissals update app state.
      if (dialog?.open) dialog.close()
      opener?.focus()
    }
  }, [])
  return <dialog ref={ref} className={drawer ? 'app-dialog drawer' : 'app-dialog'} onCancel={event => {
    event.preventDefault()
    onDismiss()
  }} onClick={event => {
    if (event.target === event.currentTarget) onDismiss()
  }} aria-label={title}>
    <div className="dialog-inner">
      <div className={`dialog-top${eventHeader ? ' event-dialog-top' : ''}`}>
        {eventHeader && <div className="event-dialog-toolbar" role="toolbar" aria-label="Event actions">
          {onEdit && <button type="button" className="event-icon-action" aria-label="Edit event" title="Edit event" onClick={onEdit}>
            <span className="bootstrap-event-icon" style={{ maskImage: `url("${pencilIcon}")` }} aria-hidden="true" />
          </button>}
          {onDelete && <button type="button" className="event-icon-action" aria-label="Delete event" title="Delete event" onClick={onDelete}>
            <span className="bootstrap-event-icon" style={{ maskImage: `url("${trashIcon}")` }} aria-hidden="true" />
          </button>}
          <button type="button" className="event-icon-action" autoFocus aria-label={`Close ${title}`} title="Close event" onClick={onDismiss}>
            <span className="bootstrap-event-icon" style={{ maskImage: `url("${closeIcon}")` }} aria-hidden="true" />
          </button>
        </div>}
        <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>
        {!eventHeader && (iconClose
          ? <button type="button" className="event-icon-action" autoFocus aria-label={`Close ${title}`} title={`Close ${title}`} onClick={onDismiss}>
            <span className="bootstrap-event-icon" style={{ maskImage: `url("${closeIcon}")` }} aria-hidden="true" />
          </button>
          : <button className="close-button" autoFocus aria-label={`Close ${title}`} onClick={onDismiss}>Close</button>)}
      </div>
      {children}
    </div>
  </dialog>
}

function EventCard({ event, onOpen, compact = false }: { event: CalendarEvent; onOpen: (event: CalendarEvent) => void; compact?: boolean }) {
  return <button className={`event-card category-${event.category}${compact ? ' compact' : ''}`} style={eventStyle(event)} onClick={() => onOpen(event)}
    aria-label={`${event.allDay ? 'All day' : formatTime(event.start)}, ${event.title}, ${eventLabel(event)}. Open details`}>
    <span className="event-time">{event.allDay ? 'All day' : formatTime(event.start)}</span>
    <span className="event-card-copy"><strong>{event.title}</strong><span>{eventLabel(event)}</span></span>
    <span className="event-arrow" aria-hidden="true">↗</span>
  </button>
}

function EmptySchedule({ date, reason }: { date: Date; reason?: string }) {
  return <div className="empty-schedule"><span className="empty-mark" aria-hidden="true">✳</span>
    <h3>{reason ? 'No calendars showing.' : 'A little breathing room.'}</h3>
    <p>{reason || `Nothing is on the calendar for ${sameDay(date, new Date()) ? 'today' : formatLongDate(date)}.`}</p>
  </div>
}

function AgendaList({ date, events, onOpen, emptyReason }: {
  date: Date; events: CalendarEvent[]; onOpen: (event: CalendarEvent) => void; emptyReason?: string
}) {
  return <section className="agenda-list" aria-label={`Events for ${formatLongDate(date)}`}>
    <div className="section-heading"><div><p className="eyebrow">THE DAY AHEAD</p><h2>{sameDay(date, new Date()) ? 'Today’s agenda' : formatLongDate(date)}</h2></div>
      <span className="count-label">{events.length} {events.length === 1 ? 'event' : 'events'}</span>
    </div>
    {events.length ? <div className="event-stack">{events.map(event => <EventCard key={event.id} event={event} onOpen={onOpen} />)}</div>
      : <EmptySchedule date={date} reason={emptyReason} />}
  </section>
}

interface CalendarFilterOption { id: string; name: string; count: number; color: string }

function CalendarFilter({ options, hiddenIds, connected, onToggle }: {
  options: CalendarFilterOption[]; hiddenIds: string[]; connected: boolean; onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape) }
  }, [open])
  const shown = options.filter(option => !hiddenIds.includes(option.id)).length
  return <div className="calendar-filter" ref={ref}>
    <button type="button" className="calendar-filter-trigger" aria-expanded={open} aria-controls="calendar-filter-menu"
      onClick={() => setOpen(value => !value)}>Calendars <span>{shown}/{options.length}</span><span aria-hidden="true">▾</span></button>
    {open && <div id="calendar-filter-menu" className="calendar-filter-menu" role="group" aria-label="Filter calendars">
      <p>Show calendars</p>
      {options.length ? options.map(option => <label className="calendar-filter-option" key={option.id}>
        <input type="checkbox" checked={!hiddenIds.includes(option.id)} onChange={() => onToggle(option.id)} />
        <span className="source-dot" style={{ '--source-color': option.color } as CSSProperties} aria-hidden="true" />
        <span className="calendar-filter-name">{option.name}</span>
        <span className="calendar-filter-count">{option.count}</span>
      </label>) : <p className="calendar-filter-empty">{connected ? 'No calendars enabled. Choose them in Display settings.' : 'No calendar available.'}</p>}
    </div>}
  </div>
}

function GoogleCalendarSettings({ status, onChange, onRefresh }: {
  status: GoogleCalendarStatus | null; onChange: (status: GoogleCalendarStatus) => void; onRefresh: () => void
}) {
  const [calendars, setCalendars] = useState<GoogleCalendarChoice[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!status?.connected) return
    let active = true
    getGoogleCalendars().then(result => {
      if (active) { setCalendars(result.calendars); setSelected(result.selectedIds) }
    }).catch(cause => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [status?.connected])

  async function toggleCalendar(id: string) {
    const next = selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]
    const previous = selected
    setSelected(next)
    setBusy(true)
    setError('')
    try {
      const result = await saveGoogleSelection(next)
      setSelected(result.selectedIds)
      onChange({ ...status!, selectedIds: result.selectedIds })
      onRefresh()
    } catch (cause) { setSelected(previous); setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  async function disconnect() {
    setBusy(true)
    setError('')
    try {
      await disconnectGoogle()
      onChange({ configured: true, connected: false, selectedIds: [] })
      onRefresh()
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <fieldset className="settings-group calendar-sync-settings"><legend>Google Calendar</legend>
    {status === null ? <p className="sync-note">Checking connection…</p>
      : !status.configured ? <p className="sync-note">Local samples are showing. Google Calendar setup is needed on this computer before you can connect.</p>
        : !status.connected ? <><p className="sync-note">Connect to show your calendars and add or edit events after granting permission.</p>
          <a className="calendar-action" href="/api/calendar/connect">Connect Google Calendar</a></>
          : <><p className="sync-note">{status.writeEnabled ? 'Connected. Choose which calendars appear and can receive new events.' : 'Connected for viewing. Reconnect to enable adding and editing events.'}</p>
            <div className="calendar-choices">{calendars.length ? calendars.map(calendar => <label key={calendar.id}>
              <input type="checkbox" checked={selected.includes(calendar.id)} disabled={busy} onChange={() => void toggleCalendar(calendar.id)} />
              <span>{calendar.name}{calendar.primary && <small>Primary</small>}</span>
            </label>) : <p className="sync-note">Loading calendars…</p>}</div>
            <div className="calendar-sync-actions"><button type="button" onClick={onRefresh}>Refresh events</button>
              <a className="calendar-action" href="/api/calendar/connect">{status.writeEnabled ? 'Reconnect' : 'Enable editing'}</a>
              <button type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button></div></>}
    {error && <p className="calendar-error" role="alert">{error}</p>}
  </fieldset>
}

function AppleCalendarSettings({ status, keyboardMode, onChange }: {
  status: AppleCalendarStatus | null; keyboardMode: KeyboardMode; onChange: (status: AppleCalendarStatus) => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onChange(await addAppleCalendar(name, url))
      setName('')
      setUrl('')
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  async function remove(id: string) {
    setBusy(true)
    setError('')
    try { onChange(await removeAppleCalendar(id)) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <fieldset className="settings-group calendar-sync-settings apple-settings"><legend>Apple Calendar · read-only</legend>
    <p className="sync-note">Show an iCloud calendar using its public sharing link. Anyone with that link can view its events. Dayframe keeps the link encrypted on this computer and cannot change Apple events.</p>
    {status?.subscriptions.map(calendar => <div className="apple-subscription" key={calendar.id}>
      <span>{calendar.name}</span><button type="button" disabled={busy} onClick={() => void remove(calendar.id)}
        aria-label={`Remove ${calendar.name} from Dayframe`}>Remove</button></div>)}
    <form className="apple-subscription-form" onSubmit={event => void add(event)}>
      <label>Calendar name<input required maxLength={100} inputMode={keyboardMode === 'dayframe' ? 'none' : 'text'}
        value={name} onChange={event => setName(event.target.value)} placeholder="Family iCloud" /></label>
      <label>iCloud public calendar link<input required inputMode={keyboardMode === 'dayframe' ? 'none' : 'url'}
        value={url} onChange={event => setUrl(event.target.value)} placeholder="webcal://…" /></label>
      <button type="submit" disabled={busy || !status}>{busy ? 'Checking…' : 'Add read-only calendar'}</button>
    </form>
    {error && <p className="calendar-error" role="alert">{error}</p>}
    {!status && <p className="sync-note">Apple Calendar connection is unavailable until this computer has its encryption key configured.</p>}
  </fieldset>
}

function ICloudCalendarSettings({ status, keyboardMode, onChange }: {
  status: ICloudStatus | null; keyboardMode: KeyboardMode; onChange: (status: ICloudStatus) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError('')
    try { onChange(await connectICloud(username, password)); setPassword(''); setUsername('') }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function toggle(id: string) {
    if (!status) return
    setBusy(true); setError('')
    const selectedIds = status.selectedIds.includes(id) ? status.selectedIds.filter(item => item !== id)
      : [...status.selectedIds, id]
    try { onChange(await selectICloudCalendars(selectedIds)) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function disconnect() {
    setBusy(true); setError('')
    try { onChange(await disconnectICloud()); setConfirmDisconnect(false) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  return <fieldset className="settings-group calendar-sync-settings apple-settings"><legend>iCloud account · private</legend>
    <p className="sync-note">Connect with an Apple app-specific password to show private calendars. The password is encrypted on this computer and is never saved in Chrome. iCloud editing stays off until it is approved and tested on a separate calendar.</p>
    {!status?.configured ? <p className="sync-note">Set DAYFRAME_TOKEN_KEY on this computer before connecting.</p>
      : !status.connected ? <form className="apple-subscription-form" onSubmit={event => void connect(event)}>
        <label>Apple Account email<input required type="email" autoComplete="username"
          inputMode={keyboardMode === 'dayframe' ? 'none' : 'email'} value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label>App-specific password<input required type="password" autoComplete="off"
          inputMode={keyboardMode === 'dayframe' ? 'none' : 'text'} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Connect iCloud'}</button>
      </form> : <><p className="sync-note">Connected. Choose calendars to show. {status.writeEnabled
        ? 'Single events on selected calendars can be added or edited.' : 'Editing is disabled while we verify the connection.'}</p>
        <div className="calendar-choices">{status.calendars.map(calendar => <label key={calendar.id}>
          <input type="checkbox" checked={status.selectedIds.includes(calendar.id)} disabled={busy}
            onChange={() => void toggle(calendar.id)} /><span>{calendar.name}</span></label>)}</div>
        {!confirmDisconnect ? <button type="button" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Disconnect iCloud</button>
          : <div className="calendar-sync-actions"><span>Remove saved iCloud credentials from Dayframe?</span>
            <button type="button" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Cancel</button>
            <button type="button" disabled={busy} onClick={() => void disconnect()}>Remove connection</button></div>}</>}
    {error && <p className="calendar-error" role="alert">{error}</p>}
  </fieldset>
}

function WeatherSettings({ location, keyboardMode, onSelect }: {
  location: WeatherLocation | null; keyboardMode: KeyboardMode; onSelect: (location: WeatherLocation) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WeatherLocation[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (query.trim().length < 2) { setError('Enter at least two letters.'); return }
    setBusy(true)
    setError('')
    setResults([])
    try {
      const matches = await searchWeatherLocations(query)
      setResults(matches)
      if (!matches.length) setError('No matching locations. Try a nearby city or postal code.')
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <fieldset className="settings-group weather-settings"><legend>Weather</legend>
    <p className="sync-note">Choose a location to show live conditions in the header. No location is used until you select one.</p>
    {location && <p className="weather-selected">Showing weather for <strong>{location.name}{location.region ? `, ${location.region}` : ''}</strong>.</p>}
    <form className="weather-search" onSubmit={event => void search(event)}>
      <label htmlFor="weather-location">Search weather location</label>
      <div><input id="weather-location" inputMode={keyboardMode === 'dayframe' ? 'none' : 'search'} value={query} onChange={event => setQuery(event.target.value)}
        placeholder="City or postal code" autoComplete="off" /><button type="submit" disabled={busy}>{busy ? 'Finding…' : 'Find location'}</button></div>
    </form>
    {error && <p className="calendar-error" role="alert">{error}</p>}
    {results.length > 0 && <div className="weather-results" aria-label="Weather locations">{results.map(result =>
      <button type="button" key={result.id} onClick={() => { onSelect(result); setResults([]); setQuery('') }}>
        <strong>{result.name}{result.region ? `, ${result.region}` : ''}</strong><span>{result.country}</span>
      </button>)}</div>}
    <p className="weather-credit">Weather data by Open-Meteo.</p>
  </fieldset>
}

function WeekTimeGrid({ date, now, events, slotStart, onOpen, onDay, onEmptyHour }: {
  date: Date; now: Date; events: CalendarEvent[]; slotStart: Date | null;
  onOpen: (event: CalendarEvent) => void; onDay: (day: Date) => void; onEmptyHour: (start: Date) => void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i))
  const weekStartTime = days[0].getTime()
  const isCurrentWeek = days.some(day => sameDay(day, now))
  const nowMarkerRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!isCurrentWeek) return
    const marker = nowMarkerRef.current
    if (!marker) return
    const markerTop = marker.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: Math.max(0, markerTop - Math.min(220, window.innerHeight * .28)), behavior: 'instant' })
  }, [weekStartTime, isCurrentWeek])
  return <div className="week-timegrid" role="group" aria-label={`Week of ${formatWeekRange(date)}`}>
    <div className="week-timegrid-scroll" role="region" tabIndex={0}
      aria-label="Weekly hourly calendar, midnight to midnight">
      <div className="week-timegrid-content">
        <div className="timegrid-sticky">
          <div className="timegrid-head"><span className="timegrid-corner" aria-hidden="true">TIME</span>{days.map(day =>
            <button key={day.toDateString()} className={`timegrid-date${sameDay(day, new Date()) ? ' is-today' : ''}`}
              onClick={() => onDay(day)} aria-label={`View ${formatLongDate(day)} in Agenda`}>
              <span>{weekdays[day.getDay()].slice(0, 3)}</span><strong>{day.getDate()}</strong>
            </button>)}</div>
          <div className="timegrid-allday"><span className="timegrid-allday-label">ALL DAY</span>{days.map(day =>
            <div className="timegrid-allday-cell" key={day.toDateString()}>{eventsOn(events, day).filter(event => event.allDay).map(event =>
              <button key={event.id} className={`timegrid-allday-event category-${event.category}`} style={eventStyle(event)} onClick={() => onOpen(event)}
                aria-label={`All day, ${event.title}, ${eventLabel(event)}. Open details`} title={eventLabel(event)}>{event.title}</button>)}</div>)}</div>
        </div>
        <div className="timegrid-body">
          <div className="timegrid-hours" aria-hidden="true">{Array.from({ length: 25 }, (_, hour) =>
            <span key={hour} style={{ top: hour * WEEK_HOUR_HEIGHT }}>{new Intl.DateTimeFormat('en-US', { hour: 'numeric' }).format(new Date(2020, 0, 1, hour))}</span>)}</div>
          <div className="timegrid-days">{days.map((day, dayIndex) =>
            <section className={`timegrid-day${sameDay(day, new Date()) ? ' is-today' : ''}`} key={day.toDateString()}
              data-day-index={dayIndex} aria-label={formatLongDate(day)}>
              {Array.from({ length: 24 }, (_, hour) => {
                const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour)
                return <button key={hour} type="button" tabIndex={-1} className="timegrid-empty-hour"
                  style={{ top: hour * WEEK_HOUR_HEIGHT, height: WEEK_HOUR_HEIGHT }}
                  aria-label={`Add event on ${formatLongDate(day)} at ${formatTime(start)}`}
                  onClick={() => onEmptyHour(start)} />
              })}
              {Array.from({ length: 25 }, (_, hour) => <span key={hour} className="timegrid-hour-line" style={{ top: hour * WEEK_HOUR_HEIGHT }} aria-hidden="true" />)}
              {sameDay(day, now) && <div ref={nowMarkerRef} className="timegrid-now" role="img" aria-label={`Current time ${formatTime(now)}`}
                style={{ top: (now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600) * WEEK_HOUR_HEIGHT }} />}
              {slotStart && sameDay(day, slotStart) && <div className="timegrid-placeholder"
                style={{ top: slotStart.getHours() * WEEK_HOUR_HEIGHT, height: WEEK_HOUR_HEIGHT }}
                role="status" aria-label={`New event placeholder at ${formatTime(slotStart)}`}>
                <span>{formatTime(slotStart)}</span><strong>New event</strong>
              </div>}
              {layoutDayEvents(eventsOn(events, day), day).map(({ event, top, height, column, columns }) =>
                <button key={event.id} className={`timegrid-event category-${event.category}${height < 55 ? ' is-short' : ''}`}
                  style={{ ...eventStyle(event), top, height, left: `calc(${column / columns * 100}% + 3px)`, width: `calc(${100 / columns}% - 6px)` }}
                  data-event-id={event.id} data-column={column} data-columns={columns}
                  onClick={() => onOpen(event)} aria-label={`${formatTime(event.start)} ${event.title}, ${eventLabel(event)}. Open details`} title={eventLabel(event)}>
                  <span>{formatTime(event.start)}</span><strong>{event.title}</strong><small className="timegrid-event-source">{eventLabel(event)}</small>
                </button>)}</section>)}</div>
        </div>
      </div>
    </div>
    <p className="timegrid-scroll-hint">Swipe sideways for the full week</p>
  </div>
}

function MonthGrid({ date, events, onOpen, onDay }: {
  date: Date; events: CalendarEvent[]; onOpen: (event: CalendarEvent) => void; onDay: (day: Date) => void
}) {
  return <div className="month-calendar" role="group" aria-label={formatMonth(date)}>
    <div className="month-weekdays">{weekdays.map(name => <span key={name}>{name}</span>)}</div>
    <div className="month-grid">{monthGrid(date).map(day => {
      const items = eventsOn(events, day)
      return <section key={day.toDateString()} className={`month-day${day.getMonth() !== date.getMonth() ? ' is-outside' : ''}${sameDay(day, new Date()) ? ' is-today' : ''}`}
        aria-label={formatLongDate(day)}>
        <button className="month-date" onClick={() => onDay(day)} aria-label={`View ${formatLongDate(day)}`}>{day.getDate()}</button>
        <div className="month-events">{items.slice(0, 2).map(event => <button key={event.id} className={`month-event category-${event.category}`}
          style={eventStyle(event)} onClick={() => onOpen(event)} aria-label={`${formatTime(event.start)} ${event.title}, ${eventLabel(event)}. Open details`} title={eventLabel(event)}>
          <span>{event.allDay ? 'All day' : formatTime(event.start)}</span> {event.title}</button>)}
          {items.length > 2 && <button className="more-events" onClick={() => onDay(day)}>+{items.length - 2} more · View day</button>}
        </div>
      </section>
    })}</div>
  </div>
}

export default function App() {
  const [now, setNow] = useState(() => new Date())
  const [display, setDisplay] = useState(loadDisplay)
  const [activeFace, setActiveFace] = useState<Face>(display.face)
  const [allEvents, setAllEvents] = useState(() => loadEvents(new Date()))
  const [visibleEvents, setVisibleEvents] = useState<CalendarEvent[]>([])
  const [cursor, setCursor] = useState(() => new Date())
  const [followToday, setFollowToday] = useState(true)
  const [panel, setPanel] = useState<'display' | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [editor, setEditor] = useState<{ event: CalendarEvent | null; date: Date; fromWeekSlot?: boolean;
    scope?: 'occurrence' | 'series' } | null>(null)
  const [seriesChoice, setSeriesChoice] = useState<CalendarEvent | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [seriesError, setSeriesError] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<CalendarEvent | null>(null)
  const [deleteScope, setDeleteScope] = useState<'occurrence' | 'series'>('occurrence')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [recentlyDeleted, setRecentlyDeleted] = useState<CalendarEvent | null>(null)
  const [storageWarning, setStorageWarning] = useState(() => !storageAvailable())
  const [calendarStatus, setCalendarStatus] = useState<GoogleCalendarStatus | null>(null)
  const [sourceCalendars, setSourceCalendars] = useState<GoogleCalendarChoice[]>([])
  const [calendarError, setCalendarError] = useState('')
  const [calendarStatusError, setCalendarStatusError] = useState('')
  const [calendarSyncing, setCalendarSyncing] = useState(false)
  const [lastCalendarSync, setLastCalendarSync] = useState<Date | null>(null)
  const lastCalendarRange = useRef('')
  const [calendarRevision, setCalendarRevision] = useState(0)
  const [appleStatus, setAppleStatus] = useState<AppleCalendarStatus | null>(null)
  const [appleEvents, setAppleEvents] = useState<CalendarEvent[]>([])
  const [appleError, setAppleError] = useState('')
  const [appleSyncing, setAppleSyncing] = useState(false)
  const [lastAppleSync, setLastAppleSync] = useState<Date | null>(null)
  const [appleRevision, setAppleRevision] = useState(0)
  const lastAppleRange = useRef('')
  const [iCloudStatus, setICloudStatus] = useState<ICloudStatus | null>(null)
  const [iCloudEvents, setICloudEvents] = useState<CalendarEvent[]>([])
  const [iCloudError, setICloudError] = useState('')
  const [iCloudSyncing, setICloudSyncing] = useState(false)
  const [lastICloudSync, setLastICloudSync] = useState<Date | null>(null)
  const [iCloudRevision, setICloudRevision] = useState(0)
  const lastICloudRange = useRef('')
  const [weather, setWeather] = useState<SavedWeather>(loadWeather)
  const [weatherError, setWeatherError] = useState('')
  const selectedCalendarIds = calendarStatus?.selectedIds.join(',')
  const provider = useMemo(() => calendarStatus?.connected ? googleEventProvider() : localEventProvider(allEvents),
    [allEvents, calendarStatus?.connected])
  const range = useMemo(() => dateRange(activeFace, cursor), [activeFace, cursor])

  useEffect(() => {
    let lastTick = new Date()
    const timer = window.setInterval(() => {
      const current = new Date()
      if (followToday && !sameDay(current, lastTick)) setCursor(current)
      lastTick = current
      setNow(current)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [followToday])
  useEffect(() => {
    document.documentElement.dataset.theme = display.theme
    document.documentElement.style.colorScheme = display.theme === 'dark' || display.theme === 'contrast' ? 'dark' : 'light'
    const colors: Record<Theme, string> = { light: '#f5f3ec', dark: '#1c2426', cozy: '#f4ead9', contrast: '#101514' }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[display.theme])
  }, [display.theme])
  const refreshGoogleStatus = useCallback(() => {
    getGoogleStatus().then(status => { setCalendarStatus(status); setCalendarStatusError('') })
      .catch(() => setCalendarStatusError('Could not check the Google Calendar connection.'))
  }, [])
  useEffect(() => {
    refreshGoogleStatus()
    const refreshEvents = () => setCalendarRevision(value => value + 1)
    const resume = () => { if (!document.hidden) { refreshGoogleStatus(); refreshEvents() } }
    const timer = window.setInterval(refreshEvents, 5 * 60 * 1000)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [refreshGoogleStatus])
  useEffect(() => {
    if (!calendarStatus?.connected) return
    let active = true
    getGoogleCalendars().then(result => { if (active) setSourceCalendars(result.calendars) })
      .catch(() => { if (active) setSourceCalendars([]) })
    return () => { active = false }
  }, [calendarStatus?.connected, selectedCalendarIds])
  useEffect(() => {
    let active = true
    const rangeKey = `${calendarStatus?.connected ? 'google' : 'local'}:${range[0].toISOString()}:${range[1].toISOString()}`
    const changedRange = lastCalendarRange.current !== rangeKey
    lastCalendarRange.current = rangeKey
    queueMicrotask(() => {
      if (!active) return
      if (changedRange) setVisibleEvents([])
      setCalendarSyncing(true)
    })
    provider.getEvents(range[0], range[1]).then(events => {
      if (active) {
        setVisibleEvents(events)
        setCalendarError('')
        if (calendarStatus?.connected) setLastCalendarSync(new Date())
      }
    }).catch(cause => { if (active) setCalendarError(cause instanceof Error ? cause.message : 'Refresh failed.') })
      .finally(() => { if (active) setCalendarSyncing(false) })
    return () => { active = false }
  }, [provider, range, calendarRevision, calendarStatus?.connected])
  useEffect(() => {
    getAppleStatus().then(setAppleStatus).catch(cause => setAppleError((cause as Error).message))
    const refresh = () => setAppleRevision(value => value + 1)
    const resume = () => { if (!document.hidden) refresh() }
    const timer = window.setInterval(refresh, 15 * 60 * 1000)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])
  useEffect(() => {
    if (!appleStatus?.subscriptions.length) return
    let active = true
    const rangeKey = `${appleStatus.subscriptions.map(item => item.id).join(',')}:${range[0].toISOString()}:${range[1].toISOString()}`
    const changedRange = lastAppleRange.current !== rangeKey
    lastAppleRange.current = rangeKey
    queueMicrotask(() => {
      if (!active) return
      if (changedRange) setAppleEvents([])
      setAppleSyncing(true)
    })
    getAppleEvents(range[0], range[1]).then(events => {
      if (active) { setAppleEvents(events); setAppleError(''); setLastAppleSync(new Date()) }
    }).catch(cause => { if (active) setAppleError((cause as Error).message) })
      .finally(() => { if (active) setAppleSyncing(false) })
    return () => { active = false }
  }, [appleStatus, range, appleRevision])
  useEffect(() => {
    getICloudStatus().then(setICloudStatus).catch(cause => setICloudError((cause as Error).message))
    const refresh = () => setICloudRevision(value => value + 1)
    const resume = () => { if (!document.hidden) refresh() }
    const timer = window.setInterval(refresh, 5 * 60 * 1000)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])
  useEffect(() => {
    if (!iCloudStatus?.connected || !iCloudStatus.selectedIds.length) return
    let active = true
    const rangeKey = `${iCloudStatus.selectedIds.join(',')}:${range[0].toISOString()}:${range[1].toISOString()}`
    const changedRange = lastICloudRange.current !== rangeKey
    lastICloudRange.current = rangeKey
    queueMicrotask(() => {
      if (!active) return
      if (changedRange) setICloudEvents([])
      setICloudSyncing(true)
    })
    getICloudEvents(range[0], range[1]).then(events => {
      if (active) { setICloudEvents(events); setICloudError(''); setLastICloudSync(new Date()) }
    }).catch(cause => { if (active) setICloudError((cause as Error).message) })
      .finally(() => { if (active) setICloudSyncing(false) })
    return () => { active = false }
  }, [iCloudStatus, range, iCloudRevision])
  useEffect(() => {
    const location = weather.location
    if (!location) return
    let active = true
    async function refresh() {
      try {
        const reading = await fetchWeather(location!)
        if (!active) return
        const updated = { location, reading }
        setWeather(updated)
        setWeatherError('')
        if (!saveWeather(updated)) setStorageWarning(true)
      } catch (cause) { if (active) setWeatherError((cause as Error).message) }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30 * 60 * 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [weather.location])

  const combinedEvents = [...visibleEvents, ...appleEvents, ...iCloudEvents]
  const countableEvents = activeFace === 'agenda' ? eventsOn(combinedEvents, cursor).filter(event =>
    !sameDay(cursor, now) || event.allDay || new Date(event.end).getTime() > now.getTime()) : combinedEvents
  const baseCalendarOptions: CalendarFilterOption[] = calendarStatus?.connected
    ? calendarStatus.selectedIds.map(id => {
      const source = sourceCalendars.find(calendar => calendar.id === id)
      const matching = countableEvents.filter(event => event.calendarId === id)
      return { id, name: source?.name || matching[0]?.calendarName || id, count: matching.length,
        color: matching.find(event => event.color)?.color?.background || 'var(--accent)' }
    })
    : [{ id: 'local-samples', name: 'Local samples', count: countableEvents.filter(event => event.source.startsWith('local')).length, color: 'var(--accent)' }]
  const calendarOptions: CalendarFilterOption[] = [...baseCalendarOptions,
    ...(appleStatus?.subscriptions || []).map(calendar => ({ id: calendar.id, name: calendar.name,
      count: countableEvents.filter(event => event.calendarId === calendar.id).length, color: '#8c9fcb' })),
    ...(iCloudStatus?.calendars || []).filter(calendar => iCloudStatus?.selectedIds.includes(calendar.id))
      .map(calendar => ({ id: calendar.id, name: calendar.name,
        count: countableEvents.filter(event => event.calendarId === calendar.id).length, color: '#90b7d4' }))]
  const filteredEvents = combinedEvents.filter(event => !display.hiddenCalendarIds.includes(
    event.source.startsWith('local') ? 'local-samples' : event.calendarId || event.calendarName || event.source))
  const selectedEvents = eventsOn(filteredEvents, cursor).filter(event =>
    !sameDay(cursor, now) || event.allDay || new Date(event.end).getTime() > now.getTime())

  function toggleCalendarVisibility(id: string) {
    const hiddenCalendarIds = display.hiddenCalendarIds.includes(id)
      ? display.hiddenCalendarIds.filter(item => item !== id) : [...display.hiddenCalendarIds, id]
    const nextDisplay = { ...display, hiddenCalendarIds }
    setDisplay(nextDisplay)
    if (!save('display', nextDisplay)) setStorageWarning(true)
  }

  function chooseFace(face: Face) {
    const nextDisplay = { ...display, face }
    setDisplay(nextDisplay)
    setActiveFace(face)
    setCursor(new Date())
    setFollowToday(true)
    if (!save('display', nextDisplay)) setStorageWarning(true)
  }
  function chooseTheme(theme: Theme) {
    const nextDisplay = { ...display, theme }
    setDisplay(nextDisplay)
    if (!save('display', nextDisplay)) setStorageWarning(true)
  }
  function chooseKeyboardMode(keyboardMode: KeyboardMode) {
    const nextDisplay = { ...display, keyboardMode }
    setDisplay(nextDisplay)
    if (!save('display', nextDisplay)) setStorageWarning(true)
  }
  function chooseWeatherLocation(location: WeatherLocation) {
    const updated = { location, reading: null }
    setWeather(updated)
    setWeatherError('')
    if (!saveWeather(updated)) setStorageWarning(true)
  }
  function changeAppleStatus(status: AppleCalendarStatus) {
    setAppleStatus(status)
    setAppleEvents([])
    setAppleError('')
    setAppleRevision(value => value + 1)
  }
  function changeICloudStatus(status: ICloudStatus) {
    setICloudStatus(status)
    setICloudEvents([])
    setICloudError('')
    setICloudRevision(value => value + 1)
  }
  async function saveEvent(draft: EventDraft) {
    if (draft.calendarId.startsWith('icloud:') && iCloudStatus?.writeEnabled) {
      await saveICloudEvent(draft, editor?.event || undefined)
      setICloudRevision(value => value + 1)
    } else if (calendarStatus?.connected) {
      await saveGoogleEvent(draft, editor?.event || undefined, editor?.scope)
      setCalendarRevision(value => value + 1)
    } else {
      const original = editor?.event
      const item: CalendarEvent = { id: original?.id || crypto.randomUUID(), source: original?.source || 'local',
        title: draft.title, start: draft.allDay ? `${draft.start}T00:00:00` : draft.start,
        end: draft.allDay ? `${draft.end}T00:00:00` : draft.end, allDay: draft.allDay,
        category: draft.category, location: draft.location || undefined, description: draft.description || undefined }
      const next = [...allEvents.filter(event => event.id !== item.id), item].sort((a, b) => a.start.localeCompare(b.start))
      if (!save('events', { items: next })) throw new Error('This browser could not save the event. Check local storage.')
      setAllEvents(next)
    }
    setSelectedEvent(null)
    setEditor(null)
  }
  function navigate(direction: -1 | 1) {
    setFollowToday(false)
    if (activeFace === 'agenda') setCursor(date => addDays(date, direction))
    else if (activeFace === 'month') setCursor(date => new Date(date.getFullYear(), date.getMonth() + direction, 1))
    else setCursor(date => addDays(date, direction * 7))
  }
  function openDayAgenda(day: Date) {
    // Day drilldown is temporary; the saved default face remains Month.
    setCursor(day)
    setActiveFace('agenda')
    setFollowToday(sameDay(day, new Date()))
  }
  function returnToCurrent() {
    setCursor(new Date())
    setFollowToday(true)
  }
  async function editEntireSeries() {
    if (!seriesChoice) return
    setSeriesLoading(true)
    setSeriesError('')
    try {
      const parent = await getGoogleSeries(seriesChoice)
      setEditor({ event: parent, date: new Date(parent.start), scope: 'series' })
      setSeriesChoice(null)
    } catch (cause) { setSeriesError((cause as Error).message) }
    finally { setSeriesLoading(false) }
  }
  async function confirmDelete() {
    if (!deleteCandidate) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      if (deleteCandidate.source === 'google') {
        const target = deleteCandidate.recurringEventId && deleteScope === 'series'
          ? await getGoogleSeries(deleteCandidate) : deleteCandidate
        await deleteGoogleEvent(target, target.recurrence ? 'series' : target.recurringEventId ? 'occurrence' : undefined)
        setCalendarRevision(value => value + 1)
      } else {
        const next = allEvents.filter(event => event.id !== deleteCandidate.id)
        if (!save('events', { items: next })) throw new Error('This browser could not save the change.')
        setAllEvents(next)
        setRecentlyDeleted(deleteCandidate)
      }
      setDeleteCandidate(null)
    } catch (cause) { setDeleteError((cause as Error).message) }
    finally { setDeleteBusy(false) }
  }
  function undoLocalDelete() {
    if (!recentlyDeleted) return
    const next = [...allEvents, recentlyDeleted].sort((a, b) => a.start.localeCompare(b.start))
    if (!save('events', { items: next })) { setStorageWarning(true); return }
    setAllEvents(next)
    setRecentlyDeleted(null)
  }

  return <div className="app-shell">
    <aside className="side-rail" aria-label="Dayframe navigation">
      <div className="brand" aria-label="Dayframe"><span className="brand-mark" style={{ maskImage: `url("${brandIcon}")` }} aria-hidden="true" /><span className="brand-name">Dayframe</span></div>
      <nav className="face-nav" aria-label="Calendar face">{faces.map(face => <button key={face}
        className={activeFace === face ? 'active' : ''} aria-current={activeFace === face ? 'page' : undefined}
        onClick={() => chooseFace(face)}><span className="nav-icon" style={{ maskImage: `url("${faceIcons[face]}")` }} aria-hidden="true" />{faceNames[face]}</button>)}</nav>
      <div className="rail-actions"><button onClick={() => setPanel('display')}><span className="nav-icon" style={{ maskImage: `url("${displayIcon}")` }} aria-hidden="true" />Display</button></div>
    </aside>
    <div className="workspace">
    <header className="topbar">
      <div className="header-date"><span className="header-label">TODAY</span><strong>{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now)}</strong></div>
      <div className="header-time"><span className="header-label">LOCAL TIME</span><strong>{formatTime(now)}</strong></div>
      <button className="header-weather" onClick={() => setPanel('display')} aria-label="Open weather location settings">
        <span className="header-weather-emoji" aria-hidden="true">{weather.reading ? weatherSymbol(weather.reading.code, weather.reading.isDay) : '📍'}</span>
        <span><span className="header-label">WEATHER</span><strong>{weather.reading ? `${Math.round(weather.reading.temperature)}°` : weatherError ? 'Unavailable' : weather.location ? 'Updating…' : 'Set location'}</strong>
          <small>{weather.reading ? `${weather.location?.name || 'Selected location'} · ${weatherError ? 'Last reading' : weatherDescription(weather.reading.code)}` : weather.location?.name || 'Choose your city'}</small></span>
      </button>
    </header>
    {storageWarning && <div className="storage-notice" role="status">This browser is not saving changes. Check that local storage is available.</div>}
    {recentlyDeleted && <div className="calendar-health" role="status"><span>{recentlyDeleted.title} was removed from this display.</span>
      <button type="button" onClick={undoLocalDelete}>Undo</button></div>}
    {(calendarStatus?.connected || calendarStatusError) && <div className={`calendar-health${calendarError || calendarStatusError ? ' has-error' : ''}`}
      role={calendarError || calendarStatusError ? 'alert' : 'status'}>
      <span>{calendarStatusError || (calendarError
        ? `Google Calendar unavailable · ${lastCalendarSync ? `Last updated ${syncTimeLabel(lastCalendarSync, now)}` : 'No recent reading'} · ${calendarError}`
        : calendarSyncing ? 'Google Calendar syncing…' : lastCalendarSync
          ? `Google Calendar updated ${syncTimeLabel(lastCalendarSync, now)}` : 'Google Calendar is waiting to sync.')}</span>
      <button type="button" onClick={() => { refreshGoogleStatus(); setCalendarRevision(value => value + 1) }}
        disabled={calendarSyncing && !calendarStatusError}>Retry sync</button>
    </div>}
    {Boolean(appleStatus?.subscriptions.length) && <div className={`calendar-health${appleError ? ' has-error' : ''}`}
      role={appleError ? 'alert' : 'status'}>
      <span>{appleError
        ? `Apple Calendar unavailable · ${lastAppleSync ? `Last updated ${syncTimeLabel(lastAppleSync, now)}` : 'No recent reading'} · ${appleError}`
        : appleSyncing ? 'Apple Calendar syncing…' : lastAppleSync
          ? `Apple Calendar updated ${syncTimeLabel(lastAppleSync, now)}` : 'Apple Calendar is waiting to sync.'}</span>
      <button type="button" disabled={appleSyncing} onClick={() => setAppleRevision(value => value + 1)}>Retry sync</button>
    </div>}
    {Boolean(iCloudStatus?.connected && iCloudStatus.selectedIds.length) && <div className={`calendar-health${iCloudError ? ' has-error' : ''}`}
      role={iCloudError ? 'alert' : 'status'}>
      <span>{iCloudError
        ? `iCloud unavailable · ${lastICloudSync ? `Last updated ${syncTimeLabel(lastICloudSync, now)}` : 'No recent reading'} · ${iCloudError}`
        : iCloudSyncing ? 'iCloud syncing…' : lastICloudSync
          ? `iCloud updated ${syncTimeLabel(lastICloudSync, now)}` : 'iCloud is waiting to sync.'}</span>
      <button type="button" disabled={iCloudSyncing} onClick={() => setICloudRevision(value => value + 1)}>Retry sync</button>
    </div>}
    <main>
      <h1 className="sr-only">Dayframe calendar</h1>
      {activeFace === 'agenda' && <><div className="calendar-toolbar agenda-toolbar"><h2>{formatLongDate(cursor)}</h2>
        <div className="calendar-toolbar-actions"><CalendarFilter options={calendarOptions} hiddenIds={display.hiddenCalendarIds}
          connected={Boolean(calendarStatus?.connected || appleStatus?.subscriptions.length || iCloudStatus?.selectedIds.length)} onToggle={toggleCalendarVisibility} />
          <div className="period-actions"><button onClick={() => navigate(-1)} aria-label="Previous day">←</button><button className="today-button" onClick={returnToCurrent}>Today</button><button onClick={() => navigate(1)} aria-label="Next day">→</button></div></div></div>
      <div className="agenda-layout"><AgendaList date={cursor} events={selectedEvents} onOpen={setSelectedEvent}
        emptyReason={!calendarOptions.length && calendarStatus?.connected ? 'Choose calendars in Display settings to show events.'
          : calendarOptions.length && calendarOptions.every(option => display.hiddenCalendarIds.includes(option.id))
            ? 'Choose at least one calendar from the Calendars menu to show events.' : undefined} /></div></>}
      {activeFace === 'week' && <section className="calendar-view">
        <div className="calendar-toolbar"><h2>{formatWeekRange(cursor)}</h2>
          <div className="calendar-toolbar-actions"><CalendarFilter options={calendarOptions} hiddenIds={display.hiddenCalendarIds}
            connected={Boolean(calendarStatus?.connected || appleStatus?.subscriptions.length || iCloudStatus?.selectedIds.length)} onToggle={toggleCalendarVisibility} />
            <div className="period-actions"><button onClick={() => navigate(-1)} aria-label="Previous week">←</button><button className="today-button" onClick={returnToCurrent}>This week</button><button onClick={() => navigate(1)} aria-label="Next week">→</button></div></div></div>
        <WeekTimeGrid date={cursor} now={now} events={filteredEvents}
          slotStart={editor?.fromWeekSlot && !editor.event ? editor.date : null}
          onOpen={setSelectedEvent} onDay={openDayAgenda}
          onEmptyHour={date => setEditor({ event: null, date, fromWeekSlot: true })} />
      </section>}
      {activeFace === 'month' && <section className="calendar-view">
        <div className="calendar-toolbar"><h2>{formatMonth(cursor)}</h2>
          <div className="calendar-toolbar-actions"><CalendarFilter options={calendarOptions} hiddenIds={display.hiddenCalendarIds}
            connected={Boolean(calendarStatus?.connected || appleStatus?.subscriptions.length || iCloudStatus?.selectedIds.length)} onToggle={toggleCalendarVisibility} />
            <div className="period-actions"><button onClick={() => navigate(-1)} aria-label="Previous month">←</button><button className="today-button" onClick={returnToCurrent}>This month</button><button onClick={() => navigate(1)} aria-label="Next month">→</button></div></div></div>
        <MonthGrid date={cursor} events={filteredEvents} onOpen={setSelectedEvent} onDay={openDayAgenda} />
      </section>}
    </main>
    <button className="floating-add-event" type="button" aria-label="Add event" title="Add event"
      onClick={() => setEditor({ event: null, date: cursor })}><span aria-hidden="true">+</span></button>
    </div>
    {panel === 'display' && <AppDialog title="Display" eyebrow="MAKE IT YOURS" drawer onDismiss={() => setPanel(null)}>
      <p className="dialog-intro">Choose the view that feels right for your home. Changes are saved on this display.</p>
      <fieldset className="settings-group"><legend>Calendar face</legend><div className="setting-options" role="radiogroup" aria-label="Calendar face">{faces.map(face => <button key={face}
        className={`setting-choice${display.face === face ? ' selected' : ''}`} role="radio" aria-checked={display.face === face} onClick={() => chooseFace(face)}>
        <span className={`face-preview face-preview-${face}`} aria-hidden="true"><i /><i /><i /><i /></span><span><strong>{faceNames[face]}</strong><small>{face === 'agenda' ? 'Today, in order' : face === 'week' ? 'Seven-day grid' : 'The whole month'}</small></span>
        <span className="choice-check" aria-hidden="true">{display.face === face ? '✓' : ''}</span></button>)}</div></fieldset>
      <GoogleCalendarSettings status={calendarStatus} onChange={setCalendarStatus} onRefresh={() => setCalendarRevision(value => value + 1)} />
      <AppleCalendarSettings status={appleStatus} keyboardMode={display.keyboardMode} onChange={changeAppleStatus} />
      <ICloudCalendarSettings status={iCloudStatus} keyboardMode={display.keyboardMode} onChange={changeICloudStatus} />
      <WeatherSettings location={weather.location} keyboardMode={display.keyboardMode} onSelect={chooseWeatherLocation} />
      <fieldset className="settings-group"><legend>Touch keyboard</legend><div className="setting-options" role="radiogroup" aria-label="Touch keyboard">
        <button type="button" className={`setting-choice${display.keyboardMode === 'system' ? ' selected' : ''}`}
          role="radio" aria-checked={display.keyboardMode === 'system'} onClick={() => chooseKeyboardMode('system')}>
          <span className="keyboard-choice-icon" aria-hidden="true"><span className="nav-icon" style={{ maskImage: `url("${windowsIcon}")` }} /></span>
          <span><strong>Windows touch keyboard</strong><small>Opens on touch when Windows allows it.</small></span>
          <span className="choice-check" aria-hidden="true">{display.keyboardMode === 'system' ? '✓' : ''}</span></button>
        <button type="button" className={`setting-choice${display.keyboardMode === 'dayframe' ? ' selected' : ''}`}
          role="radio" aria-checked={display.keyboardMode === 'dayframe'} onClick={() => chooseKeyboardMode('dayframe')}>
          <span className="keyboard-choice-icon" aria-hidden="true"><span className="nav-icon" style={{ maskImage: `url("${keyboardIcon}")` }} /></span>
          <span><strong>Dayframe keyboard</strong><small>Opens inside Dayframe when you tap a text field.</small></span>
          <span className="choice-check" aria-hidden="true">{display.keyboardMode === 'dayframe' ? '✓' : ''}</span></button>
      </div></fieldset>
      <fieldset className="settings-group"><legend>Appearance</legend><div className="setting-options" role="radiogroup" aria-label="Appearance">{themes.map(theme => <button key={theme}
        className={`setting-choice${display.theme === theme ? ' selected' : ''}`} role="radio" aria-checked={display.theme === theme} onClick={() => chooseTheme(theme)}>
        <span className={`theme-swatch swatch-${theme}`} aria-hidden="true"><i /><i /></span><span><strong>{themeNames[theme]}</strong><small>{theme === 'light' ? 'Soft and airy' : theme === 'dark' ? 'Easy on evening eyes' : theme === 'cozy' ? 'A warmer paper feel' : 'Clear from across the room'}</small></span>
        <span className="choice-check" aria-hidden="true">{display.theme === theme ? '✓' : ''}</span></button>)}</div></fieldset>
    </AppDialog>}
    {editor && <AppDialog title={editor.event ? 'Edit event' : 'Add event'} eyebrow="CALENDAR" iconClose onDismiss={() => setEditor(null)}>
      {calendarStatus?.connected && !calendarStatus.writeEnabled && !(iCloudStatus?.connected && iCloudStatus.writeEnabled)
        ? <div className="editor-permission"><p>Reconnect Google Calendar to allow Dayframe to add and edit events.</p>
          <a className="calendar-action" href="/api/calendar/connect">Enable event editing</a></div>
        : <EventEditor original={editor.event} date={editor.date} slotStart={editor.fromWeekSlot ? editor.date : undefined}
          connected={Boolean(calendarStatus?.connected || (iCloudStatus?.connected && iCloudStatus.writeEnabled))}
          keyboardMode={display.keyboardMode}
          calendars={[...sourceCalendars.filter(calendar => calendarStatus?.selectedIds.includes(calendar.id)),
            ...(iCloudStatus?.connected && iCloudStatus.writeEnabled ? iCloudStatus.calendars.filter(calendar => iCloudStatus.selectedIds.includes(calendar.id))
              .map(calendar => ({ ...calendar, primary: false, accessRole: 'writer' })) : [])]}
          onSave={saveEvent} onCancel={() => setEditor(null)} />}
    </AppDialog>}
    {seriesChoice && <AppDialog title="Edit repeating event" eyebrow="CALENDAR" onDismiss={() => setSeriesChoice(null)}>
      <p className="dialog-intro">Choose which events your changes should affect.</p>
      <div className="series-choice-actions">
        <button type="button" disabled={seriesLoading} onClick={() => {
          setEditor({ event: seriesChoice, date: new Date(seriesChoice.start), scope: 'occurrence' }); setSeriesChoice(null)
        }}>This occurrence</button>
        <button type="button" disabled={seriesLoading} onClick={() => void editEntireSeries()}>Entire series</button>
      </div>
      {seriesError && <p className="calendar-error" role="alert">{seriesError}</p>}
    </AppDialog>}
    {deleteCandidate && <AppDialog title="Delete event?" eyebrow="CALENDAR" onDismiss={() => setDeleteCandidate(null)}>
      <p className="dialog-intro">Delete {deleteCandidate.title}? {deleteCandidate.source === 'google'
        ? 'Google may keep this event in Trash for 30 days. Guests may receive an update.'
        : 'You can undo this change until you reload Dayframe.'}</p>
      {deleteCandidate.recurringEventId && <div className="series-choice-actions" role="radiogroup" aria-label="Delete repeating event">
        <button type="button" role="radio" aria-checked={deleteScope === 'occurrence'} disabled={deleteBusy}
          onClick={() => setDeleteScope('occurrence')}>This occurrence</button>
        <button type="button" role="radio" aria-checked={deleteScope === 'series'} disabled={deleteBusy}
          onClick={() => setDeleteScope('series')}>Entire series</button>
      </div>}
      {deleteError && <p className="calendar-error" role="alert">{deleteError}</p>}
      <div className="editor-actions"><button type="button" disabled={deleteBusy} onClick={() => setDeleteCandidate(null)}>Cancel</button>
        <button type="button" disabled={deleteBusy} onClick={() => void confirmDelete()}>{deleteBusy ? 'Deleting…' : 'Delete event'}</button></div>
    </AppDialog>}
    {selectedEvent && <AppDialog title={selectedEvent.title} eyebrow={eventLabel(selectedEvent).toUpperCase()} eventHeader
      onDismiss={() => setSelectedEvent(null)}
      onDelete={selectedEvent.source === 'local' || (selectedEvent.source === 'google' && calendarStatus?.writeEnabled && selectedEvent.editable)
        ? () => { setDeleteScope('occurrence'); setDeleteError(''); setDeleteCandidate(selectedEvent); setSelectedEvent(null) } : undefined}
      onEdit={selectedEvent.source.startsWith('local') || (selectedEvent.source === 'google' && calendarStatus?.writeEnabled && selectedEvent.editable)
        || (selectedEvent.source === 'icloud' && iCloudStatus?.writeEnabled && selectedEvent.editable)
        ? () => {
          if (selectedEvent.recurringEventId) setSeriesChoice(selectedEvent)
          else setEditor({ event: selectedEvent, date: new Date(selectedEvent.start) })
          setSelectedEvent(null)
        } : undefined}>
      <div className={`detail-accent category-${selectedEvent.category}`} style={eventStyle(selectedEvent)}><span>{formatLongDate(new Date(selectedEvent.start))}</span><strong>{selectedEvent.allDay ? 'All day' : `${formatTime(selectedEvent.start)} – ${formatTime(selectedEvent.end)}`}</strong></div>
      <dl className="event-details"><div><dt>Calendar</dt><dd>{selectedEvent.calendarName || categoryNames[selectedEvent.category]}</dd></div>
        {selectedEvent.location && <div><dt>Location</dt><dd>{selectedEvent.location}</dd></div>}
        {selectedEvent.description && <div><dt>Notes</dt><dd>{selectedEvent.source === 'google' && selectedEvent.description.includes('To see detailed information for automatically created events')
          ? <p className="event-description-note">Google provides a short placeholder for this automatically created event. Dayframe can only show the details Google shares here.</p>
          : <EventDescription text={selectedEvent.description} />}</dd></div>}</dl>
      <p className="detail-source">{selectedEvent.source === 'apple' ? 'Read-only event from Apple Calendar.' : selectedEvent.source === 'icloud'
        ? iCloudStatus?.writeEnabled && selectedEvent.editable ? 'Event from private iCloud Calendar.' : 'iCloud event; editing is not available here yet.' : selectedEvent.source === 'google'
        ? selectedEvent.editable && calendarStatus?.writeEnabled ? 'Event from Google Calendar.' : 'For events Dayframe cannot edit, use Google Calendar.'
        : selectedEvent.source === 'local-sample' ? 'Sample event stored on this display.' : 'Event stored on this display.'}</p>
    </AppDialog>}
    {display.keyboardMode === 'dayframe' && <TouchKeyboard />}
  </div>
}
