// Client-side filtering by participant and booking status. State lives in
// the URL (shareable) and the participant choice is remembered per trip.

export interface FilterState {
  who: string
  status: string
}

type Listener = (state: FilterState) => void

export function setupFilters(onChange?: Listener): FilterState | undefined {
  const bar = document.querySelector<HTMLElement>('[data-filters]')
  if (!bar) return
  const key = `taac:who:${bar.dataset.trip}`
  const params = new URLSearchParams(location.search)
  const state: FilterState = {
    who: params.get('who') ?? safeGet(key) ?? '',
    status: params.get('status') ?? '',
  }

  const groups = bar.querySelectorAll<HTMLElement>('[data-filter-group]')
  const render = () => {
    for (const group of groups) {
      const name = group.dataset.filterGroup as keyof FilterState
      let matched = false
      for (const button of group.querySelectorAll<HTMLButtonElement>('button')) {
        const on = button.dataset.value === state[name]
        matched ||= on
        button.setAttribute('aria-pressed', String(on))
      }
      // A remembered member that no longer exists falls back to everyone.
      if (!matched) {
        state[name] = ''
        group.querySelector('button')?.setAttribute('aria-pressed', 'true')
      }
    }
    apply(state)
    onChange?.(state)
  }

  for (const group of groups) {
    group.addEventListener('click', (event) => {
      const button = (event.target as Element).closest('button')
      if (!button) return
      const name = group.dataset.filterGroup as keyof FilterState
      state[name] = button.dataset.value ?? ''
      if (name === 'who') safeSet(key, state.who)
      const url = new URL(location.href)
      for (const [k, v] of Object.entries(state)) {
        if (v) url.searchParams.set(k, v)
        else url.searchParams.delete(k)
      }
      history.replaceState(history.state, '', url)
      render()
    })
  }
  render()
  return state
}

export function matches(el: HTMLElement, state: FilterState): boolean {
  const tokens = (el.dataset.filter ?? '').split(' ')
  if (state.who && !tokens.includes(state.who)) return false
  if (state.status && el.dataset.status !== state.status) return false
  return true
}

function apply(state: FilterState) {
  let visible = 0
  for (const el of document.querySelectorAll<HTMLElement>('[data-item]')) {
    const show = matches(el, state)
    el.hidden = !show
    if (show) visible++
  }
  const filtered = Boolean(state.who || state.status)
  for (const section of document.querySelectorAll<HTMLElement>('[data-day-section]')) {
    const any = section.querySelector('[data-item]:not([hidden])')
    section.hidden = filtered && !any
  }
  for (const stay of document.querySelectorAll<HTMLElement>('[data-stay]')) {
    stay.hidden = !matches(stay, { ...state, status: '' })
  }
  document.querySelector<HTMLElement>('[data-filter-empty]')?.toggleAttribute('hidden', visible > 0)
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Remembering is a convenience only.
  }
}
