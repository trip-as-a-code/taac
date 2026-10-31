// GitHub pictures over the initials: shown once loaded, dropped when there is none (404).

const PHOTO = 'img[data-avatar-photo]'

function settle(img: HTMLImageElement) {
  if (!img.complete) return
  if (img.naturalWidth > 0) img.dataset.loaded = ''
  else img.remove()
}

let listening = false

export function setupAvatars() {
  if (!listening) {
    listening = true
    // Load and error don't bubble; capture sees them for every picture, now and later.
    for (const type of ['load', 'error'])
      document.addEventListener(
        type,
        (event) => {
          if (event.target instanceof HTMLImageElement && event.target.matches(PHOTO)) settle(event.target)
        },
        true,
      )
  }
  // Pictures that finished before this ran.
  document.querySelectorAll<HTMLImageElement>(PHOTO).forEach(settle)
}

/**
 * A picture made by a script: it watches its own loading, since one already
 * in the cache can finish before it is on the page, where the listeners above
 * would never hear of it.
 */
export function avatarPhoto(login: string): HTMLImageElement {
  const img = document.createElement('img')
  img.className = 'avatar-photo'
  img.alt = ''
  img.dataset.avatarPhoto = ''
  img.addEventListener('load', () => settle(img))
  img.addEventListener('error', () => settle(img))
  img.src = `/api/avatars/${login}`
  return img
}
