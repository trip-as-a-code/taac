// Tooltips in the app's style instead of the browser's `title` popups. Every
// `title` moves to `data-tip` (eagerly on page load, lazily for markup added
// later, like map controls), keeping its text for assistive tech, and shows on
// mouse hover or keyboard focus. Touch has no hover, same as native.

const DELAY = 450
const WARM = 400
const GAP = 8
const MARGIN = 8

let tip: HTMLElement | undefined
let owner: HTMLElement | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let hiddenAt = 0

function adopt(el: HTMLElement) {
  const text = el.getAttribute('title')
  el.removeAttribute('title')
  if (!text) return
  el.dataset.tip = text
  // `title` named or described the element; keep that for screen readers.
  const named = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')
  if (!named && !el.textContent?.trim()) el.setAttribute('aria-label', text)
  else if (!named || el.getAttribute('aria-label') !== text) el.setAttribute('aria-description', text)
}

function target(node: EventTarget | null) {
  const el = (node as Element | null)?.closest?.<HTMLElement>('[title], [data-tip]')
  if (!el || el.closest('svg title')) return undefined
  if (el.hasAttribute('title')) adopt(el)
  return el.dataset.tip ? el : undefined
}

function element() {
  if (!tip?.isConnected) {
    tip = document.createElement('div')
    tip.className = 'tip footnote'
    tip.id = 'taac-tip'
    tip.setAttribute('role', 'tooltip')
    tip.popover = 'manual'
    document.body.append(tip)
  }
  return tip
}

function show(el: HTMLElement) {
  const t = element()
  owner = el
  t.textContent = el.dataset.tip ?? ''
  // Measure at the origin, where nothing squeezes it.
  t.style.left = '0px'
  t.style.top = '0px'
  t.showPopover()
  const box = el.getBoundingClientRect()
  const { width, height } = t.getBoundingClientRect()
  const up = box.top - height - GAP >= MARGIN
  t.dataset.side = up ? 'top' : 'bottom'
  const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, MARGIN), innerWidth - width - MARGIN)
  t.style.left = `${left}px`
  t.style.top = `${up ? box.top - height - GAP : box.bottom + GAP}px`
}

function hide() {
  clearTimeout(timer)
  if (owner && tip?.matches(':popover-open')) {
    tip.hidePopover()
    hiddenAt = Date.now()
  }
  owner = undefined
}

function schedule(el: HTMLElement) {
  if (el === owner) return
  clearTimeout(timer)
  // Moving from one tip to the next shows it at once, like native.
  const warm = Date.now() - hiddenAt < WARM || tip?.matches(':popover-open')
  hide()
  timer = setTimeout(() => show(el), warm ? 0 : DELAY)
}

let once = false

/** Adopts this page's titles; wires the listeners on first call. */
export function setupTooltips() {
  for (const el of document.body.querySelectorAll<HTMLElement>('[title]')) {
    if (!el.closest('svg')) adopt(el)
  }
  hide()
  if (once) return
  once = true
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return
    const el = target(event.target)
    if (el) schedule(el)
    else if (owner || timer) hide()
  })
  document.addEventListener('pointerout', (event) => {
    const to = event.relatedTarget as Node | null
    const el = target(event.target)
    if (el && !(to && el.contains(to))) hide()
  })
  document.addEventListener('focusin', (event) => {
    const el = target(event.target)
    if (el && el.matches(':focus-visible')) schedule(el)
  })
  document.addEventListener('focusout', hide)
  document.addEventListener('pointerdown', hide, true)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && owner) hide()
  })
  addEventListener('scroll', hide, { capture: true, passive: true })
  document.addEventListener('astro:before-swap', hide)
}
