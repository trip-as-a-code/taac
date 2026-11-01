// Wide screens: once the day strip scrolls away, a month calendar takes its
// place in the margin left of the page, like the mini month beside a calendar
// app's day view. One month at a time, however long the trip: the month of
// the day being read, or another with its arrows. Its days carry their
// place's colour for the people in view, days the filters leave out are dim,
// the day being read is filled, and a tap goes to a day.

import { placesOf, splitBar, type DayStay } from '@/lib/stays'
import { getLens } from '@/scripts/lens'

const POINTER = '(hover: hover)'
const WIDTH = 236
const GAP = 24

interface Day {
  date: string
  chip: HTMLAnchorElement
  hue?: number
  bar?: string
  place: string
}

let cleanup: (() => void) | undefined

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Each trip day from its chip: where its people sleep, in the strip's colours. */
function daysOf(strip: HTMLElement): Day[] {
  const hues = JSON.parse(strip.dataset.hues ?? '{}') as Record<string, number>
  const people = getLens().people
  return [...strip.querySelectorAll<HTMLAnchorElement>('[data-day-link]')].map((chip) => {
    const places = placesOf(
      { date: chip.dataset.dayLink!, bases: JSON.parse(chip.dataset.bases ?? '[]') as DayStay['bases'] },
      people,
    )
    const titles = places.map((p) => p.title)
    return {
      date: chip.dataset.dayLink!,
      chip,
      hue: titles.length === 1 ? hues[titles[0]!] : undefined,
      bar: titles.length > 1 ? splitBar({ titles, who: places.map((p) => p.members), dates: [] }, hues) : undefined,
      place: titles.join(' · '),
    }
  })
}

