// Copy with a visible fallback: when the clipboard API is missing or refused (embedded
// webviews, some permission setups), show the text in a dialog the user can copy from.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the dialog
  }
  showCopyDialog(text)
  return false
}

function showCopyDialog(text: string) {
  document.querySelector('dialog.copy-fallback')?.remove()
  const dlg = document.createElement('dialog')
  dlg.className = 'copy-fallback import'
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Copy from here</h2>
      <p>The clipboard was not available, so here is the text. It is already selected.</p>
      <textarea readonly rows="12" aria-label="Text to copy"></textarea>
      <div class="actions"><button type="submit" class="primary">Close</button></div>
    </form>`
  const ta = dlg.querySelector('textarea')!
  ta.value = text
  dlg.addEventListener('close', () => dlg.remove())
  document.body.appendChild(dlg)
  dlg.showModal()
  ta.focus()
  ta.select()
}
