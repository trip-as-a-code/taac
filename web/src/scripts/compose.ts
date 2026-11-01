// The message field and icon buttons of discussions: in the thread panel, in
// the cards beside the page, for a reply, an edit or a new thread alike.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** A textarea that sends on Cmd/Ctrl+Enter. */
export function textarea(placeholder: string, value = '') {
  const area = el('textarea')
  area.rows = 2
  area.maxLength = 4000
  area.placeholder = placeholder
  area.value = value
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) area.form?.requestSubmit()
  })
  return area
}

const ICONS = {
  check: 'M5 12.5 10 17.5 19 7',
  reopen: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  pencil: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  send: 'M12 19V5M5 12l7-7 7 7',
} as const

/** A small round button with just an icon; its name for screen readers and the tooltip. */
export function iconButton(icon: keyof typeof ICONS, label: string, onClick: () => void, className = 'icon-button') {
  const b = el('button', className)
  b.type = 'button'
  b.title = label
  b.setAttribute('aria-label', label)
  b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`
  b.addEventListener('click', onClick)
  return b
}

/** A text field with its send button inside it, like a message field; it grows as you type. */
export function composeField(placeholder: string, value: string, submit: (body: string) => void, label: string) {
  const form = el('form', 'compose')
  const area = textarea(placeholder, value)
  area.rows = 1
  const grow = () => {
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }
  const sendButton = iconButton('send', label, () => form.requestSubmit(), 'compose-send')
  sendButton.type = 'submit'
  const sync = () => (sendButton.disabled = !area.value.trim() || area.value === value)
  area.addEventListener('input', () => {
    grow()
    sync()
  })
  sync()
  form.append(area, sendButton)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (area.value.trim()) submit(area.value)
  })
  queueMicrotask(grow)
  return { form, area }
}
