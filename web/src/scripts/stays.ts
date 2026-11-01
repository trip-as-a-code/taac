// The itinerary's day strip, grouped by where the lens's people sleep: each
// run of days in one place under its name, which jumps to the first of them.
// Rebuilt from the day chips when the lens changes.

import { placeHue, stayRuns, type DayStay } from '@/lib/stays'

function stayElement(titles: string[], first: string, jump: string): HTMLElement {
  const stay = document.createElement('div')
  stay.className = 'stay'
  stay.dataset.stay = ''
  if (!titles.length) {
    stay.dataset.transit = ''
    return stay
  }
  if (titles.length === 1) stay.style.setProperty('--place-hue', String(placeHue(titles[0]!)))
  else stay.dataset.split = ''
  const label = document.createElement('a')
  label.className = 'stay-label'
  label.href = `#${first}`
  label.title = jump.replace('{place}', titles.join(' · '))
  label.textContent = titles.join(' · ')
  stay.append(label)
  return stay
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
    const stay = stayElement(run.titles, run.dates[0]!, jump)
    const row = document.createElement('div')
    row.className = 'stay-days'
    for (const date of run.dates) {
      // A month's marker goes before its first day.
      const month = months.get(date)
      if (month) row.append(month)
      row.append(byDate.get(date)!)
    }
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
