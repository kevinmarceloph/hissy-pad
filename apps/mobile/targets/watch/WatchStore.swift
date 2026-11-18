// What the watch knows: the last snapshot the iPhone sent, kept on the watch so the pads
// are there without the phone. Crossing a line out removes it here at once and tells the
// phone, at once if it is in reach and otherwise as a message the system holds until it is.
import Foundation
import WatchConnectivity

final class WatchStore: NSObject, ObservableObject, WCSessionDelegate, @unchecked Sendable {
  @Published private(set) var snapshot: Snapshot?
  @Published private(set) var updatedAt: Date?

  private let store = UserDefaults.standard
  private let snapshotKey = "snapshot"
  private let atKey = "snapshotAt"
  private let pendingKey = "pendingDone"
  // Lines crossed out here that the phone has not caught up on. An older snapshot can
  // still arrive after the tap; these are kept out of it so the line does not come back.
  private var pending: Set<String>

  override init() {
    pending = Set(store.stringArray(forKey: pendingKey) ?? [])
    super.init()
    if let json = store.string(forKey: snapshotKey) { snapshot = Snapshot.decode(json) }
    let at = store.double(forKey: atKey)
    if at > 0 { updatedAt = Date(timeIntervalSince1970: at) }
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  var pads: [WidgetPad] { snapshot?.pads ?? [] }

  func pad(_ id: String) -> WidgetPad? { pads.first { $0.id == id } }

  func done(_ item: WidgetItem) {
    pending.insert(item.id)
    store.set(Array(pending), forKey: pendingKey)
    snapshot?.remove(line: item.id)
    persist()
    send(["id": item.id, "dir": "done"])
  }

  // Straight to the phone when it is in reach, which is instant. Otherwise, or if that
  // fails, as a queued transfer: the system keeps it and delivers it when it can.
  private func send(_ message: [String: Any]) {
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    if session.isReachable {
      session.sendMessage(message, replyHandler: nil) { _ in
        session.transferUserInfo(message)
      }
    } else {
      session.transferUserInfo(message)
    }
  }

  // Ask the phone for a fresh copy, if it is in reach right now.
  func refresh() {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { return }
    session.sendMessage(["ask": "snapshot"], replyHandler: nil, errorHandler: nil)
  }

  private func persist() {
    if let json = snapshot?.encoded() { store.set(json, forKey: snapshotKey) }
  }

  private func apply(_ context: [String: Any]) {
    guard let json = context["snapshot"] as? String, var incoming = Snapshot.decode(json) else { return }
    let at = context["at"] as? Double ?? Date().timeIntervalSince1970
    DispatchQueue.main.async {
      // A pending line the phone no longer lists has been dealt with; the rest stay hidden.
      let listed = Set(incoming.pads.flatMap { $0.items.map(\.id) })
      self.pending = self.pending.intersection(listed)
      for id in self.pending { incoming.remove(line: id) }
      self.store.set(Array(self.pending), forKey: self.pendingKey)
      self.snapshot = incoming
      self.updatedAt = Date(timeIntervalSince1970: at)
      self.store.set(at, forKey: self.atKey)
      self.persist()
    }
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    apply(session.receivedApplicationContext)
    refresh()
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(applicationContext)
  }
}
