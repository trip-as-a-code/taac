// Pure zero-knowledge KDBX4 decryption (kdbxweb + hash-wasm Argon2) and
// `#k=` URL fragment helpers. Shared between the Web Worker and unit tests.

import { argon2d, argon2id } from 'hash-wasm'
import * as kdbxweb from 'kdbxweb'

export const VAULT_LINK_PREFIX = 'taac:vault:'

export interface DecryptedEntry {
  value: string | null
  fields: Record<string, string>
  /** Binary attachments as raw bytes (transferable from worker). */
  attachments: Record<string, Uint8Array>
}

export interface DecryptedVault {
  entries: Record<string, DecryptedEntry>
  /** `tripSlug -> sharedVaultPassword` extracted from `taac:vault:<slug>` entries. */
  linkedVaults: Record<string, string>
}

let argon2Ready = false

export function ensureArgon2() {
  if (argon2Ready) return
  argon2Ready = true
  // kdbxweb passes Argon2Type: 0 = Argon2d, 2 = Argon2id.
  kdbxweb.CryptoEngine.setArgon2Impl(
    async (
      password: ArrayBuffer,
      salt: ArrayBuffer,
      memory: number,
      iterations: number,
      length: number,
      parallelism: number,
      type: number,
    ): Promise<ArrayBuffer> => {
      const fn = type === 2 ? argon2id : argon2d
      const hash = await fn({
        password: new Uint8Array(password),
        salt: new Uint8Array(salt),
        memorySize: memory,
        iterations,
        hashLength: length,
        parallelism,
        outputType: 'binary',
      })
      const copy = new Uint8Array(hash.byteLength)
      copy.set(hash)
      return copy.buffer
    },
  )
}

function fieldValue(raw: string | kdbxweb.ProtectedValue | undefined): string | null {
  if (raw === undefined) return null
  if (typeof raw === 'string') return raw
  return raw.getText()
}

function walkGroup(group: kdbxweb.KdbxGroup, out: DecryptedVault) {
  for (const entry of group.entries) {
    const title = fieldValue(entry.fields.get('Title'))
    if (!title) continue

    const password = fieldValue(entry.fields.get('Password'))
    const valueField = fieldValue(entry.fields.get('Value'))
    const primary =
      (password && password.length > 0 ? password : null) ?? (valueField && valueField.length > 0 ? valueField : null)

    if (title.startsWith(VAULT_LINK_PREFIX)) {
      const slug = title.slice(VAULT_LINK_PREFIX.length)
      if (slug && primary) out.linkedVaults[slug] = primary
      continue
    }

    const fields: Record<string, string> = {}
    for (const [k, v] of entry.fields.entries()) {
      if (k === 'Title') continue
      const text = fieldValue(v)
      if (text !== null && text.length > 0) fields[k] = text
    }

    const attachments: Record<string, Uint8Array> = {}
    for (const [name, bin] of entry.binaries.entries()) {
      const raw = bin && typeof bin === 'object' && 'value' in bin ? bin.value : bin
      if (raw instanceof kdbxweb.ProtectedValue) {
        attachments[name] = raw.getBinary()
      } else if (raw instanceof ArrayBuffer) {
        attachments[name] = new Uint8Array(raw)
      } else if (raw instanceof Uint8Array) {
        attachments[name] = raw
      }
    }

    out.entries[title] = { value: primary, fields, attachments }
  }

  for (const sub of group.groups) walkGroup(sub, out)
}

/** Decrypts a `.kdbx` buffer with `password` strictly client-side. */
export async function decryptKdbx(buffer: ArrayBuffer, password: string): Promise<DecryptedVault> {
  ensureArgon2()
  const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(password))
  const db = await kdbxweb.Kdbx.load(buffer, credentials)
  const out: DecryptedVault = { entries: {}, linkedVaults: {} }
  for (const group of db.groups) walkGroup(group, out)
  return out
}

/** Encodes a UTF-8 passphrase as unpadded URL-safe Base64 (RFC 4648 §5) for `#k=`. */
export function encodeShareKey(passphrase: string): string {
  const bytes = new TextEncoder().encode(passphrase)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decodes an unpadded URL-safe Base64 string from `#k=`. */
export function decodeShareKey(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * Extracts `#k=<base64url>` from `hash` (e.g. `#k=abc` or `#item-1&k=abc`),
 * returning the decoded passphrase and the cleaned hash without `k=`.
 */
export function extractHashKey(hash: string): { key: string | null; cleanHash: string } {
  if (!hash || !hash.startsWith('#')) return { key: null, cleanHash: hash }
  const raw = hash.slice(1)
  const parts = raw.split('&')
  let found: string | null = null
  const kept: string[] = []
  for (const part of parts) {
    if (part.startsWith('k=')) {
      found = decodeShareKey(part.slice(2))
    } else if (part.length > 0) {
      kept.push(part)
    }
  }
  return { key: found, cleanHash: kept.length > 0 ? `#${kept.join('&')}` : '' }
}
