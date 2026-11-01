// The itinerary's day strip, grouped by where the lens's people sleep: each
// run of days in one place under its name, which jumps to the first of them.
// Rebuilt from the day chips when the lens changes.

import { placeHue, stayRuns, type DayStay, type StayRun } from '@/lib/stays'

function stayElement(run: StayRun): HTMLElement {
  const stay = document.createElement('div')
  stay.className = 'stay'
  stay.dataset.stay = ''
  if (run.transit || !run.titles.length) stay.dataset.transit = ''
  else if (run.titles.length === 1) stay.style.setProperty('--place-hue', String(placeHue(run.titles[0]!)))
  else stay.dataset.split = ''
  return stay
}

/** The place's name, kept with its first day so it never ends a row alone. */
function leadElement(titles: string[], first: string, jump: string): HTMLElement {
  const lead = document.createElement('span')
  lead.className = 'stay-lead'
  lead.dataset.stayLead = ''
  const label = document.createElement('a')
  label.className = 'stay-label'
  label.href = `#${first}`
  label.title = jump.replace('{place}', titles.join(' · '))
  label.textContent = titles.join(' · ')
  lead.append(label)
  return lead
}

/** Regroups the strip's chips for `people` (everyone when empty). */
export function groupStrip(strip: HTMLElement, people: string[]) {
  const chips = [...strip.querySelectorAll<HTMLElement>('[data-day-link]')]
  const months = new Map<string, HTMLElement>()
  for (const month of strip.querySelectorAll<HTMLElement>('[data-month]')) months.set(month.dataset.month!, month)
  const days: DayStay[] = chips.map((chip) => ({
    date: chip.dataset.dayLink!,
    bases: JSON.parse(chip.dataset.bases ?? '[]') as DayStay['bases'],
  }))
  const byDate = new Map(chips.map((chip) => [chip.dataset.dayLink!, chip]))
  const jump = strip.dataset.jump ?? '{place}'
  const groups = stayRuns(days, people).map((run) => {
    const stay = stayElement(run)
    const row = document.createElement('div')
    row.className = 'stay-days'
    run.dates.forEach((date, i) => {
      const month = months.get(date)
      // A place's name, or a month's marker, wraps with the day after it.
      let into: HTMLElement = row
      if (i === 0 && run.titles.length) into = leadElement(run.titles, date, jump)
      else if (month) {
        into = document.createElement('span')
        into.className = 'stay-lead'
      }
      if (into !== row) row.append(into)
      // The month comes first, before the place's name.
      if (month) into.prepend(month)
      into.append(byDate.get(date)!)
    })
    stay.append(row)
    return stay
  })
  strip.replaceChildren(...groups)
}

/** A group whose days the filters all hid goes too. */
export function hideEmptyStays(strip: HTMLElement) {
  for (const stay of strip.querySelectorAll<HTMLElement>('[data-stay]'))
    stay.hidden = !stay.querySelector('[data-day-link]:not([hidden])')
}
