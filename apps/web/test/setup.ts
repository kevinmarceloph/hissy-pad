import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => cleanup())

// jsdom has no <dialog> methods. Enough of them for the panels: open/close flip the
// attribute (so `open` and role queries work) and the form's method="dialog" submit closes.
if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.show = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
  document.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement
    if (form.getAttribute('method') === 'dialog') {
      e.preventDefault()
      form.closest('dialog')?.close()
    }
  })
}
