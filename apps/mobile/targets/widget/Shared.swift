// What the widget and the app pass each other, through the App Group's UserDefaults.
// Two JSON strings, written by the app in apps/mobile/src/widget.ts and shaped by
// packages/state/src/widget.ts:
//   widget.snapshot  every pad with its open top-level lines (the app writes it; the
//                    widget edits it in place after a button, so it redraws at once)
//   widget.actions   what happened outside the app since it was last in front: buttons
//                    pressed on the widget, lines added through Siri that Siri could not
//                    send to the server itself (appended here; the app applies them and
//                    clears the list)
//   widget.open      a link for the app to follow when it next comes to the front, left
//                    by the Add control ("add?pad=inbox"); the app clears it
// The shapes are in targets/_shared/Models.swift. This file is compiled into the widget
// and, through plugins/withNativeSources.js, into the app itself, where the Siri shortcut
// and the watch bridge use it.
import Foundation

let appGroup = "group.ph.marcelo.hissypad"

enum Shared {
  static let snapshotKey = "widget.snapshot"
  static let actionsKey = "widget.actions"
  static let openKey = "widget.open"
  static let maxItems = 25

  static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

  static func snapshot() -> Snapshot? {
    guard let text = defaults?.string(forKey: snapshotKey) else { return nil }
    return Snapshot.decode(text)
  }

  static func save(_ snapshot: Snapshot) {
    guard let text = snapshot.encoded() else { return }
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
      let moved = snap.remove(line: line)
      let target = dir == "left" ? snap.left : snap.right
      if dir != "up", let item = moved, let i = snap.pads.firstIndex(where: { $0.name == target }) {
        snap.pads[i].count += 1
        if snap.pads[i].items.count < maxItems { snap.pads[i].items.append(item) }
      }
      save(snap)
    }
    enqueue(QueuedAction(id: line, dir: dir))
  }

  // A new line for the Inbox, typed outside the app (Siri, Shortcuts). It gets its id
  // here, so the widget can show it at once and its buttons work on it before the app has
  // run. If there is no Inbox pad yet, the snapshot gets a stand-in for the one the app
  // will make. Returns the id.
  @discardableResult
  static func add(text: String) -> String {
    let id = UUID().uuidString.lowercased()
    let item = WidgetItem(id: id, text: String(text.prefix(140)), subs: 0)
    if var snap = snapshot() {
      if let i = snap.pads.firstIndex(where: { $0.name.lowercased() == "inbox" && $0.id != mainPadId }) {
        snap.pads[i].items.insert(item, at: 0)
        snap.pads[i].items = Array(snap.pads[i].items.prefix(maxItems))
        snap.pads[i].count += 1
      } else {
        snap.pads.append(WidgetPad(id: inboxKey, name: "Inbox", count: 1, items: [item]))
        snap.inbox = inboxKey
      }
      save(snap)
    }
    enqueue(QueuedAction(id: id, dir: "add", pad: inboxKey, text: text))
    return id
  }

  // The Inbox pad's row id, when the app has one and has said so: the snapshot's `inbox`,
  // which is the fixed Inbox (findFixedPad in core, the first pad of that name in root
  // order), else the first pad listed with that name. Nil when the pad is still to be made
  // (or is only the stand-in above): making it is the app's job.
  static func inboxPad() -> String? {
    guard let snap = snapshot() else { return nil }
    let real = { (id: String) in id != mainPadId && id != inboxKey }
    if real(snap.inbox), snap.pads.contains(where: { $0.id == snap.inbox }) { return snap.inbox }
    return snap.pads.first { $0.name.lowercased() == "inbox" && real($0.id) }?.id
  }

  // A queued new line reached the server by itself (native/SiriSync.swift), so the app has
  // nothing to add: it will get the line when it syncs. Take it out of the queue. If the
  // app applied it meanwhile, it made the same row under the same id.
  static func sent(id: String) {
    guard let text = defaults?.string(forKey: actionsKey), let data = text.data(using: .utf8),
      let queue = try? JSONDecoder().decode([QueuedAction].self, from: data) else { return }
    let rest = queue.filter { !($0.dir == "add" && $0.id == id) }
    if rest.count == queue.count { return }
    guard let kept = try? JSONEncoder().encode(rest), let json = String(data: kept, encoding: .utf8) else { return }
    defaults?.set(json, forKey: actionsKey)
  }

  // A new line typed on the watch, for the pad it was typed in, with the id the watch
  // gave it. The app adds it for real when it next opens.
  static func add(id: String, pad: String, text: String) {
    let action = QueuedAction(id: id, dir: "add", pad: pad, text: text)
    if var snap = snapshot() {
      snap.add(action, max: maxItems)
      save(snap)
    }
    enqueue(action)
  }

  // A line crossed out on the watch: it leaves the lists (they hold open lines only) and
  // the app crosses it out for real, where it is, when it next opens.
  static func done(line: String) {
    if var snap = snapshot() {
      snap.remove(line: line)
      save(snap)
    }
    enqueue(QueuedAction(id: line, dir: "done"))
  }
}
