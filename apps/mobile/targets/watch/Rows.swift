// The watch's own copy of the `nodes` table, and what it draws from it. The same rules as
// the apps, in Swift, because the watch cannot run the shared packages:
//   Outline.pads   packages/core/src/tree.ts (buildIndex) + packages/state/src/widget.ts
//                  (widgetSnapshot): which lines are open, in which pad, in what order
//   PadCopy.merge  packages/core/src/sync/engine.ts (pullNew): the newer updated_at wins
//   PadCopy.tick   packages/core/src/clock.ts
// Change them together. Foundation only, so this file also compiles and runs on a Mac.
import Foundation

// Timestamps: ISO strings on the wire, whole milliseconds here (what the apps compare).
enum Stamp {
  private static let plain: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
  }()
  private static let millis: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()

  // Postgres writes zero to six fraction digits ("…:53+00:00", "…:53.6+00:00",
  // "…:53.605171+00:00"). The fraction is read by hand and cut to milliseconds, as a
  // JavaScript Date does.
  static func ms(_ iso: String) -> Int64? {
    var text = iso
    var fraction: Int64 = 0
    if let dot = text.firstIndex(of: ".") {
      let end = text[dot...].dropFirst().firstIndex { !$0.isNumber } ?? text.endIndex
      let digits = text[text.index(after: dot)..<end].prefix(3)
      fraction = Int64(digits.padding(toLength: 3, withPad: "0", startingAt: 0)) ?? 0
      text.removeSubrange(dot..<end)
    }
    guard let date = plain.date(from: text) else { return nil }
    return Int64((date.timeIntervalSince1970 * 1000).rounded()) + fraction
  }

  static func iso(_ ms: Int64) -> String {
    millis.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
  }

  static func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

// A row as PostgREST sends it. Only the columns the watch reads.
struct WireRow: Decodable {
  static let columns = "id,parent_id,rank,text,done,pad,updated_at,deleted_at,synced_at"
  let id: String
  let parent_id: String?
  let rank: String
  let text: String
  let done: Bool
  let pad: Bool?
  let updated_at: String
  let deleted_at: String?
  let synced_at: String
}

// A row as the watch keeps it.
struct Row: Codable, Equatable {
  let id: String
  var parent: String?
  var rank: String
  var text: String
  var done: Bool
  var pad: Bool
  var deleted: Bool
  var updated: Int64

  init(id: String, parent: String? = nil, rank: String, text: String, done: Bool = false, pad: Bool = false, deleted: Bool = false, updated: Int64) {
    self.id = id; self.parent = parent; self.rank = rank; self.text = text
    self.done = done; self.pad = pad; self.deleted = deleted; self.updated = updated
  }

  init?(_ w: WireRow) {
    guard let updated = Stamp.ms(w.updated_at) else { return nil }
    self.init(id: w.id, parent: w.parent_id, rank: w.rank, text: w.text, done: w.done, pad: w.pad == true, deleted: w.deleted_at != nil, updated: updated)
  }
}

// A line crossed out here that the server has not been told about yet. `at` is both its
// done_at and its updated_at.
struct DonePatch: Codable, Equatable {
  let id: String
  let at: Int64
}

struct PadCopy: Codable {
  let user: String
  var rows: [String: Row] = [:]
  var pending: [DonePatch] = []
  var cursor: String?    // the newest synced_at fetched, as the server wrote it
  var clock: Int64 = 0   // the latest timestamp made or seen here
  var syncedAt: Double?  // when a sync last went all the way through

  init(user: String) { self.user = user }

  // The next timestamp for an edit made here: the wall clock, but never at or below one
  // already made or seen, so the edit is not thrown away as the older write.
  mutating func tick(now: Int64 = Stamp.now()) -> Int64 {
    clock = max(now, clock + 1)
    return clock
  }

