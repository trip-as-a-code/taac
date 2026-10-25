// Page filtering: the trip-wide people lens plus the page's own facets
// (`[data-filters]`, see FilterBar). Elements opt in with `data-people` and
// `data-facts` (lib/facts.ts); day sections and empty states follow. Facets
// live in the URL, so a filtered view is a link.

import type { Facts } from '@/lib/facts'
import { fold, issueGroup } from '@/lib/facts'
import { getLens, inLens, onLens, peopleOf, setLens, type Lens } from '@/scripts/lens'

/** Several values match any of them; single ones replace each other. */
const MULTI = ['issue', 'status', 'kind', 'priority', 'payer', 'place', 'tag'] as const
const SINGLE = ['focus', 'when', 'due', 'conflict', 'cost'] as const
export const FACETS = [...SINGLE, ...MULTI] as const
export type Facet = (typeof FACETS)[number]

export interface FilterState {
  lens: Lens
  values: Partial<Record<Facet, string[]>>
  /** Folded search words; all must appear. */
  q: string
}

type Listener = (state: FilterState) => void

let cleanup: (() => void) | undefined
let listeners: AbortController | undefined

function addDays(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

/** Today where the trip happens, so "today" means the same thing on the road. */
export function tripToday(timezone = document.querySelector<HTMLElement>('[data-timezone]')?.dataset.timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

const test: Record<Facet, (f: Facts, values: string[], today: string) => boolean> = {
  status: (f, v) => Boolean(f.status && v.includes(f.status)),
  kind: (f, v) => v.includes(f.kind),
  priority: (f, v) => Boolean(f.priority && v.includes(f.priority)),
  payer: (f, v) => f.payers.some((p) => v.includes(p)),
  place: (f, v) => f.places.some((p) => v.includes(p)),
  tag: (f, v) => f.tags.some((t) => v.includes(t)),
  issue: (f, v) => f.issues.some((code) => v.includes('any') || v.includes(issueGroup(code))),
  // Anything the validator flagged, or a booking due within a week (or late).
  focus: (f, _, today) =>
    f.issues.length > 0 ||
    f.conflict === 'open' ||
    (f.status === 'required' && Boolean(f.deadline && f.deadline <= addDays(today, 7))),
  when: (f, [v], today) => {
    if (!f.day) return false
    const end = f.end ?? f.day
    if (v === 'today') return f.day <= today && today <= end
    if (v === 'soon') return end >= today && f.day <= addDays(today, 2)
    if (v === 'upcoming') return end >= today
    return end < today
  },
  due: (f, [v], today) => {
    if (f.status !== 'required') return false
    if (v === 'none') return !f.deadline
    if (!f.deadline) return false
    return v === 'overdue' ? f.deadline < today : f.deadline >= today && f.deadline <= addDays(today, 7)
  },
  conflict: (f, [v]) => (v === 'any' ? Boolean(f.conflict) : f.conflict === v),
  cost: (f, [v]) => (v === 'priced' ? f.priced : v === 'topay' ? f.toPay : !f.priced),
}

/** Whether anything beyond the people lens narrows the page. */
export function faceted(state: FilterState): boolean {
  return Boolean(state.q) || FACETS.some((k) => state.values[k]?.length)
}

export function matchesFacts(facts: Facts | undefined, people: string[], state: FilterState, today = tripToday()) {
  if (!inLens(people, state.lens, facts?.unassigned)) return false
  if (!faceted(state)) return true
  if (!facts) return false
  for (const key of FACETS) {
    const values = state.values[key]
    if (values?.length && !test[key](facts, values, today)) return false
  }
  return state.q.split(/\s+/).every((word) => facts.text.includes(word))
}

const parsed = new WeakMap<HTMLElement, Facts | undefined>()

function factsOf(el: HTMLElement): Facts | undefined {
  if (!parsed.has(el)) parsed.set(el, el.dataset.facts ? (JSON.parse(el.dataset.facts) as Facts) : undefined)
  return parsed.get(el)
}

export function matches(el: HTMLElement, state: FilterState, today = tripToday()): boolean {
  return matchesFacts(factsOf(el), peopleOf(el), state, today)
}

function readUrl(): Pick<FilterState, 'values' | 'q'> {
  const params = new URLSearchParams(location.search)
  const values: FilterState['values'] = {}
  for (const key of FACETS) {
    const raw = params.get(key)
    if (raw) values[key] = SINGLE.includes(key as never) ? [raw] : raw.split(',').filter(Boolean)
  }
  return { values, q: fold(params.get('q') ?? '').trim() }
}

function writeUrl(state: FilterState, query: string) {
  const url = new URL(location.href)
  for (const key of FACETS) {
    const values = state.values[key]
    if (values?.length) url.searchParams.set(key, values.join(','))
    else url.searchParams.delete(key)
  }
  if (query.trim()) url.searchParams.set('q', query.trim())
  else url.searchParams.delete('q')
  history.replaceState(history.state, '', url)
}

export function setupFilters(onChange?: Listener): FilterState {
  cleanup?.()
  // A second setup on the same page replaces the first; stacked click
  // handlers would toggle twice and cancel out.
  listeners?.abort()
  listeners = new AbortController()
  const { signal } = listeners
  const state: FilterState = { lens: getLens(), ...readUrl() }
  const bar = document.querySelector<HTMLElement>('[data-filters]')
  const search = bar?.querySelector<HTMLInputElement>('[data-filter-q]')
  const panel = bar?.querySelector<HTMLElement>('[data-filter-panel]')
  const toggle = bar?.querySelector<HTMLButtonElement>('[data-filter-toggle]')
  if (search) search.value = new URLSearchParams(location.search).get('q') ?? ''

  const label = (key: Facet, value: string) =>
    bar?.querySelector<HTMLElement>(`[data-facet="${key}"][data-value="${CSS.escape(value)}"]`)?.dataset.label ??
    bar?.querySelector<HTMLOptionElement>(`[data-facet="${key}"] option[value="${CSS.escape(value)}"]`)?.text ??
    value

  const render = () => {
    if (bar) {
      for (const button of bar.querySelectorAll<HTMLButtonElement>('button[data-facet]')) {
        const on = state.values[button.dataset.facet as Facet]?.includes(button.dataset.value!) ?? false
        button.setAttribute('aria-pressed', String(on))
      }
      for (const select of bar.querySelectorAll<HTMLSelectElement>('select[data-facet]'))
        select.value = state.values[select.dataset.facet as Facet]?.[0] ?? ''
      const chips = bar.querySelector<HTMLElement>('[data-filter-chips]')
      const template = bar.querySelector<HTMLTemplateElement>('[data-filter-chip]')
      if (chips && template) {
        chips.replaceChildren()
        for (const key of FACETS)
          for (const value of state.values[key] ?? []) {
            const chip = template.content.firstElementChild!.cloneNode(true) as HTMLButtonElement
            chip.dataset.removeFacet = key
            chip.dataset.removeValue = value
            chip.querySelector('[data-text]')!.textContent = label(key, value)
            chips.append(chip)
          }
      }
      const active = FACETS.reduce((n, k) => n + (state.values[k]?.length ?? 0), 0)
      const badge = bar.querySelector<HTMLElement>('[data-filter-badge]')
      if (badge) {
        badge.textContent = String(active)
        badge.hidden = active === 0
      }
      bar.querySelector<HTMLElement>('[data-filter-active]')?.toggleAttribute('hidden', !faceted(state))
    }
    applyFilters(state)
    onChange?.(state)
  }

  const set = (key: Facet, value: string) => {
    const current = state.values[key] ?? []
    if (SINGLE.includes(key as never)) state.values[key] = current[0] === value || !value ? [] : [value]
    else state.values[key] = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    writeUrl(state, search?.value ?? '')
    render()
  }

  bar?.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element
      const facet = target.closest<HTMLButtonElement>('button[data-facet]')
      const chip = target.closest<HTMLButtonElement>('[data-remove-facet]')
      if (facet) set(facet.dataset.facet as Facet, facet.dataset.value!)
      else if (chip) set(chip.dataset.removeFacet as Facet, chip.dataset.removeValue!)
      else if (target.closest('[data-filter-clear]')) {
        state.values = {}
        state.q = ''
        if (search) search.value = ''
        writeUrl(state, '')
        render()
      } else if (target.closest('[data-filter-toggle]') && panel && toggle) {
        panel.hidden = !panel.hidden
        toggle.setAttribute('aria-expanded', String(!panel.hidden))
      }
    },
    { signal },
  )
  bar?.addEventListener(
    'change',
    (event) => {
      const select = (event.target as Element).closest<HTMLSelectElement>('select[data-facet]')
      if (!select) return
      const key = select.dataset.facet as Facet
      state.values[key] = select.value ? [select.value] : []
      writeUrl(state, search?.value ?? '')
      render()
    },
    { signal },
  )
  let typing: ReturnType<typeof setTimeout> | undefined
  search?.addEventListener(
    'input',
    () => {
      clearTimeout(typing)
      typing = setTimeout(() => {
        state.q = fold(search.value).trim()
        writeUrl(state, search.value)
        render()
      }, 120)
    },
    { signal },
  )

  cleanup = onLens((lens) => {
    state.lens = lens
    render()
  })
  render()
  return state
}

