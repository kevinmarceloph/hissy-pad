# @hissypad/core

Platform-neutral HissyPad core. Pure TypeScript, no build step, no React, no platform
APIs. `apps/web` and `apps/mobile` import it as source.

| module | what |
|---|---|
| `types.ts` | `NodeRow` (one row of the `nodes` table), `Rows` (the client's local copy, keyed by id), `OpCtx` |
| `clock.ts` | `createClock`: monotonic timestamps for last-write-wins; `newUuid` |
| `rank.ts` | fractional indexing, `between(a, b)` and `ranksBetween(a, b, n)`; plain string order |
| `tree.ts` | `buildIndex(rows)` derives the tree (orphans and cycles repaired to the root), `flatten`, `topmost`, ancestry helpers |
| `ops.ts` | every edit: insert, split, text, done, collapse, remove (tombstones), `moveNodes`, `indent`, `dedent`, `moveSibling`, `mergeIntoPrev`, `sweepDone` |
| `paste.ts` | `parseOutline` (Google Docs plain text in), `insertOutline`, `toOutline` (plain text out) |
| `testing.ts` | `testCtx`, `pad(outline)`, `shape(rows)`, `idOf` for tests in any package |

Every op is `(rows, ctx, ...) => rows`, pure, with structural sharing. Bulk ops take a set
of ids and act on the topmost ones, carrying descendants along. Sync (phase 3) only ever
sees rows whose `updatedAt` advanced.

```bash
pnpm test        # vitest, includes a 500-run random-op invariant check
pnpm typecheck
```