  // Cross a line out. False if it is gone or already crossed out.
  mutating func done(_ id: String, now: Int64 = Stamp.now()) -> Bool {
    guard var row = rows[id], !row.deleted, !row.done else { return false }
    let at = tick(now: now)
    row.done = true
    row.updated = at
    rows[id] = row
    pending.append(DonePatch(id: id, at: at))
    return true
  }

  // Take in rows fetched from the server, oldest synced_at first. A row wins when it is
  // newer than the copy here. A line crossed out here and not sent yet stays crossed out
  // if that is the newer change, which is also what the server will decide.
  mutating func merge(_ page: [WireRow]) {
    for wire in page {
      guard let row = Row(wire) else { continue }
      clock = max(clock, row.updated)
      if let mine = rows[row.id], mine.updated >= row.updated { continue }
      rows[row.id] = row
    }
    for patch in pending {
      guard var row = rows[patch.id], patch.at > row.updated else { continue }
      row.done = true
      row.updated = patch.at
      rows[patch.id] = row
    }
    if let last = page.last { cursor = last.synced_at }
  }

  // Where the next fetch starts: a little before the cursor, so a row the server stamped
  // just ahead of a slower write is still seen. Fetching a row twice does nothing.
  func since(slack: Int64 = 10_000) -> String? {
    guard let cursor, let ms = Stamp.ms(cursor) else { return nil }
    return Stamp.iso(ms - slack)
  }
}

enum Outline {
  // Every pad with its open top-level lines, top first: Main (the root level), then each
  // row at the root with `pad` set. Open means not crossed out and not a blank spacer.
  static func pads(_ rows: [String: Row]) -> [WidgetPad] {
    let live = rows.values.filter { !$0.deleted }
    let ids = Set(live.map(\.id))
    // A row whose parent is missing or deleted sits at the root.
    var parentOf: [String: String?] = [:]
    for r in live { parentOf[r.id] = r.parent.flatMap { ids.contains($0) ? $0 : nil } }
    // Two devices can move a under b and b under a: cut the loop where the walk meets it.
    var settled = Set<String>()
    for r in live {
      var path: [String] = []
      var onPath = Set<String>()
      var cur: String? = r.id
      while let id = cur, !settled.contains(id) {
        if onPath.contains(id) {
          parentOf[id] = .some(nil)
          break
        }
        onPath.insert(id)
        path.append(id)
        cur = parentOf[id] ?? nil
      }
      settled.formUnion(path)
    }
    var children: [String?: [Row]] = [:]
    for r in live { children[parentOf[r.id] ?? nil, default: []].append(r) }
    // Rank, then id, compared byte by byte like the apps and Postgres do.
    for key in children.keys {
      children[key]!.sort { a, b in
        if a.rank != b.rank { return a.rank.utf8.lexicographicallyPrecedes(b.rank.utf8) }
        return a.id.utf8.lexicographicallyPrecedes(b.id.utf8)
      }
    }
    func under(_ id: String) -> Int {
      (children[id] ?? []).reduce(0) { $0 + 1 + under($1.id) }
    }
    func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
    func pad(_ id: String?, _ name: String) -> WidgetPad {
      let open = (children[id] ?? []).filter { !$0.pad && !$0.done && (!trimmed($0.text).isEmpty || children[$0.id] != nil) }
      let items = open.map { r -> WidgetItem in
        let line = trimmed(String(r.text.split(separator: "\n", omittingEmptySubsequences: false).first ?? ""))
        return WidgetItem(id: r.id, text: line.count > 140 ? line.prefix(139) + "…" : line, subs: under(r.id))
      }
      return WidgetPad(id: id ?? mainPadId, name: name, count: items.count, items: items)
    }
    let others = (children[nil] ?? []).filter(\.pad)
    return [pad(nil, "Main")] + others.map { p in
      let name = trimmed(p.text)
      return pad(p.id, name.isEmpty ? "Untitled pad" : name)
    }
  }
}
