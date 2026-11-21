// Zero-knowledge browser vault manager: unlocks KeePass (.kdbx) vaults in a
// Web Worker, chains personal -> shared unlock via `taac:vault:<slug>`, reads
// `#k=` share fragments, and hydrates `[data-secret]` and `[data-secret-attachment]`.

import { me } from '@/scripts/session'
import { closeOnBackdrop } from '@/scripts/sheet'
import { encodeShareKey, extractHashKey, type DecryptedEntry, type DecryptedVault } from '@/scripts/vault-crypto'
import type { WorkerRequest, WorkerResponse } from '@/scripts/vault-worker'

export interface VaultDescriptor {
  id: string
  label: string
  url: string
  kind: 'shared' | 'personal'
  ownerLogin?: string
}

interface UnlockedState {
  vault: DecryptedVault
  password: string
}

const SESSION_KEY = 'taac_vault_keys_v1'
const LOCAL_KEY = 'taac_vault_keys_remember_v1'

/** In-memory cache of unlocked vaults by `${scope}:${vaultId}` (survives Astro view transitions). */
const unlocked = new Map<string, UnlockedState>()
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: DecryptedVault) => void; reject: (e: Error) => void }>()
const blobUrls: string[] = []

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./vault-worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      const req = pending.get(msg.id)
      if (!req) return
      pending.delete(msg.id)
      if (msg.ok) req.resolve(msg.vault)
      else req.reject(new Error(msg.error))
    })
  }
  return worker
}

async function decryptInWorker(buffer: ArrayBuffer, password: string): Promise<DecryptedVault> {
  const id = nextId++
  const w = getWorker()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const msg: WorkerRequest = { id, buffer, password }
    w.postMessage(msg, [buffer])
  })
}

function readStoredPasswords(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [storage, key] of [
    [localStorage, LOCAL_KEY],
    [sessionStorage, SESSION_KEY],
  ] as const) {
    try {
      const raw = storage.getItem(key)
      if (raw) Object.assign(out, JSON.parse(raw) as Record<string, string>)
    } catch {
      // Storage unavailable (private mode).
    }
  }
  return out
}

function savePassword(cacheKey: string, password: string, remember: boolean) {
  try {
    const current = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}') as Record<string, string>
    current[cacheKey] = password
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(current))
    if (remember) {
      const persisted = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, string>
      persisted[cacheKey] = password
      localStorage.setItem(LOCAL_KEY, JSON.stringify(persisted))
    }
  } catch {
    // Storage unavailable.
  }
}

/** Wipes all unlocked vaults, passphrases, and Blob URLs (called on Lock and Logout). */
export function lockAllVaults() {
  unlocked.clear()
  for (const url of blobUrls.splice(0)) URL.revokeObjectURL(url)
  try {
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(LOCAL_KEY)
  } catch {
    // Storage unavailable.
  }
  worker?.terminate()
  worker = null
  hydrateDom()
  updateControlState()
}

/** Returns the unlocked shared vault passphrase for `slug`, if available (for `#k=` share links). */
export function getSharedVaultShareFragment(slug: string): string | null {
  const state = unlocked.get(`trip:${slug}:shared`)
  return state ? `#k=${encodeShareKey(state.password)}` : null
}

function cacheKeyFor(slug: string, v: VaultDescriptor): string {
  return v.kind === 'shared' ? `trip:${slug}:shared` : `site:${v.id}`
}

