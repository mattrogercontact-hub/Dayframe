import assert from 'node:assert/strict'
import test from 'node:test'
import { addDays, currentOrNext, dateRange, eventsOn, layoutDayEvents, monthGrid, seedEvents, startOfWeek, WEEK_HOUR_HEIGHT } from '../src/calendar.ts'

test('weeks begin on Sunday even across a month boundary', () => {
  assert.equal(startOfWeek(new Date(2026, 9, 20)).toDateString(), new Date(2026, 9, 18).toDateString())
  assert.equal(startOfWeek(new Date(2026, 10, 1)).toDateString(), new Date(2026, 10, 1).toDateString())
})

test('month grid includes Sunday through Saturday, including overflow days', () => {
  const grid = monthGrid(new Date(2026, 9, 20))
  assert.equal(grid[0].getDay(), 0)
  assert.equal(grid.at(-1)?.getDay(), 6)
  assert.equal(grid[0].toDateString(), new Date(2026, 8, 27).toDateString())
  assert.equal(grid.length % 7, 0)
})

test('seed events stay on their first local day and are chronologically sorted', () => {
  const date = new Date(2026, 9, 20)
  const events = seedEvents(date)
  assert.equal(eventsOn(events, date).length, 5)
  assert.equal(eventsOn(events, addDays(date, 1)).length, 0)
  assert.equal(eventsOn(events, date)[0].title, 'Team meeting')
  assert.equal(eventsOn(events, date).at(-1)?.title, 'Movie night')
  assert.equal(events[0].title, 'Slow Sunday')
  assert.ok(events.every((event, index) => index === 0 || events[index - 1].start <= event.start))
})

test('week placement follows time and puts overlaps in separate columns', () => {
  const events = seedEvents(new Date(2026, 9, 20))
  const today = layoutDayEvents(eventsOn(events, new Date(2026, 9, 20)))
  assert.ok(today.find(item => item.event.id === 'sample-lunch')!.top > today.find(item => item.event.id === 'sample-team')!.top)
  assert.ok(today.find(item => item.event.id === 'sample-movie')!.height > today.find(item => item.event.id === 'sample-team')!.height)
  const thursday = layoutDayEvents(eventsOn(events, new Date(2026, 9, 22)))
  assert.equal(thursday.find(item => item.event.id === 'sample-check-in')?.columns, 2)
  assert.notEqual(thursday.find(item => item.event.id === 'sample-check-in')?.column, thursday.find(item => item.event.id === 'sample-library')?.column)
  assert.equal(thursday.find(item => item.event.id === 'sample-project')?.columns, 1)
})

test('events spanning midnight appear on both days and clip to the visible day', () => {
  const event = { id: 'overnight', title: 'Travel', start: new Date(2026, 9, 20, 23, 0).toISOString(),
    end: new Date(2026, 9, 21, 2, 0).toISOString(), category: 'family' as const, source: 'google' as const }
  const nextDay = new Date(2026, 9, 21)
  assert.equal(eventsOn([event], nextDay).length, 1)
  const placement = layoutDayEvents([event], nextDay)[0]
  assert.equal(placement.top, 0)
  assert.equal(placement.height, 2 * WEEK_HOUR_HEIGHT)
})

test('current or next event ignores finished events', () => {
  const events = seedEvents(new Date(2026, 9, 20))
  assert.equal(currentOrNext(events, new Date(2026, 9, 20, 12, 30))?.title, 'Lunch with Alex')
  assert.equal(currentOrNext(events, new Date(2026, 9, 20, 23, 0)), undefined)
})

test('week and month ranges are Sunday first', () => {
  const today = new Date(2026, 9, 20)
  for (const face of ['week', 'month'] as const) {
    const [start, end] = dateRange(face, today)
    assert.equal(start.getDay(), 0)
    assert.equal(end.getDay(), 0)
    assert.ok(end > start)
  }
})
