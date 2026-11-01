// The itinerary's day strip, grouped by where the lens's people sleep: each
// run of days in one place under its name, which jumps to the first of them.
// Rebuilt from the day chips when the lens changes.

import { placeHue, splitBar, stayRuns, stayTitle, type DayStay, type StayRun } from '@/lib/stays'
import { avatarPhoto } from '@/scripts/avatars'

type People = Record<string, { name: string; initials: string; hue: number; github?: string }>

function stayElement(run: StayRun): HTMLElement {
  const stay = document.createElement('div')
  stay.className = 'stay'
  stay.dataset.stay = ''
  if (!run.titles.length) stay.dataset.transit = ''
  else if (run.titles.length === 1) stay.style.setProperty('--place-hue', String(placeHue(run.titles[0]!)))
  else {
    stay.dataset.split = ''
    stay.style.setProperty('--split-bar', splitBar(run))
  }
  return stay
}

/** A member's avatar, as the page's Avatar component draws it. */
function avatar(id: string, people: People): HTMLElement {
  const person = people[id]
  const span = document.createElement('span')
  span.className = 'avatar'
  span.title = person?.name ?? id
  span.style.setProperty('--hue', String(person?.hue ?? 210))
  span.textContent = person?.initials ?? id.slice(0, 1).toUpperCase()
  if (person?.github) span.append(avatarPhoto(person.github.toLowerCase()))
  return span
}

/** The place's name, kept with its first day so it never ends a row alone. */
function leadElement(run: StayRun, jump: string, people: People): HTMLElement {
  const lead = document.createElement('span')
  lead.className = 'stay-lead'
  lead.dataset.stayLead = ''
  const label = document.createElement('a')
  label.className = 'stay-label'
  label.href = `#${run.dates[0]}`
  label.title = jump.replace(
    '{place}',
    stayTitle(run, (id) => people[id]?.name ?? id),
  )
  if (run.titles.length > 1)
    // Who is where: each place in its colour, after its people.
    run.titles.forEach((title, k) => {
      const place = document.createElement('span')
      place.className = 'stay-place'
      place.style.setProperty('--place-hue', String(placeHue(title)))
      const avatars = document.createElement('span')
      avatars.className = 'avatars'
      const who = run.who[k]!
      avatars.append(...who.slice(0, 3).map((id) => avatar(id, people)))
      if (who.length > 3) {
        const more = document.createElement('span')
        more.className = 'avatar more'
        more.textContent = `+${who.length - 3}`
        avatars.append(more)
      }
      const name = document.createElement('span')
      name.className = 'stay-name'
      name.textContent = title
      place.append(avatars, name)
      label.append(place)
    })
  else label.textContent = run.titles[0]!
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
  const everyone = JSON.parse(strip.dataset.people ?? '{}') as People
  const groups = stayRuns(days, people).map((run) => {
    const stay = stayElement(run)
    const row = document.createElement('div')
    row.className = 'stay-days'
    run.dates.forEach((date, i) => {
      const month = months.get(date)
      // A place's name, or a month's marker, wraps with the day after it.
      let into: HTMLElement = row
      if (i === 0 && run.titles.length) into = leadElement(run, jump, everyone)
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
