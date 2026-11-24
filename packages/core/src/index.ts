export { normalizeRow, sameRow, ROW_KEYS, kindOf, type NodeKind, type NodeRow, type Rows, type OpCtx } from './types'
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
  isBlank,
  countLines,
  headerGaps,
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
  setKind,
  setCollapsed,
  toggleCollapsed,
  remove,
  restore,
  moveNodes,
  indent,
  dedent,
  ungroup,
  moveSibling, moveToTop,
  mergeIntoPrev,
  removeDone,
  sweepDone,
  setSlot,
} from './ops'
export { slotKey, parseSlot, slotCounts, slotLines, slotLabel, todayKey, type SlotCount } from './slot'
export {
  type PadId,
  type Side,
  type Sides,
  isPadNode,
  listPads,
  padLines,
  padCounts,
  scopePad,
  unscopeRow,
  createPad,
  moveToPad,
  moveToPlace,
  isSubPad,
  listSubPads,
  placeOf,
  isPlace,
  MAIN_PLACE,
  type Place,
  movePad,
  lineToPad,
  padToLine,
  resolveSides,
  sendTo,
  sideRows,
  freshStart,
} from './pads'
export { parseOutline, insertOutline, toOutline, toOutlineHtml, type OutlineLine, type OutlineFormat } from './paste'
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
export { resolveDrop, type LayoutRow, type DropTarget, type DropInput } from './drop'
export { inlineSpans, URL_RE, type InlineSpan } from './inline'
