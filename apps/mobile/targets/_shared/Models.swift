// The shapes the app, the widget and the watch pass around, as JSON. Files in
// targets/_shared are compiled into every target and into the app itself, so there is one
// definition. They mirror packages/state/src/widget.ts: change both together.
import Foundation

let mainPadId = "main"
let inboxKey = "inbox" // "the Inbox": the root level, the same as mainPadId since 2026-11-24

struct WidgetItem: Codable, Identifiable, Hashable {
  let id: String
  let text: String
  let subs: Int // lines under it
  var state: String? // "doing" or "done"; nil for an open line
  var depth: Int?    // in an hour: how far under one of the hour's lines; nil for the line itself

  var isDone: Bool { state == "done" }
}

struct WidgetPad: Codable, Identifiable, Hashable {
  let id: String // mainPadId or a pad's row id
  let name: String
  var count: Int // open top-level lines, which may be more than `items` holds
  var items: [WidgetItem] // the pad's lines as it reads, the crossed-out ones still in place

  var open: [WidgetItem] { items.filter { !$0.isDone } }
}

// A category as a widget draws it: its color comes as hex, one per scheme.
struct WidgetCategory: Codable, Hashable {
  let label: String
  let icon: String // one emoji, or ""
  let light: String
  let dark: String
}

// One hour of a day: the lines put in it, each followed by what is under it.
struct WidgetHour: Codable, Hashable {
  var items: [WidgetItem]
  var category: WidgetCategory? // the category of the hour's first line
}

struct Snapshot: Codable {
  let v: Int
  var pads: [WidgetPad]
  var inbox: String // the pad to show until one is picked
  let left: String  // where "Later" sends a line, by name
  let right: String // where "Today" and "Done" send it
  var hours: [String: WidgetHour]? // the coming hours that have lines, by "YYYY-MM-DDTHH" (local time)

  static func decode(_ json: String) -> Snapshot? {
    guard let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
  }

  func encoded() -> String? {
    guard let data = try? JSONEncoder().encode(self) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  // Take a line out of whichever pad lists it. Returns it, or nil if no pad did.
  @discardableResult
  mutating func remove(line: String) -> WidgetItem? {
    var found: WidgetItem?
    for i in pads.indices {
      if let at = pads[i].items.firstIndex(where: { $0.id == line }) {
        let item = pads[i].items.remove(at: at)
        if !item.isDone { pads[i].count = max(0, pads[i].count - 1) }
        found = item
      }
    }
    return found
  }

  // The state of a line ("open", "doing" or "done"), or nil if nothing here lists it.
  func state(of line: String) -> String? {
    let lists = pads.map(\.items) + (hours ?? [:]).values.map(\.items)
    for items in lists {
      if let item = items.first(where: { $0.id == line }) { return item.state ?? "open" }
    }
    return nil
  }

  // Put a line in a state wherever it is listed, in its pad and in its hours. It stays
  // where it is: a crossed-out line is drawn crossed out, and no longer counted.
  mutating func set(line: String, state: String) {
    let stored: String? = state == "open" ? nil : state
    for i in pads.indices {
      guard let at = pads[i].items.firstIndex(where: { $0.id == line }) else { continue }
      let was = pads[i].items[at].isDone
      pads[i].items[at].state = stored
      if was != (state == "done") { pads[i].count = max(0, pads[i].count + (was ? 1 : -1)) }
    }
    guard var all = hours else { return }
    for key in all.keys {
      if let at = all[key]!.items.firstIndex(where: { $0.id == line }) { all[key]!.items[at].state = stored }
    }
    hours = all
  }

  // What the watch lists: the open lines only, and nothing of the hours.
  mutating func openOnly() {
    for i in pads.indices { pads[i].items = pads[i].open }
    hours = nil
  }

  // Show a line added outside the app at the top of its pad, before the app has made it.
  // Nothing happens if no pad here has that id.
  mutating func add(_ action: QueuedAction, max: Int? = nil) {
    guard let text = action.text, let i = pads.firstIndex(where: { $0.id == action.pad }) else { return }
    pads[i].items.insert(WidgetItem(id: action.id, text: String(text.prefix(140)), subs: 0), at: 0)
    if let max { pads[i].items = Array(pads[i].items.prefix(max)) }
    pads[i].count += 1
  }
}

// Something done outside the app, waiting for the app to apply it.
struct QueuedAction: Codable {
  let id: String
  let dir: String  // "left", "right", "up", "done", "state" or "add"
  var pad: String? // for "add": a pad id, or inboxKey
  var text: String? // for "add": the new line
  var state: String? // for "state": "open", "doing" or "done"
}
