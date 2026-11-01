/**
 * Places' photos: any https URL a trip names, fetched here once, resized and
 * kept, so browsers only ever load them from this site. The build lists the
 * URLs by id (`/_taac/photos.json`); a viewer gets a photo only when it
 * belongs to a trip they can see.
 */

import sharp from 'sharp'

export interface PhotoEntry {
  url: string
  /** The trips whose places use it. */
  trips: string[]
}

export interface StoredPhoto {
  type: string
  image: Uint8Array
  fetchedAt: number
}

export interface PhotoStore {
  photo(id: string, size: PhotoSize): Promise<StoredPhoto | null>
  putPhoto(id: string, size: PhotoSize, photo: StoredPhoto): Promise<void>
}

/** A card's square, the map popup's strip, the lightbox's large picture. */
export const SIZES = {
  thumb: { width: 168, height: 168, fit: 'cover' },
  wide: { width: 640, height: 280, fit: 'cover' },
  large: { width: 1600, height: 1600, fit: 'inside' },
} as const
export type PhotoSize = keyof typeof SIZES

const TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_BYTES = 20 * 1024 * 1024

export function photoRoute(path: string): { id: string; size: PhotoSize } | null {
  const match = /^\/api\/photos\/([0-9a-f]{16})\/(thumb|wide|large)$/.exec(path)
  return match ? { id: match[1]!, size: match[2] as PhotoSize } : null
}

/** Every size of the original, as WebP; a smaller original is never enlarged. */
export async function resize(original: Uint8Array): Promise<Record<PhotoSize, Uint8Array>> {
  const out = {} as Record<PhotoSize, Uint8Array>
  for (const [size, box] of Object.entries(SIZES) as [PhotoSize, (typeof SIZES)[PhotoSize]][])
    out[size] = new Uint8Array(
      await sharp(original, { failOn: 'none' })
        .rotate()
        .resize({ width: box.width, height: box.height, fit: box.fit, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer(),
    )
  return out
}

/** The original at `url`; throws on anything that isn't an image or is too big. */
export async function download(url: string, fetcher: typeof fetch, userAgent: string): Promise<Uint8Array> {
  const response = await fetcher(url, {
    redirect: 'follow',
    headers: { 'User-Agent': userAgent, Accept: 'image/*' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`photo ${response.status}`)
  if (!(response.headers.get('Content-Type') ?? '').startsWith('image/')) throw new Error('not an image')
  if (Number(response.headers.get('Content-Length') ?? 0) > MAX_BYTES) throw new Error('too big')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > MAX_BYTES) throw new Error('too big')
  return bytes
}

/** Photos by id and size: kept in the store (or memory) for a month, the last one served while the host is away. */
export function photoSource(store: PhotoStore | undefined, fetcher: typeof fetch, userAgent: string) {
  const memory = new Map<string, StoredPhoto>()
  const pending = new Map<string, Promise<Record<PhotoSize, StoredPhoto> | null>>()
  const key = (id: string, size: PhotoSize) => `${id}/${size}`
  const kept = async (id: string, size: PhotoSize) =>
    memory.get(key(id, size)) ?? (await store?.photo(id, size).catch(() => null)) ?? null

  async function refresh(id: string, url: string, now: number): Promise<Record<PhotoSize, StoredPhoto> | null> {
    try {
      const sizes = await resize(await download(url, fetcher, userAgent))
      const kept = {} as Record<PhotoSize, StoredPhoto>
      for (const size of Object.keys(sizes) as PhotoSize[]) {
        kept[size] = { type: 'image/webp', image: sizes[size], fetchedAt: now }
        memory.set(key(id, size), kept[size])
        await store?.putPhoto(id, size, kept[size]).catch(() => undefined)
      }
      return kept
    } catch (error) {
      console.error(`photo ${id}: ${(error as Error).message}`)
      return null
    }
  }

  return async (id: string, url: string, size: PhotoSize, now: number): Promise<StoredPhoto | null> => {
    const old = await kept(id, size)
    if (old && now - old.fetchedAt < TTL_MS) return old
    let job = pending.get(id)
    if (!job) {
      job = refresh(id, url, now).finally(() => pending.delete(id))
      pending.set(id, job)
    }
    return (await job)?.[size] ?? old
  }
}
