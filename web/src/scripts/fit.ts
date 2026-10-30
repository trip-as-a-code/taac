// Big figures (totals, stat tiles) stay on one line inside their box: a long
// amount in a wordy currency shrinks to fit instead of spilling over. Mark
// them `data-fit`; they re-fit when their text changes or their box resizes.

const MIN = 14

const boxes = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => fitAll())
const texts = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => fitAll())
const watched = new WeakSet<Element>()

/** Shrinks `el` until its text fits its width; back to the stylesheet's size when it does. */
export function fit(el: HTMLElement) {
  el.style.fontSize = ''
  const room = el.clientWidth
  const needed = el.scrollWidth
  if (!room || needed <= room) return
  const size = parseFloat(getComputedStyle(el).fontSize)
  el.style.fontSize = `${Math.max(MIN, Math.floor((size * room) / needed))}px`
}

export function fitAll(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-fit]')) {
    fit(el)
    if (watched.has(el)) continue
    watched.add(el)
    if (el.parentElement) boxes?.observe(el.parentElement)
    texts?.observe(el, { childList: true, characterData: true, subtree: true })
  }
}