const arrow = (d: string) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`

/** One month, Monday-first, always six weeks tall so paging never jumps. */
function drawMonth(box: HTMLElement, month: string, days: Map<string, Day>, months: string[], lang: string) {
  const first = new Date(`${month}-01T00:00:00Z`)
  const monthName = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)
  const weekday = new Intl.DateTimeFormat(lang, { weekday: 'narrow', timeZone: 'UTC' })
  const today = ymd(new Date())
  const head = document.createElement('header')
  head.className = 'side-cal-head'
  const title = document.createElement('h3')
  title.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1)
  const at = months.indexOf(month)
  const step = (by: number, path: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'side-cal-step'
    b.innerHTML = arrow(path)
    b.disabled = !months[at + by]
    b.dataset.sideCalStep = String(by)
    return b
  }
  head.append(title, step(-1, 'm15 18-6-6 6-6'), step(1, 'm9 18 6-6-6-6'))
  const grid = document.createElement('div')
  grid.className = 'side-cal-grid'
  // Monday-first: 2024-01-01 was a Monday.
  for (let i = 0; i < 7; i++) {
    const w = document.createElement('span')
    w.className = 'side-cal-weekday'
    w.textContent = weekday.format(new Date(Date.UTC(2024, 0, 1 + i)))
    grid.append(w)
  }
  const lead = (first.getUTCDay() + 6) % 7
  for (let i = 0; i < lead; i++) grid.append(document.createElement('span'))
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1))
  let cells = lead
  for (let d = new Date(first); d < next; d.setUTCDate(d.getUTCDate() + 1), cells++) {
    const date = ymd(d)
    const day = days.get(date)
    const cell = document.createElement(day ? 'button' : 'span')
    cell.className = 'side-cal-day'
    cell.textContent = String(d.getUTCDate())
    cell.toggleAttribute('data-today', date === today)
    if (day) {
      ;(cell as HTMLButtonElement).type = 'button'
      cell.dataset.sideCalDay = date
      cell.toggleAttribute('data-hidden', day.chip.hasAttribute('hidden'))
      if (day.hue !== undefined) cell.style.setProperty('--place-hue', String(day.hue))
      if (day.bar) cell.style.setProperty('--split-bar', day.bar)
      cell.title = day.place
    }
    grid.append(cell)
  }
  for (; cells < 42; cells++) grid.append(document.createElement('span'))
  const place = document.createElement('p')
  place.className = 'side-cal-place'
  place.dataset.sideCalPlace = ''
  box.replaceChildren(head, grid, place)
}

export function setupSideCalendar() {
  cleanup?.()
  const box = document.querySelector<HTMLElement>('[data-side-cal]')
  const strip = document.querySelector<HTMLElement>('[data-day-strip]')
  const content = document.querySelector<HTMLElement>('.trip .content')
  const tabs = document.querySelector<HTMLElement>('.tabs')
  if (!box || !strip || !content) return
  const lang = document.documentElement.lang || 'en'
  let days = new Map<string, Day>()
  let months: string[] = []
  let shown = ''
  let reading = ''
  let stripGone = false
  const draw = () => {
    if (shown) drawMonth(box, shown, days, months, lang)
    mark()
  }
  const redraw = () => {
    const list = daysOf(strip)
    days = new Map(list.map((d) => [d.date, d]))
    months = [...new Set(list.map((d) => d.date.slice(0, 7)))]
    if (!months.includes(shown)) shown = months[0] ?? ''
    draw()
  }
  // Beside the page, as far from its text as the discussions on the other
  // side (the page's own padding), below the sticky bars, where the margin holds it.
  const place = () => {
    const left = content.getBoundingClientRect().left
    const gutter = parseFloat(getComputedStyle(content).paddingLeft) || 0
    const fits = matchMedia(POINTER).matches && left >= WIDTH + gutter
    box.hidden = !fits || !stripGone || !days.size
    box.style.left = `${left - WIDTH}px`
    box.style.top = `${(tabs?.getBoundingClientRect().bottom ?? 0) + GAP}px`
  }
  /** Fills the day being read, if it is in the month shown, and names its place. */
  const mark = () => {
    for (const cell of box.querySelectorAll<HTMLElement>('[data-current]')) cell.removeAttribute('data-current')
    const cell = reading ? box.querySelector<HTMLElement>(`[data-side-cal-day="${reading}"]`) : null
    cell?.setAttribute('data-current', '')
    const label = box.querySelector<HTMLElement>('[data-side-cal-place]')
    if (label) label.textContent = days.get(reading)?.place ?? ''
  }
  // The day being read: the last one whose heading is in the top third of the
  // view. Its month comes into the calendar, and the strip hears of it.
  const spy = () => {
    const top = tabs?.getBoundingClientRect().bottom ?? 0
    const line = top + (innerHeight - top) / 3
    let current = ''
    for (const section of document.querySelectorAll<HTMLElement>('[data-day-section]')) {
      if (section.hidden) continue
      if (section.getBoundingClientRect().top > line) break
      current = section.id
    }
    if (!current || current === reading) return
    const turned = current.slice(0, 7) !== reading.slice(0, 7)
    reading = current
    document.dispatchEvent(new CustomEvent('day-in-view', { detail: current }))
    if (turned && months.includes(current.slice(0, 7))) {
      shown = current.slice(0, 7)
      draw()
    } else mark()
  }
  box.onclick = (event) => {
    const target = event.target as Element
    const step = target.closest<HTMLElement>('[data-side-cal-step]')
    if (step) {
      shown = months[months.indexOf(shown) + Number(step.dataset.sideCalStep)] ?? shown
      return draw()
    }
    const day = target.closest<HTMLElement>('[data-side-cal-day]')
    if (day) days.get(day.dataset.sideCalDay!)?.chip.click()
  }
  let frame = 0
  const onScroll = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(spy)
  }
  const seen = new IntersectionObserver(
    ([entry]) => {
      stripGone = !entry!.isIntersecting
      place()
    },
    { rootMargin: `-${(tabs?.getBoundingClientRect().bottom ?? 0) + 8}px 0px 0px 0px` },
  )
  seen.observe(strip)
  // The strip regroups for the lens or a month, and hides days the filters leave out.
  const changes = new MutationObserver(redraw)
  changes.observe(strip, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', place)
  redraw()
  spy()
  place()
  cleanup = () => {
    seen.disconnect()
    changes.disconnect()
    removeEventListener('scroll', onScroll)
    removeEventListener('resize', place)
  }
}
