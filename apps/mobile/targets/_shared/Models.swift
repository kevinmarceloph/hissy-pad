// The shapes the app, the widget and the watch pass around, as JSON. Files in
// targets/_shared are compiled into every target and into the app itself, so there is one
// definition. They mirror packages/state/src/widget.ts: change both together.
import Foundation

let mainPadId = "main"
let inboxKey = "inbox" // "the pad named Inbox, made by the app if there is none"

struct WidgetItem: Codable, Identifiable, Hashable {
  let id: String
  let text: String
  let subs: Int // lines under it
}

struct WidgetPad: Codable, Identifiable, Hashable {
  let id: String // mainPadId or a pad's row id
  let name: String
  var count: Int // open top-level lines, which may be more than `items` holds
  var items: [WidgetItem]
}

struct Snapshot: Codable {
  let v: Int
  var pads: [WidgetPad]
  var inbox: String // the pad to show until one is picked
  let left: String  // where "Later" sends a line, by name
  let right: String // where "Today" and "Done" send it

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
        found = pads[i].items.remove(at: at)
        pads[i].count = max(0, pads[i].count - 1)
      }
    }
    return found
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
  let dir: String  // "left", "right", "up", "done" or "add"
  var pad: String? // for "add": a pad id, or inboxKey
  var text: String? // for "add": the new line
}
