// A tapped place thumbnail opens large: one dialog for the whole page,
// filled from the button's `data-photo-zoom` (full-size image URL).

export function setupPhotoZoom(root: ParentNode = document) {
  let dialog = document.querySelector<HTMLDialogElement>('[data-photo-dialog]')
  if (!dialog) {
    dialog = document.createElement('dialog')
    dialog.className = 'photo-dialog'
    dialog.dataset.photoDialog = ''
    dialog.innerHTML =
      '<form method="dialog" class="photo-frame"><button type="submit" class="photo-close" aria-label="Close">✕</button><img class="photo-large" alt="" /></form>'
    document.body.appendChild(dialog)
    const dlg: HTMLDialogElement = dialog
    dlg.addEventListener('click', (event) => {
      if (event.target === dlg) dlg.close()
    })
  }
  const img = dialog.querySelector<HTMLImageElement>('.photo-large')!
  const open = (url: string, label: string) => {
    img.src = url
    img.alt = label
    dialog.showModal()
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-photo-zoom]')) {
    if (button.dataset.photoBound) continue
    button.dataset.photoBound = 'true'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      open(button.dataset.photoZoom!, button.getAttribute('aria-label') ?? '')
    })
  }
}
