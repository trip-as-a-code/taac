// Sheets (modal <dialog>s) close on a tap outside them. A tap on a sheet's
// own padding also lands on the <dialog> itself, so where it landed decides.

export function closeOnBackdrop(dialog: HTMLDialogElement) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return
    const box = dialog.getBoundingClientRect()
    const inside =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
    if (!inside) dialog.close()
  })
}
