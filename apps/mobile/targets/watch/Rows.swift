// The watch's own copy of the `nodes` table, and what it draws from it. The same rules as
// the apps, in Swift, because the watch cannot run the shared packages:
//   Outline.pads   packages/core/src/tree.ts (buildIndex) + packages/state/src/widget.ts
//                  (widgetSnapshot): which lines are open, in which pad, in what order
//   PadCopy.merge  packages/core/src/sync/engine.ts (pullNew): the newer updated_at wins
//   PadCopy.tick   packages/core/src/clock.ts
//   PadCopy.add    packages/state/src/widget.ts (cmdAddToPad): a new line at the top of a pad
//   Rank.before    packages/core/src/rank.ts (between(null, b))
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

// A line typed here that the server has not been told about yet, as it was when made.
struct AddPatch: Codable, Equatable {
  let id: String
  let parent: String?
  let rank: String
  let text: String
  let at: Int64
}

// Ranks are base-62 strings that sort as plain text (packages/core/src/rank.ts): a head
// letter that says how many digits the whole part has, then those digits, then maybe a
// fraction. The watch only ever needs one above the first line.
enum Rank {
  private static let digits = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".utf8)

  private static func headDigits(_ c: UInt8) -> Int? {
    if c >= 97 && c <= 122 { return Int(c) - 97 + 1 } // a..z
    if c >= 65 && c <= 90 { return 90 - Int(c) + 1 }  // A..Z
    return nil
  }

  // A rank that sorts before `first`: its whole part, less one. "a0" when there is no
  // first. Nil for a rank that cannot be read, or the very bottom of the range.
  static func before(_ first: String?) -> String? {
    guard let first else { return "a0" }
    let bytes = Array(first.utf8)
    guard let head = bytes.first, let n = headDigits(head), bytes.count >= 1 + n else { return nil }
    var whole = Array(bytes[0...n])
    for i in stride(from: n, to: 0, by: -1) {
      guard let d = digits.firstIndex(of: whole[i]) else { return nil }
      if d > 0 {
        whole[i] = digits[d - 1]
        return String(decoding: whole, as: UTF8.self)
      }
      whole[i] = digits[digits.count - 1]
    }
    if head == 65 { return nil }
    let prev: UInt8 = head == 97 ? 90 : head - 1
    return String(decoding: [prev] + Array(repeating: digits[digits.count - 1], count: headDigits(prev) ?? 0), as: UTF8.self)
  }
}

struct PadCopy: Codable {
  let user: String
  var rows: [String: Row] = [:]
  var pending: [DonePatch] = []
  var added: [AddPatch]? // optional: a file written before the watch could add has none
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

  // A new line at the top of a pad (nil for the Inbox, the root level). Returns its id, or
  // nil for blank text.
  mutating func add(_ text: String, pad: String?, now: Int64 = Stamp.now()) -> String? {
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if clean.isEmpty { return nil }
    let live = rows.values.filter { !$0.deleted }
    let ids = Set(live.map(\.id))
    // A pad that is gone meanwhile: the line goes to the Inbox, as cmdAddToPad does.
    let parent = pad.flatMap { ids.contains($0) ? $0 : nil }
    // Everything at that level, crossed out or not; a row whose parent is gone sits at the root.
    let first = live
      .filter { r in parent == nil ? (r.parent.map { !ids.contains($0) } ?? true) : r.parent == parent }
      .map(\.rank)
      .min { $0.utf8.lexicographicallyPrecedes($1.utf8) }
    guard let rank = Rank.before(first) else { return nil }
    let at = tick(now: now)
    let id = UUID().uuidString.lowercased()
    rows[id] = Row(id: id, parent: parent, rank: rank, text: clean, updated: at)
    added = (added ?? []) + [AddPatch(id: id, parent: parent, rank: rank, text: clean, at: at)]
    return id
  }

  // How many changes made here the server has not been told about.
  var unsent: Int { pending.count + (added?.count ?? 0) }

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
  // The fixed tabs, first in this order (FIXED_PADS in core's pads.ts). Inbox is the root
  // level; Today and Later are the first pad rows of those names, case ignored.
  static let fixed = ["Today", "Inbox", "Later"]

  // Every pad with its open top-level lines, top first, in the app's tab order: Today, the
  // Inbox (the root level), Later, then each other row at the root with `pad` set. Open means
  // not crossed out and not a blank spacer.
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
    func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
    // A blank line is not counted (the counting rule, isBlank in core).
    func under(_ id: String) -> Int {
      (children[id] ?? []).reduce(0) { $0 + (trimmed($1.text).isEmpty ? 0 : 1) + under($1.id) }
    }
    func pad(_ id: String?, _ name: String) -> WidgetPad {
      let open = (children[id] ?? []).filter { !$0.pad && !$0.done && (!trimmed($0.text).isEmpty || children[$0.id] != nil) }
      let items = open.map { r -> WidgetItem in
        let line = trimmed(String(r.text.split(separator: "\n", omittingEmptySubsequences: false).first ?? ""))
        return WidgetItem(id: r.id, text: line.count > 140 ? line.prefix(139) + "…" : line, subs: under(r.id))
      }
      return WidgetPad(id: id ?? mainPadId, name: name, count: items.count, items: items)
    }
    let root = children[nil] ?? []
    var taken = Set<String>()
    var fixedPads: [WidgetPad] = []
    for name in fixed {
      if name == "Inbox" {
        fixedPads.append(pad(nil, name))
        continue
      }
      guard let p = root.first(where: { $0.pad && trimmed($0.text).lowercased() == name.lowercased() }) else { continue }
      taken.insert(p.id)
      fixedPads.append(pad(p.id, name))
    }
    let others = root.filter { $0.pad && !taken.contains($0.id) }.map { p -> WidgetPad in
      let name = trimmed(p.text)
      return pad(p.id, name.isEmpty ? "Untitled pad" : name)
    }
    return fixedPads + others
  }
}
