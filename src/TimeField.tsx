import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

const itemHeight = 48
const hours = Array.from({ length: 12 }, (_, index) => index + 1)
const minutes = Array.from({ length: 60 }, (_, index) => index)
const periods = ['AM', 'PM'] as const

function parts(value: string) {
  const [hour = 0, minute = 0] = value.split(':').map(Number)
  return { hour: hour % 12 || 12, minute, period: hour >= 12 ? 'PM' : 'AM' as 'AM' | 'PM' }
}

function timeValue(hour: number, minute: number, period: 'AM' | 'PM') {
  const hour24 = hour % 12 + (period === 'PM' ? 12 : 0)
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const hourWheel = useRef<HTMLDivElement>(null)
  const minuteWheel = useRef<HTMLDivElement>(null)
  const periodWheel = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selected = parts(value)

  useLayoutEffect(() => {
    if (!open) return
    if (hourWheel.current) hourWheel.current.scrollTop = (selected.hour - 1) * itemHeight
    if (minuteWheel.current) minuteWheel.current.scrollTop = selected.minute * itemHeight
    if (periodWheel.current) periodWheel.current.scrollTop = (selected.period === 'PM' ? 1 : 0) * itemHeight
    const container = root.current?.closest('.dialog-inner')
    if (container && picker.current) {
      const overflow = picker.current.getBoundingClientRect().bottom - container.getBoundingClientRect().bottom + 16
      if (overflow > 0) container.scrollBy({ top: overflow })
    }
  // Position the wheels when the panel first opens. Scrolling them updates value without resetting their position.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  function choose(part: 'hour' | 'minute' | 'period', next: number | 'AM' | 'PM') {
    const hour = part === 'hour' ? Number(next) : selected.hour
    const minute = part === 'minute' ? Number(next) : selected.minute
    const period = part === 'period' ? next as 'AM' | 'PM' : selected.period
    const updated = timeValue(hour, minute, period)
    if (updated !== value) onChange(updated)
  }

  function wheel(kind: 'hour' | 'minute' | 'period', options: readonly (number | 'AM' | 'PM')[], selectedIndex: number,
    reference: React.RefObject<HTMLDivElement | null>) {
    return <div className="time-wheel" ref={reference} role="group" aria-label={kind === 'hour' ? 'Hour' : kind === 'minute' ? 'Minute' : 'AM or PM'}
      onScroll={event => {
        const index = Math.max(0, Math.min(options.length - 1, Math.round(event.currentTarget.scrollTop / itemHeight)))
        if (index !== selectedIndex) choose(kind, options[index])
      }}>
      {options.map((option, index) => <button type="button" key={option} className={index === selectedIndex ? 'selected' : ''}
        aria-pressed={index === selectedIndex} onClick={() => {
          choose(kind, option)
          reference.current?.scrollTo({ top: index * itemHeight, behavior: 'auto' })
        }}>{kind === 'minute' ? String(option).padStart(2, '0') : option}</button>)}
    </div>
  }

  return <div className="time-field" ref={root}>
    <label htmlFor={id}>{label}</label>
    <div className="time-field-control"><input id={id} required type="time" value={value} onChange={event => onChange(event.target.value)}
      aria-haspopup="true" aria-expanded={open}
      onPointerDown={event => {
        event.preventDefault()
        if (event.pointerType === 'mouse') event.currentTarget.focus()
        setOpen(true)
      }}
      onClick={() => setOpen(true)} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(true) }
      }} />
      <button type="button" className="time-field-open" aria-label="Open time picker" aria-expanded={open}
        onClick={() => setOpen(value => !value)}>▾</button></div>
    {open && <div className="time-picker" ref={picker} role="group" aria-label={`${label} picker`}>
      <div className="time-picker-wheels">
        {wheel('hour', hours, selected.hour - 1, hourWheel)}
        <span className="time-picker-colon" aria-hidden="true">:</span>
        {wheel('minute', minutes, selected.minute, minuteWheel)}
        {wheel('period', periods, selected.period === 'PM' ? 1 : 0, periodWheel)}
      </div>
      <button type="button" className="time-picker-done" onClick={() => setOpen(false)}>Done</button>
    </div>}
  </div>
}