export function showCount(shown: number, total: number) {
  const count = document.querySelector<HTMLElement>('[data-filter-count]')
  if (count?.dataset.template)
    count.textContent = count.dataset.template.replace('{shown}', String(shown)).replace('{total}', String(total))
}

export function applyFilters(state: FilterState) {
  const today = tripToday()
  let visible = 0
  let total = 0
  for (const el of document.querySelectorAll<HTMLElement>('[data-item]')) {
    const show = matches(el, state, today)
    el.hidden = !show
    total++
    if (show) visible++
  }
  const narrowed = faceted(state)
  // Where people are and what holds them only says something when no facet
  // narrows the plans.
  for (const el of document.querySelectorAll<HTMLElement>('[data-presence]')) {
    el.hidden = narrowed || Boolean(state.lens.unassigned) || !inLens(peopleOf(el), state.lens)
  }
  // A clash matters if it affects anyone in view, whatever the mode.
  for (const el of document.querySelectorAll<HTMLElement>('[data-conflict]')) {
    el.hidden = !state.lens.unassigned && !inLens(peopleOf(el), { ...state.lens, mode: 'any' })
  }
  const filtered = Boolean(state.lens.people.length || state.lens.unassigned) || narrowed
  for (const section of document.querySelectorAll<HTMLElement>('[data-day-section]')) {
    const items = section.querySelector('[data-item]:not([hidden])')
    const here = section.querySelector('[data-presence]:not([hidden])')
    section.hidden = filtered && !items && !here
  }
  if (total) showCount(visible, total)
  document.querySelector<HTMLElement>('[data-filter-empty]')?.toggleAttribute('hidden', visible > 0)
  document.dispatchEvent(new CustomEvent('taac:filtered'))
}

/**
 * A link to one card (`#item-…`, `#packing-…`, from the budget) shows it even
 * when the people lens hid it, opens it and brings it into view.
 */
export function revealTarget() {
  const id = decodeURIComponent(location.hash.slice(1))
  const el = id ? document.getElementById(id) : null
  if (!el?.hasAttribute('data-item')) return
  if (el.hidden || el.closest('[hidden]')) {
    const facts = el.dataset.facts ? (JSON.parse(el.dataset.facts) as Facts) : undefined
    setLens({ people: [], unassigned: Boolean(facts?.unassigned) })
  }
  el.querySelector('details')?.setAttribute('open', '')
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
  requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }))
}
