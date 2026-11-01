// Where the trip sleeps, day by day, as runs of days in one place: the
// itinerary's day strip groups its days by them. Shared by the build and the
// page, which regroups when the people lens changes.

export interface DayStay {
  date: string
  /** Each base that night: its title and who sleeps there. */
  bases: { title: string; members: string[] }[]
}

export interface StayRun {
  /** The places, most people first; empty for nights in transit. */
  titles: string[]
  dates: string[]
}

/** The places `people` (everyone when empty) sleep in that night. */
export function placesOf(day: DayStay, people: string[]): string[] {
  const seen = new Map<string, number>()
  for (const base of day.bases) {
    const who = people.length ? base.members.filter((m) => people.includes(m)) : base.members
    if (who.length) seen.set(base.title, (seen.get(base.title) ?? 0) + who.length)
  }
  return [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([title]) => title)
}

/** Consecutive days with the same places, in order. */
export function stayRuns(days: DayStay[], people: string[]): StayRun[] {
  const runs: StayRun[] = []
  for (const day of days) {
    const titles = placesOf(day, people)
    const last = runs.at(-1)
    if (last && last.titles.join('\u0000') === titles.join('\u0000')) last.dates.push(day.date)
    else runs.push({ titles, dates: [day.date] })
  }
  return runs
}

/** A steady hue per place, so a city keeps its colour wherever it shows. */
export function placeHue(title: string): number {
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}
