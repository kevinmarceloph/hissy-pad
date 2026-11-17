// What the widget and the app pass each other, through the App Group's UserDefaults.
// Two JSON strings, written by the app in apps/mobile/src/widget.ts and shaped by
// packages/state/src/widget.ts:
//   widget.snapshot  every pad with its open top-level lines (the app writes it; the
//                    widget edits it in place after a button, so it redraws at once)
//   widget.actions   the buttons pressed since the app was last in front (the widget
//                    appends; the app applies them and clears the list)
import Foundation

let appGroup = "group.ph.marcelo.hissypad"
let mainPadId = "main"

struct WidgetItem: Codable, Identifiable, Hashable {
  let id: String
  let text: String
  let subs: Int
}

struct WidgetPad: Codable, Identifiable, Hashable {
  let id: String
  let name: String
  var count: Int
  var items: [WidgetItem]
}

struct Snapshot: Codable {
  let v: Int
  var pads: [WidgetPad]
  let inbox: String
  let left: String
  let right: String
}

struct QueuedAction: Codable {
  let id: String
  let dir: String
}

enum Shared {
  static let snapshotKey = "widget.snapshot"
  static let actionsKey = "widget.actions"
  static let maxItems = 12

  static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

  static func snapshot() -> Snapshot? {
    guard let text = defaults?.string(forKey: snapshotKey), let data = text.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
  }

  static func save(_ snapshot: Snapshot) {
    guard let data = try? JSONEncoder().encode(snapshot), let text = String(data: data, encoding: .utf8) else { return }
    defaults?.set(text, forKey: snapshotKey)
  }

  static func enqueue(_ action: QueuedAction) {
    var queue: [QueuedAction] = []
    if let text = defaults?.string(forKey: actionsKey), let data = text.data(using: .utf8) {
      queue = (try? JSONDecoder().decode([QueuedAction].self, from: data)) ?? []
    }
    queue.append(action)
    guard let data = try? JSONEncoder().encode(queue), let text = String(data: data, encoding: .utf8) else { return }
    defaults?.set(text, forKey: actionsKey)
  }

  // A button was pressed on `line`: take it out of the pad it is in and, unless it was
  // crossed out, put it at the bottom of the pad it went to, so every widget shows the
  // result before the app has run. The app does the real move when it next opens.
  static func send(line: String, dir: String) {
    if var snap = snapshot() {
      var moved: WidgetItem?
      for i in snap.pads.indices {
        if let at = snap.pads[i].items.firstIndex(where: { $0.id == line }) {
          moved = snap.pads[i].items.remove(at: at)
          snap.pads[i].count = max(0, snap.pads[i].count - 1)
        }
      }
      let target = dir == "left" ? snap.left : snap.right
      if dir != "up", let item = moved, let i = snap.pads.firstIndex(where: { $0.name == target }) {
        snap.pads[i].count += 1
        if snap.pads[i].items.count < maxItems { snap.pads[i].items.append(item) }
      }
      save(snap)
    }
    enqueue(QueuedAction(id: line, dir: dir))
  }
}
