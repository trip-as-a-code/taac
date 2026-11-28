// Web Worker for KDBX4 Argon2 decryption so unlocking never blocks the UI thread.

import { decryptKdbx, type DecryptedVault } from './vault-crypto'

export interface WorkerRequest {
  id: number
  buffer: ArrayBuffer
  password: string
}

export type WorkerResponse = { id: number; ok: true; vault: DecryptedVault } | { id: number; ok: false; error: string }

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer, password } = event.data
  try {
    const vault = await decryptKdbx(buffer, password)
    const response: WorkerResponse = { id, ok: true, vault }
    self.postMessage(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const response: WorkerResponse = { id, ok: false, error: message }
    self.postMessage(response)
  }
})
