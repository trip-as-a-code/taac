// Side-by-side lanes for days when the travellers split up. Wide screens
// only: each party gets a column (a group with nothing planned gets one for
// its free day), shared plans span all of them, and rows pack in
// chronological order. Narrow screens keep the single column, where
// every item already carries its party pill and rail.

export interface PartyInfo {
  label: string
  hue: number
}

const WIDE = '(min-width: 980px)'

export function layoutLanes(parties: Record<string, PartyInfo>) {
  const wide = window.matchMedia(WIDE).matches
  const order = Object.keys(parties)
  const rank = (party: string) => (order.includes(party) ? order.indexOf(party) : order.length)
  for (const container of document.querySelectorAll<HTMLElement>('[data-lanes]')) {
    reset(container)
    if (!wide) continue
    // A group's free day (`data-free`) heads its lane, above nothing else.
    const wraps = [...container.querySelectorAll<HTMLElement>(':scope > [data-party]')]
      .filter((wrap) => !wrap.querySelector('[data-item][hidden], [data-presence][hidden]'))
      .sort((a, b) => Number(b.hasAttribute('data-free')) - Number(a.hasAttribute('data-free')))
    // Lanes follow the trip's party order, so a group keeps its side every day.
    const lanes = [...new Set(wraps.map((w) => w.dataset.party!).filter((p) => p !== 'everyone'))].sort(
      (a, b) => rank(a) - rank(b),
    )
    if (lanes.length < 2) continue

    container.classList.add('laned')
    container.style.gridTemplateColumns = `repeat(${lanes.length}, minmax(0, 1fr))`
    lanes.forEach((party, index) => {
      const head = document.createElement('div')
      head.className = 'lane-head footnote'
      head.dataset.laneHead = ''
      head.style.gridArea = `1 / ${index + 1}`
      head.style.setProperty('--party-hue', String(parties[party]?.hue ?? 210))
      head.textContent = parties[party]?.label ?? party
      container.prepend(head)
    })

    let row = 2
    let used = new Set<number>()
    let spanned = false
    const next = () => {
      row++
      used = new Set()
      spanned = false
    }
    for (const wrap of wraps) {
      const lane = lanes.indexOf(wrap.dataset.party!)
      if (lane < 0) {
        if (used.size || spanned) next()
        wrap.style.gridArea = `${row} / 1 / ${row + 1} / -1`
        spanned = true
        next()
        continue
      }
      if (spanned || used.has(lane)) next()
      wrap.style.gridArea = `${row} / ${lane + 1}`
      used.add(lane)
    }
  }
}

function reset(container: HTMLElement) {
  container.classList.remove('laned')
  container.style.gridTemplateColumns = ''
  for (const head of container.querySelectorAll('[data-lane-head]')) head.remove()
  for (const wrap of container.querySelectorAll<HTMLElement>(':scope > [data-party]')) wrap.style.gridArea = ''
}

let media: MediaQueryList | undefined

/** Lays lanes out now, after every filter change, and on resize across the breakpoint. */
export function setupLanes(parties: Record<string, PartyInfo>) {
  const run = () => layoutLanes(parties)
  document.addEventListener('taac:filtered', run)
  media?.removeEventListener('change', run)
  media = window.matchMedia(WIDE)
  media.addEventListener('change', run)
  run()
  return () => {
    document.removeEventListener('taac:filtered', run)
    media?.removeEventListener('change', run)
  }
}
