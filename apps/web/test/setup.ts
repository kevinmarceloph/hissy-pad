import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// The app opens on Hours when the address has no mode in it; the tests are about the pad
// unless they set a hash of their own.
beforeEach(() => {
  history.replaceState(null, '', '/#pads')
})

afterEach(() => {
  cleanup()
})

// jsdom has no <dialog> behaviour: the open attribute stands in for showModal/close.
const dlg = globalThis.HTMLDialogElement?.prototype
if (dlg && typeof dlg.showModal !== 'function') {
  dlg.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  dlg.show = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  dlg.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
// A form with method="dialog" closes its dialog on submit (the panels' Close buttons).
document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement
  if (form.getAttribute('method') === 'dialog') {
    e.preventDefault()
    form.closest('dialog')?.close()
  }
})
