// Custom dropdowns over native selects (components/Select.astro). The select
// keeps the value and fires `change`, so page scripts never know the
// difference; this draws the trigger and a listbox in the top layer, and
// follows the ARIA select-only combobox pattern for the keyboard: arrows,
// Home/End, PageUp/PageDown, type-ahead, Enter/Space to pick, Escape to
// back out, Tab to pick and move on. Long lists get a fuzzy search field.

const SEARCHABLE = 8
const PAGE = 10
const GAP = 6
const MARGIN = 8

interface Entry {
  option: HTMLOptionElement
  el: HTMLElement
  text: string
}

let ids = 0

/** Folds case and diacritics, so "kyoto" finds "Kyōto". */
export function fold(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Fuzzy match: every query character in order. Scores favour contiguous runs,
 * word starts and early matches; undefined when it doesn't match at all.
 * Tries each place the first character occurs and keeps the best run.
 */
export function fuzzy(query: string, text: string): { score: number; hits: number[] } | undefined {
  const q = [...fold(query).replace(/\s+/g, '')]
  if (!q.length) return { score: 0, hits: [] }
  // By code point, so hits line up with `highlight`'s characters.
  const t = [...fold(text)]
  let best: { score: number; hits: number[] } | undefined
  for (let s = t.indexOf(q[0]); s >= 0; s = t.indexOf(q[0], s + 1)) {
    const hits: number[] = []
    let score = 0
    let from = s
    for (const ch of q) {
      const at = t.indexOf(ch, from)
      if (at < 0) return best
      if (hits.length && at === hits.at(-1)! + 1) score += 5
      if (at === 0 || /[\s\-·/(,.]/.test(t[at - 1])) score += 8
      score -= Math.min(at - from, 10) * 0.5
      hits.push(at)
      from = at + 1
    }
    score -= s * 0.1
    if (!best || score > best.score) best = { score, hits }
  }
  return best
}

function highlight(el: HTMLElement, text: string, hits: number[]) {
  el.textContent = ''
  if (!hits.length) {
    el.textContent = text
    return
  }
  // `fold` drops combining marks, so map folded positions back by character.
  const chars = [...text.normalize('NFD')].reduce<string[]>((out, ch) => {
    if (/\p{M}/u.test(ch) && out.length) out[out.length - 1] += ch
    else out.push(ch)
    return out
  }, [])
  const set = new Set(hits)
  let run = ''
  let marked = false
  const flush = () => {
    if (!run) return
    if (marked) {
      const mark = document.createElement('mark')
      mark.textContent = run.normalize('NFC')
      el.append(mark)
    } else el.append(run.normalize('NFC'))
    run = ''
  }
  chars.forEach((ch, i) => {
    if (set.has(i) !== marked) {
      flush()
      marked = set.has(i)
    }
    run += ch
  })
  flush()
}

function enhance(root: HTMLElement) {
  const select = root.querySelector('select')!
  const trigger = root.querySelector<HTMLButtonElement>('.picker-trigger')!
  const valueEl = trigger.querySelector<HTMLElement>('.picker-value')!
  const id = `picker-${++ids}`

  const pop = document.createElement('div')
  pop.className = 'picker-pop'
  pop.popover = 'manual'
  const list = document.createElement('div')
  list.className = 'picker-list'
  list.id = `${id}-list`
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', select.getAttribute('aria-label') ?? '')
  const empty = document.createElement('p')
  empty.className = 'picker-empty footnote'
  empty.textContent = root.dataset.empty ?? ''
  empty.hidden = true
  let search: HTMLInputElement | undefined
  pop.append(list, empty)
  root.append(pop)

  select.tabIndex = -1
  select.setAttribute('aria-hidden', 'true')
  trigger.tabIndex = 0
  trigger.setAttribute('aria-controls', list.id)
  trigger.setAttribute('aria-haspopup', 'listbox')
  root.classList.add('enhanced')

  let entries: Entry[] = []
  let shown: Entry[] = []
  let active = -1
  let open = false
  let typed = ''
  let typedAt = 0

  const build = () => {
    list.textContent = ''
    entries = [...select.options].map((option, i) => {
      const el = document.createElement('div')
      el.className = 'picker-option'
      el.id = `${id}-${i}`
      el.setAttribute('role', 'option')
      if (option.lang) el.lang = option.lang
      el.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' +
        '<span class="picker-label"></span>'
      el.querySelector('.picker-label')!.textContent = option.text
      list.append(el)
      return { option, el, text: option.text }
    })
    shown = entries
    if (entries.length > SEARCHABLE && !search) {
      search = document.createElement('input')
      search.type = 'text'
      search.className = 'picker-search'
      search.placeholder = root.dataset.search ?? ''
      search.setAttribute('role', 'combobox')
      search.setAttribute('aria-label', root.dataset.search ?? '')
      search.setAttribute('aria-controls', list.id)
      search.setAttribute('aria-expanded', 'true')
      search.setAttribute('aria-autocomplete', 'list')
      search.autocomplete = 'off'
      search.spellcheck = false
      search.addEventListener('input', () => filter(search!.value))
      search.addEventListener('keydown', onKey)
      pop.prepend(search)
    }
    sync()
  }

  const sync = () => {
    const option = select.selectedOptions[0]
    valueEl.textContent = option?.dataset.short ?? option?.text ?? ''
    if (option?.lang) valueEl.lang = option.lang
    else valueEl.removeAttribute('lang')
    for (const e of entries) e.el.setAttribute('aria-selected', String(e.option === option))
  }

  const setActive = (index: number, scroll = true) => {
    active = shown.length ? Math.max(0, Math.min(index, shown.length - 1)) : -1
    for (const [i, e] of shown.entries()) e.el.toggleAttribute('data-active', i === active)
    const current = shown[active]
    for (const el of [trigger, search]) {
      if (!el) continue
      if (current && open) el.setAttribute('aria-activedescendant', current.el.id)
      else el.removeAttribute('aria-activedescendant')
    }
    if (current && scroll) current.el.scrollIntoView({ block: 'nearest' })
  }

  const filter = (query: string) => {
    const scored = entries
      .map((e, i) => ({ e, i, m: fuzzy(query, e.text) }))
      .filter((x) => x.m)
      .sort((a, b) => (query.trim() ? b.m!.score - a.m!.score : 0) || a.i - b.i)
    shown = scored.map((x) => x.e)
    for (const e of entries) e.el.hidden = true
    for (const { e, m } of scored) {
      e.el.hidden = false
      highlight(e.el.querySelector('.picker-label')!, e.text, m!.hits)
      list.append(e.el)
    }
    empty.hidden = shown.length > 0
    const selected = shown.findIndex((e) => e.option.selected)
    setActive(query.trim() ? 0 : Math.max(selected, 0))
  }

  const place = () => {
    const box = trigger.getBoundingClientRect()
    const below = innerHeight - box.bottom - GAP - MARGIN
    const above = box.top - GAP - MARGIN
    const up = below < 220 && above > below
    const width = Math.min(Math.max(box.width, 220), innerWidth - MARGIN * 2)
    const left = Math.min(Math.max(box.left, MARGIN), innerWidth - width - MARGIN)
    pop.style.left = `${left}px`
    pop.style.width = `${width}px`
    pop.style.maxHeight = `${Math.min(up ? above : below, 360)}px`
    pop.style.top = up ? '' : `${box.bottom + GAP}px`
    pop.style.bottom = up ? `${innerHeight - box.top + GAP}px` : ''
    pop.dataset.side = up ? 'top' : 'bottom'
  }

  const onOutside = (event: PointerEvent) => {
    if (!root.contains(event.target as Node)) close(false)
  }
  const onScroll = (event: Event) => {
    if (!pop.contains(event.target as Node)) place()
  }

  const show = (index?: number, { focusSearch = true } = {}) => {
    if (open) return
    open = true
    if (search) {
      search.value = ''
      filter('')
    }
    pop.showPopover()
    place()
    trigger.setAttribute('aria-expanded', 'true')
    root.classList.add('open')
    setActive(
      index ??
        Math.max(
          entries.findIndex((e) => e.option.selected),
          0,
        ),
    )
    if (search && focusSearch) search.focus({ preventScroll: true })
    document.addEventListener('pointerdown', onOutside, true)
    addEventListener('scroll', onScroll, true)
    addEventListener('resize', place)
  }

  const close = (refocus = true) => {
    if (!open) return
    open = false
    pop.hidePopover()
    trigger.setAttribute('aria-expanded', 'false')
    root.classList.remove('open')
    setActive(-1, false)
    document.removeEventListener('pointerdown', onOutside, true)
    removeEventListener('scroll', onScroll, true)
    removeEventListener('resize', place)
    if (refocus) trigger.focus({ preventScroll: true })
  }

  const pick = (entry: Entry | undefined) => {
    if (!entry) return
    if (!entry.option.selected) {
      select.value = entry.option.value
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }

  // Type-ahead on the list itself (no search field): jump to the next label
  // starting with what was typed in the last half second.
  const typeAhead = (key: string) => {
    const now = Date.now()
    typed = now - typedAt > 500 ? key : typed + key
    typedAt = now
    const q = fold(typed)
    const repeat = [...q].every((c) => c === q[0])
    const start = active + (repeat || typed.length === 1 ? 1 : 0)
    const order = [...shown.slice(start), ...shown.slice(0, start)]
    const hit = order.find((e) => fold(e.text).startsWith(repeat ? q[0] : q))
    if (hit) setActive(shown.indexOf(hit))
  }

  function onKey(event: KeyboardEvent) {
    const inSearch = event.target === search
    const { key, altKey } = event
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) {
        event.preventDefault()
        show()
      } else if (key === 'Home' || key === 'End') {
        event.preventDefault()
        show(key === 'Home' ? 0 : entries.length - 1)
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !altKey) {
        event.preventDefault()
        show()
        if (search) {
          search.value = key
          filter(key)
        } else typeAhead(key)
      }
      return
    }
    switch (key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        if (altKey) {
          pick(shown[active])
          close()
        } else setActive(active + (key === 'ArrowDown' ? 1 : -1))
        break
      case 'PageDown':
      case 'PageUp':
        event.preventDefault()
        setActive(active + (key === 'PageDown' ? PAGE : -PAGE))
        break
      case 'Home':
      case 'End':
        if (inSearch && search!.value) return
        event.preventDefault()
        setActive(key === 'Home' ? 0 : shown.length - 1)
        break
      case 'Enter':
        event.preventDefault()
        pick(shown[active])
        close()
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close()
        break
      case 'Tab':
        // Pick and let the browser move focus on from the trigger.
        pick(shown[active])
        close()
        break
      case ' ':
        if (inSearch) return
        event.preventDefault()
        pick(shown[active])
        close()
        break
      default:
        if (!inSearch && key.length === 1 && !event.ctrlKey && !event.metaKey && !altKey) typeAhead(key)
    }
  }

  trigger.addEventListener('keydown', onKey)
  trigger.addEventListener('click', (event) => {
    if (open) close()
    // A tap shouldn't throw up the on-screen keyboard; a click or a key may.
    else show(undefined, { focusSearch: (event as PointerEvent).pointerType !== 'touch' })
  })
  list.addEventListener('pointermove', (event) => {
    const el = (event.target as Element).closest<HTMLElement>('.picker-option')
    const index = shown.findIndex((e) => e.el === el)
    if (index >= 0 && index !== active) setActive(index, false)
  })
  list.addEventListener('click', (event) => {
    const el = (event.target as Element).closest<HTMLElement>('.picker-option')
    pick(shown.find((e) => e.el === el))
    close()
  })
  // Keep focus where it is when clicking inside the list. Only for a mouse: on
  // touch it would also cancel the swipe that scrolls the list (mobile Safari).
  list.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') event.preventDefault()
  })
  root.addEventListener('focusout', (event) => {
    if (open && !root.contains(event.relatedTarget as Node)) close(false)
  })

  // Page scripts set `select.value` and add options; mirror both.
  const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!
  Object.defineProperty(select, 'value', {
    configurable: true,
    get: () => native.get!.call(select),
    set: (v: string) => {
      native.set!.call(select, v)
      sync()
    },
  })
  select.addEventListener('change', sync)
  new MutationObserver(build).observe(select, { childList: true, subtree: true, characterData: true })
  build()
}

/** Enhances every `[data-picker]` not yet enhanced (runs on each page load). */
export function setupPickers(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-picker]:not(.enhanced)')) enhance(el)
}