async function fetchAndUnlock(
  slug: string,
  desc: VaultDescriptor,
  password: string,
  remember: boolean,
  allVaults: VaultDescriptor[],
): Promise<DecryptedVault> {
  const response = await fetch(desc.url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const buffer = await response.arrayBuffer()
  const vault = await decryptInWorker(buffer, password)
  const key = cacheKeyFor(slug, desc)
  unlocked.set(key, { vault, password })
  savePassword(key, password, remember)

  // Chaining: if a personal vault contains `taac:vault:<slug>`, automatically unlock the trip's shared vault!
  if (desc.kind === 'personal' && vault.linkedVaults[slug]) {
    const shared = allVaults.find((v) => v.kind === 'shared')
    if (shared && !unlocked.has(cacheKeyFor(slug, shared))) {
      await fetchAndUnlock(slug, shared, vault.linkedVaults[slug], remember, allVaults).catch(() => undefined)
    }
  }
  return vault
}

function lookupEntry(slug: string, secretName: string, vaultHint?: string): DecryptedEntry | null {
  if (vaultHint && vaultHint !== 'shared') {
    return unlocked.get(`site:${vaultHint}`)?.vault.entries[secretName] ?? null
  }
  if (vaultHint === 'shared') {
    return unlocked.get(`trip:${slug}:shared`)?.vault.entries[secretName] ?? null
  }
  // Default search order: trip shared vault first, then any unlocked personal vault.
  const shared = unlocked.get(`trip:${slug}:shared`)?.vault.entries[secretName]
  if (shared) return shared
  for (const [key, state] of unlocked.entries()) {
    if (key.startsWith('site:') && state.vault.entries[secretName]) {
      return state.vault.entries[secretName]
    }
  }
  return null
}

function mimeForFilename(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

function openAttachment(name: string, bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = new Blob([copy], { type: mimeForFilename(name) })
  const url = URL.createObjectURL(blob)
  blobUrls.push(url)
  const win = window.open(url, '_blank', 'noopener')
  if (!win) {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
  }
}

function hydrateDom() {
  const root = document.querySelector<HTMLElement>('[data-vault-control]')
  const slug = root?.dataset.tripSlug
  if (!slug) return

  // 1. Hydrate text secrets (`booking.reference`, `contact.phone`, `contact.email`).
  for (const el of document.querySelectorAll<HTMLElement>('[data-secret]')) {
    const name = el.dataset.secret!
    const field = el.dataset.secretField || undefined
    const vaultHint = el.dataset.secretVault || undefined
    const entry = lookupEntry(slug, name, vaultHint)
    const value = entry ? (field ? (entry.fields[field] ?? null) : entry.value) : null
    const valueEl = el.querySelector<HTMLElement>('[data-secret-value]')
    const copyBtn = el.querySelector<HTMLButtonElement>('[data-secret-copy]')
    if (value && valueEl) {
      valueEl.textContent = value
      el.dataset.unlocked = 'true'
      if (copyBtn) {
        copyBtn.hidden = false
        copyBtn.onclick = async (event) => {
          event.stopPropagation()
          try {
            await navigator.clipboard.writeText(value)
            copyBtn.dataset.copied = 'true'
            setTimeout(() => delete copyBtn.dataset.copied, 1500)
          } catch {
            // Clipboard unavailable.
          }
        }
      }
    } else if (valueEl) {
      valueEl.textContent = el.dataset.secretMask ?? '••••••'
      delete el.dataset.unlocked
      if (copyBtn) copyBtn.hidden = true
    }
  }

  // 2. Hydrate binary attachment chips.
  for (const el of document.querySelectorAll<HTMLElement>('[data-secret-attachment]')) {
    const name = el.dataset.secretAttachment!
    const filename = el.dataset.secretFilename || undefined
    const all = el.dataset.secretAll === 'true'
    const vaultHint = el.dataset.secretVault || undefined
    const entry = lookupEntry(slug, name, vaultHint)
    const container = el.querySelector<HTMLElement>('[data-secret-attachment-list]')
    if (!container) continue

    if (!entry) {
      delete el.dataset.unlocked
      container.replaceChildren()
      continue
    }

    const files: [string, Uint8Array][] = all
      ? Object.entries(entry.attachments)
      : filename && entry.attachments[filename]
        ? [[filename, entry.attachments[filename]]]
        : Object.entries(entry.attachments)

    if (files.length === 0) {
      delete el.dataset.unlocked
      container.replaceChildren()
      continue
    }

    el.dataset.unlocked = 'true'
    container.replaceChildren(
      ...files.map(([attName, bytes]) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'vault-attachment-chip'
        btn.textContent = attName
        btn.addEventListener('click', (event) => {
          event.stopPropagation()
          openAttachment(attName, bytes)
        })
        return btn
      }),
    )
  }
}

function updateControlState() {
  const root = document.querySelector<HTMLElement>('[data-vault-control]')
  if (!root) return
  const slug = root.dataset.tripSlug!
  const vaults = JSON.parse(root.dataset.vaults ?? '[]') as VaultDescriptor[]
  const anyUnlocked = vaults.some((v) => unlocked.has(cacheKeyFor(slug, v)))
  root.toggleAttribute('data-unlocked', anyUnlocked)
  const lockBtn = root.querySelector<HTMLButtonElement>('[data-vault-lock]')
  if (lockBtn) lockBtn.hidden = !anyUnlocked

  const statusList = root.querySelector<HTMLUListElement>('[data-vault-status]')
  if (statusList) {
    statusList.replaceChildren(
      ...vaults.map((v) => {
        const li = document.createElement('li')
        const isOpen = unlocked.has(cacheKeyFor(slug, v))
        li.dataset.state = isOpen ? 'open' : 'locked'
        li.textContent = `${v.label} — ${isOpen ? (root.dataset.unlockedLabel ?? 'Unlocked') : (root.dataset.lockedLabel ?? 'Locked')}`
        return li
      }),
    )
  }
}

export async function setupVault() {
  const root = document.querySelector<HTMLElement>('[data-vault-control]')
  if (!root) return

  const slug = root.dataset.tripSlug!
  const vaults = JSON.parse(root.dataset.vaults ?? '[]') as VaultDescriptor[]
  if (vaults.length === 0) return

  const openBtn = root.querySelector<HTMLButtonElement>('[data-vault-open]')!
  const dialog = root.querySelector<HTMLDialogElement>('[data-vault-dialog]')!
  const form = root.querySelector<HTMLFormElement>('[data-vault-form]')!
  const select = root.querySelector<HTMLSelectElement>('[data-vault-select]')
  const passInput = form.elements.namedItem('password') as HTMLInputElement
  const rememberInput = form.elements.namedItem('remember') as HTMLInputElement | null
  const errorEl = root.querySelector<HTMLElement>('[data-vault-error]')!
  const lockBtn = root.querySelector<HTMLButtonElement>('[data-vault-lock]')!
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!

  // Default to the signed-in user's personal vault if one matches their GitHub login.
  const session = await me()
  const login = session?.login?.toLowerCase() ?? null
  if (select && login) {
    const mine = vaults.find((v) => v.kind === 'personal' && v.ownerLogin === login)
    if (mine) select.value = mine.id
  }

  // 1. Handle `#k=<base64url>` share fragment: decode, strip immediately from URL, unlock shared vault.
  const { key: hashKey, cleanHash } = extractHashKey(location.hash)
  if (hashKey) {
    history.replaceState(history.state, '', location.pathname + location.search + cleanHash)
    const shared = vaults.find((v) => v.kind === 'shared')
    if (shared) {
      await fetchAndUnlock(slug, shared, hashKey, false, vaults).catch(() => undefined)
    }
  }

  // 2. Restore any vaults cached in sessionStorage / opt-in localStorage.
  const stored = readStoredPasswords()
  for (const v of vaults) {
    const key = cacheKeyFor(slug, v)
    if (!unlocked.has(key) && stored[key]) {
      await fetchAndUnlock(slug, v, stored[key], false, vaults).catch(() => undefined)
    }
  }

  hydrateDom()
  updateControlState()

  // Clicking a locked secret or attachment opens the unlock modal.
  const openDialog = (preferredVaultId?: string) => {
    if (select && preferredVaultId && vaults.some((v) => v.id === preferredVaultId)) {
      select.value = preferredVaultId
    }
    errorEl.hidden = true
    dialog.showModal()
    passInput.focus()
  }

  openBtn.addEventListener('click', () => openDialog())
  root.querySelector('[data-vault-close]')?.addEventListener('click', () => dialog.close())
  closeOnBackdrop(dialog)
  lockBtn.addEventListener('click', () => {
    lockAllVaults()
    dialog.close()
  })

  for (const trigger of document.querySelectorAll<HTMLElement>('[data-secret-trigger]')) {
    trigger.addEventListener('click', (event) => {
      const holder = trigger.closest<HTMLElement>('[data-secret], [data-secret-attachment]')
      if (holder?.dataset.unlocked === 'true') return
      event.stopPropagation()
      openDialog(holder?.dataset.secretVault)
    })
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const chosenId = select ? select.value : vaults[0]!.id
    const desc = vaults.find((v) => v.id === chosenId) ?? vaults[0]!
    const password = passInput.value
    if (!password) return

    errorEl.hidden = true
    submitBtn.disabled = true
    try {
      await fetchAndUnlock(slug, desc, password, Boolean(rememberInput?.checked), vaults)
      passInput.value = ''
      hydrateDom()
      updateControlState()
      dialog.close()
    } catch {
      errorEl.textContent = root.dataset.wrongPassword ?? 'Wrong password or unavailable vault.'
      errorEl.hidden = false
    } finally {
      submitBtn.disabled = false
    }
  })
}
