// Test helpers shared by this package's tests and the apps' tests: a fresh in-memory
// LocalStore holding an outline, and the store back at its initial state. Call loadPad()
// (or mount the app) afterwards.
import { createMemoryStore, pad } from '@hissypad/core'
import { configureFixedPads, configureLocalStore, usePad } from './store'
import { useSort } from './sort'

// `fixed` turns on the fixed pads (Today, Inbox, Later): off, the root level is the Main pad
// the older tests were written for.
export function resetStore(outline?: string, { fixed = false }: { fixed?: boolean } = {}) {
  configureFixedPads(fixed)
  const mem = createMemoryStore(Object.values(outline ? pad(outline) : {}))
  configureLocalStore(mem)
  usePad.setState({
    all: {}, rows: {}, padId: null, load: 'loading', storageError: null, editing: null,
    selection: [], anchorId: null, focusId: null, past: [], future: [], session: null, sync: null,
  })
  useSort.setState({ left: null }, true)
  return mem
}
