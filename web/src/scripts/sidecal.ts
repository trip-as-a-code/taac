// Wide screens: once the day strip scrolls away, a month calendar takes its
// place in the margin left of the page, like the mini calendar beside a
// calendar app's day view. It is drawn from the strip itself, so it shows the
// same places (each in its colour), the same people and the same filters; the
// day being read is filled, and a tap on a day goes to it.

const POINTER = '(hover: hover)'
const WIDTH = 236
const GAP = 24

interface Day {
  date: string
  chip: HTMLAnchorElement
  /** The place's colour: a hue, or a split stay's bar. */
  hue?: string
  bar?: string
  place: string
}

let cleanup: (() => void) | undefined

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const parse = (date: string) => new Date(`${date}T00:00:00Z`)

/** Where its people sleep: the stay's places, as the strip names them. */
function placeOf(stay: HTMLElement | null): string {
  const names = [...(stay?.querySelectorAll('.stay-name') ?? [])].map((n) => n.textContent ?? '')
  return names.length ? names.join(' · ') : (stay?.querySelector('.stay-label')?.textContent?.trim() ?? '')
}

function daysOf(strip: HTMLElement): Day[] {
  return [...strip.querySelectorAll<HTMLAnchorElement>('[data-day-link]')].map((chip) => {
    const stay = chip.closest<HTMLElement>('[data-stay]')
    return {
      date: chip.dataset.dayLink!,
      chip,
      hue: stay?.style.getPropertyValue('--place-hue') || undefined,
      bar: stay?.style.getPropertyValue('--split-bar') || undefined,
      place: placeOf(stay),
    }
  })
}

/** Every month the trip touches, Monday-first weeks, the trip's days marked. */
function draw(box: HTMLElement, days: Day[], lang: string) {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const first = parse(days[0]!.date)
  const last = parse(days.at(-1)!.date)
  const monthName = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const weekday = new Intl.DateTimeFormat(lang, { weekday: 'narrow', timeZone: 'UTC' })
  const today = ymd(new Date())
  const months: HTMLElement[] = []
  for (let m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)); m <= last;) {
    const month = document.createElement('section')
    month.className = 'side-cal-month'
    const title = document.createElement('h3')
    const name = monthName.format(m)
    title.textContent = name.charAt(0).toUpperCase() + name.slice(1)
    const grid = document.createElement('div')
    grid.className = 'side-cal-grid'
    // Monday-first: 2024-01-01 was a Monday.
    for (let i = 0; i < 7; i++) {
      const head = document.createElement('span')
      head.className = 'side-cal-weekday'
      head.textContent = weekday.format(new Date(Date.UTC(2024, 0, 1 + i)))
      grid.append(head)
    }
    const lead = (m.getUTCDay() + 6) % 7
    for (let i = 0; i < lead; i++) grid.append(document.createElement('span'))
    const next = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))
    for (let d = new Date(m); d < next; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = ymd(d)
      const day = byDate.get(date)
      const cell = document.createElement(day ? 'button' : 'span')
      cell.className = 'side-cal-day'
      cell.textContent = String(d.getUTCDate())
      cell.toggleAttribute('data-today', date === today)
      if (day) {
        ;(cell as HTMLButtonElement).type = 'button'
        cell.dataset.sideCalDay = date
        cell.toggleAttribute('data-hidden', day.chip.hasAttribute('hidden'))
        if (day.hue) cell.style.setProperty('--place-hue', day.hue)
        if (day.bar) cell.style.setProperty('--split-bar', day.bar)
        cell.title = day.place
        cell.addEventListener('click', () => day.chip.click())
      }
      grid.append(cell)
    }
    month.append(title, grid)
    months.push(month)
    m = next
  }
  const place = document.createElement('p')
  place.className = 'side-cal-place'
  place.dataset.sideCalPlace = ''
  box.replaceChildren(...months, place)
}

export function setupSideCalendar() {
  cleanup?.()
  const box = document.querySelector<HTMLElement>('[data-side-cal]')
  const strip = document.querySelector<HTMLElement>('[data-day-strip]')
  const content = document.querySelector<HTMLElement>('.trip .content')
  const tabs = document.querySelector<HTMLElement>('.tabs')
  if (!box || !strip || !content) return
  const lang = document.documentElement.lang || 'en'
  let days: Day[] = []
  let stripGone = false
  const redraw = () => {
    days = daysOf(strip)
    if (days.length) draw(box, days, lang)
    place()
    spy()
  }
  // Beside the page, as far from its text as the discussions on the other
  // side (the page's own padding), below the sticky bars, where the margin holds it.
  const place = () => {
    const left = content.getBoundingClientRect().left
    const gutter = parseFloat(getComputedStyle(content).paddingLeft) || 0
    const fits = matchMedia(POINTER).matches && left >= WIDTH + gutter
    box.hidden = !fits || !stripGone || !days.length
    box.style.left = `${left - WIDTH}px`
    box.style.top = `${(tabs?.getBoundingClientRect().bottom ?? 0) + GAP}px`
  }
  // The day being read: the last one whose heading is in the top third of the view.
  const spy = () => {
    if (box.hidden) return
    const top = tabs?.getBoundingClientRect().bottom ?? 0
    const line = top + (innerHeight - top) / 3
    let current: string | undefined
    for (const section of document.querySelectorAll<HTMLElement>('[data-day-section]')) {
      if (section.hidden) continue
      if (section.getBoundingClientRect().top > line) break
      current = section.id
    }
    for (const cell of box.querySelectorAll<HTMLElement>('[data-current]')) cell.removeAttribute('data-current')
    const cell = current ? box.querySelector<HTMLElement>(`[data-side-cal-day="${current}"]`) : null
    cell?.setAttribute('data-current', '')
    const label = box.querySelector<HTMLElement>('[data-side-cal-place]')
    if (label) label.textContent = cell?.title ?? ''
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
      spy()
    },
    { rootMargin: `-${(tabs?.getBoundingClientRect().bottom ?? 0) + 8}px 0px 0px 0px` },
  )
  seen.observe(strip)
  // The strip regroups for the lens and hides days the filters leave out.
  const changes = new MutationObserver(redraw)
  changes.observe(strip, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] })
  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', place)
  redraw()
  cleanup = () => {
    seen.disconnect()
    changes.disconnect()
    removeEventListener('scroll', onScroll)
    removeEventListener('resize', place)
  }
}
