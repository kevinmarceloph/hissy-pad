// Test helpers shared by this package's tests and the apps' tests: a fresh in-memory
// LocalStore holding an outline, and the store back at its initial state. Call loadPad()
// (or mount the app) afterwards.
import { createMemoryStore, pad } from '@hissypad/core'
import { configureLocalStore, usePad } from './store'
import { useSort } from './sort'

export function resetStore(outline?: string) {
  const mem = createMemoryStore(Object.values(outline ? pad(outline) : {}))
  configureLocalStore(mem)
  usePad.setState({
    all: {}, rows: {}, padId: null, load: 'loading', storageError: null, editing: null,
    selection: [], anchorId: null, focusId: null, past: [], future: [], session: null, sync: null,
  })
  useSort.setState({ left: null, right: null })
  return mem
}
