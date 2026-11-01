// Places' photos: fade in once loaded (the icon underneath stays if one can't
// load), and open large in the viewer from any `[data-photo]` button.

import { closeOnBackdrop } from '@/scripts/sheet'

const IMAGE = 'img[data-photo-img]'

function settle(img: HTMLImageElement) {
  if (!img.complete) return
  if (img.naturalWidth > 0) img.dataset.loaded = ''
  // A popup header has nothing underneath: it goes; elsewhere the icon shows.
  else if (img.hasAttribute('data-photo-keep')) img.remove()
  else img.hidden = true
}

let listening = false

export function setupPhotos() {
  const viewer = document.querySelector<HTMLDialogElement>('[data-photo-viewer]')
  if (!listening) {
    listening = true
    for (const type of ['load', 'error'])
      document.addEventListener(
        type,
        (event) => {
          if (event.target instanceof HTMLImageElement && event.target.matches(IMAGE)) settle(event.target)
        },
        true,
      )
    document.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-photo]')
      const open = document.querySelector<HTMLDialogElement>('[data-photo-viewer]')
      if (!button || !open) return
      event.preventDefault()
      event.stopPropagation()
      const img = open.querySelector<HTMLImageElement>('[data-photo-large]')!
      img.src = button.dataset.photo!
      img.alt = button.dataset.photoTitle ?? ''
      open.querySelector('[data-photo-caption]')!.textContent = button.dataset.photoTitle ?? ''
      open.showModal()
    })
  }
  // Pictures that finished before this ran.
  document.querySelectorAll<HTMLImageElement>(IMAGE).forEach(settle)
  if (viewer && !viewer.dataset.ready) {
    viewer.dataset.ready = ''
    closeOnBackdrop(viewer)
    viewer.querySelector('[data-photo-close]')!.addEventListener('click', () => viewer.close())
    // A tap on the photo closes it too, as in Photos.
    viewer.querySelector('[data-photo-large]')!.addEventListener('click', () => viewer.close())
  }
}
