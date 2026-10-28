export { normalizeRow, type NodeRow, type Rows, type OpCtx } from './types'
export { createClock, newUuid, type Clock } from './clock'
export { between, ranksBetween, compareRank, isValidRank, DIGITS } from './rank'
export {
  ROOT,
  buildIndex,
  childrenOf,
  siblingsOf,
  flatten,
  visibleRows,
  allRows,
  descendantIds,
  isAncestor,
  depthOf,
  topmost,
  listNumbers,
  allocateRanks,
  isLive,
  compareSiblings,
  type TreeIndex,
  type FlatRow,
} from './tree'
export {
  type Placement,
  placementAfter,
  insertAt,
  insertAfter,
  insertBefore,
  insertAtTop,
  splitNode,
  setText,
  setDone,
  toggleDone,
  setNumbered,
  toggleNumbered,
  setCollapsed,
  toggleCollapsed,
  remove,
  moveNodes,
  indent,
  dedent,
  moveSibling,
  mergeIntoPrev,
  removeDone,
  sweepDone,
} from './ops'
export { parseOutline, insertOutline, toOutline, type OutlineLine, type OutlineFormat } from './paste'
export { testCtx, pad, shape, idOf } from './testing'
export { type LocalStore, createMemoryStore, changedRows } from './sync/store'
export { toWire, fromWire, type WireNode } from './sync/wire'
export {
  createSyncEngine,
  CURSOR_KEY,
  type Remote,
  type PulledRow,
  type SyncEngine,
  type SyncStatus,
  type SyncState,
  type SyncEngineOptions,
} from './sync/engine'
export { createFakeRemote, type FakeRemote } from './sync/fakeRemote'
