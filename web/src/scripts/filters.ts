// Page filtering: the trip-wide people lens plus an optional per-page status
// filter (`[data-filters]`). Elements opt in with `data-people` and
// `data-status`; day sections and empty states follow.

import { getLens, inLens, onLens, peopleOf, type Lens } from '@/scripts/lens'

export interface FilterState {
  lens: Lens
  status: string
}

type Listener = (state: FilterState) => void

let cleanup: (() => void) | undefined

export function setupFilters(onChange?: Listener): FilterState {
  cleanup?.()
  const state: FilterState = { lens: getLens(), status: new URLSearchParams(location.search).get('status') ?? '' }
  const bar = document.querySelector<HTMLElement>('[data-filters]')
  const group = bar?.querySelector<HTMLElement>('[data-filter-group="status"]')

  const render = () => {
    for (const button of group?.querySelectorAll<HTMLButtonElement>('button') ?? []) {
      button.setAttribute('aria-pressed', String(button.dataset.value === state.status))
    }
    applyFilters(state)
    onChange?.(state)
  }

  group?.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button')
    if (!button) return
    state.status = button.dataset.value ?? ''
    const url = new URL(location.href)
    if (state.status) url.searchParams.set('status', state.status)
    else url.searchParams.delete('status')
    history.replaceState(history.state, '', url)
    render()
  })
  cleanup = onLens((lens) => {
    state.lens = lens
    render()
  })
  render()
  return state
}

export function matches(el: HTMLElement, state: FilterState): boolean {
  if (!inLens(peopleOf(el), state.lens)) return false
  if (state.status && el.dataset.status !== state.status) return false
  return true
}

export function applyFilters(state: FilterState) {
  let visible = 0
  for (const el of document.querySelectorAll<HTMLElement>('[data-item]')) {
    const show = matches(el, state)
    el.hidden = !show
    if (show) visible++
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-presence]')) {
    el.hidden = !inLens(peopleOf(el), state.lens)
  }
  // A clash matters if it affects anyone in view, whatever the mode.
  for (const el of document.querySelectorAll<HTMLElement>('[data-conflict]')) {
    el.hidden = !inLens(peopleOf(el), { ...state.lens, mode: 'any' })
  }
  const filtered = Boolean(state.lens.people.length || state.status)
  for (const section of document.querySelectorAll<HTMLElement>('[data-day-section]')) {
    const items = section.querySelector('[data-item]:not([hidden])')
    // Without a status filter, a day where the people are somewhere still counts.
    const here = !state.status && section.querySelector('[data-presence]:not([hidden])')
    section.hidden = filtered && !items && !here
  }
  document.querySelector<HTMLElement>('[data-filter-empty]')?.toggleAttribute('hidden', visible > 0)
  document.dispatchEvent(new CustomEvent('taac:filtered'))
}
