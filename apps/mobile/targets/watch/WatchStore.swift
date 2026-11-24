// What the watch shows, and where it comes from. Two sources:
//
//   its own copy   Once the phone has handed over a sign-in (it does, by itself, the first
//                  time the phone app is open and signed in), the watch keeps every row
//                  and syncs with the server on its own (PadSync), on Wi-Fi or cellular,
//                  with the phone nowhere near. A line typed or crossed out with no
//                  network at all is held here and sent when there is one.
//   the snapshot   Until then (the phone app is not signed in, so there is no server to
//                  talk to), the last snapshot the iPhone sent, as before: a Done goes
//                  back to the phone, at once if it is in reach and otherwise as a
//                  message the system holds until it is. So does a new line.
//
// The copy is a file, the session is in the keychain.
import Foundation
import Security
import WatchConnectivity
import WatchKit

@MainActor
final class WatchStore: NSObject, ObservableObject, WCSessionDelegate {
  static let shared = WatchStore()
  static let refreshTask = "sync" // names the background time asked for in rest()

  @Published private(set) var pads: [WidgetPad] = []
  @Published private(set) var footer = ""
  @Published private(set) var onItsOwn = false // showing its own copy, not the phone's snapshot

  private let sync: PadSync
  private var savedSession: Session?
  private var reported: String? // the account the phone was last told about ("" for none)
  private var timer: Timer?

  // The snapshot source.
  private var snapshot: Snapshot?
  private var snapshotAt: Date?
  private let store = UserDefaults.standard
  private let snapshotKey = "snapshot"
  private let atKey = "snapshotAt"
  private let pendingKey = "pendingDone"
  // Lines crossed out here that the phone has not caught up on. An older snapshot can
  // still arrive after the tap; these are kept out of it so the line does not come back.
  private var pending: Set<String>
  // Lines typed here that no snapshot from the phone has listed yet, newest last. They
  // are put back into an older snapshot that arrives after the typing.
  private let addedKey = "pendingAdd"
  private var added: [QueuedAction] = []

  override private init() {
    let session = Keychain.read()
    savedSession = session
    sync = PadSync(copy: Disk.read(), session: session)
    pending = Set(store.stringArray(forKey: pendingKey) ?? [])
    super.init()
    if let json = store.string(forKey: snapshotKey) { snapshot = Snapshot.decode(json) }
    let at = store.double(forKey: atKey)
    if at > 0 { snapshotAt = Date(timeIntervalSince1970: at) }
    if let data = store.data(forKey: addedKey) { added = (try? JSONDecoder().decode([QueuedAction].self, from: data)) ?? [] }
    sync.changed = { [weak self] in self?.absorb() }
    redraw()
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  func pad(_ id: String) -> WidgetPad? { pads.first { $0.id == id } }

  func done(_ item: WidgetItem) {
    if sync.copy != nil {
      if sync.done(item.id) { kick() }
      return
    }
    pending.insert(item.id)
    store.set(Array(pending), forKey: pendingKey)
    keep(added.filter { $0.id != item.id })
    snapshot?.remove(line: item.id)
    if let json = snapshot?.encoded() { store.set(json, forKey: snapshotKey) }
    redraw()
    send(["id": item.id, "dir": "done"])
  }

  // A new line at the top of a pad. False for blank text.
  func add(_ text: String, to padId: String) -> Bool {
    if sync.copy != nil {
      guard sync.add(text, pad: padId == mainPadId ? nil : padId) else { return false }
      kick()
      return true
    }
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty, snapshot != nil else { return false }
    let action = QueuedAction(id: UUID().uuidString.lowercased(), dir: "add", pad: padId, text: clean)
    keep(added + [action])
    snapshot?.add(action)
    if let json = snapshot?.encoded() { store.set(json, forKey: snapshotKey) }
    redraw()
    send(["id": action.id, "dir": "add", "pad": padId, "text": clean])
    return true
  }

  // Siri on the watch (WatchShortcuts.swift): a new line at the top of the pad named
  // Inbox, then a sync that is waited for, a few seconds at most, because the watch app may
  // be put back to sleep as soon as Siri has its answer. The line is kept here either way.
  // False when no pad here is named Inbox.
  func addToInbox(_ text: String) async -> Bool {
    guard let pad = pads.first(where: { $0.id != mainPadId && $0.name.lowercased() == "inbox" }) else { return false }
    guard add(text, to: pad.id) else { return false }
    guard sync.copy != nil else { return true }
    await withCheckedContinuation { (waiting: CheckedContinuation<Void, Never>) in
      var over = false
      let finish = {
        if over { return }
        over = true
        waiting.resume()
      }
      Task { @MainActor in
        await self.sync.sync()
        finish()
      }
      Task { @MainActor in
        try? await Task.sleep(nanoseconds: 8_000_000_000)
        finish()
      }
    }
    return true
  }

  private func keep(_ actions: [QueuedAction]) {
    added = actions
    if let data = try? JSONEncoder().encode(actions) { store.set(data, forKey: addedKey) }
  }

  // MARK: its own copy

  // Sync now, without waiting for it.
  func kick() {
    Task { await sync.sync() }
  }

  // The app came to the front: sync, keep syncing while it stays there, and ask the phone
  // for a snapshot in case that is still the source.
  func wake() {
    kick()
    askPhone()
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
      Task { @MainActor in WatchStore.shared.kick() }
    }
  }

  // The wrist went down. Ask the system for a little time later: sooner when something
  // typed or crossed out here is still waiting to be sent.
  func rest() {
    timer?.invalidate()
    timer = nil
    guard sync.session != nil else { return }
    let wait: TimeInterval = (sync.copy?.unsent ?? 0) > 0 ? 5 * 60 : 60 * 60
    WKApplication.shared().scheduleBackgroundRefresh(withPreferredDate: Date(timeIntervalSinceNow: wait), userInfo: WatchStore.refreshTask as NSString) { _ in }
  }

  // The system gave that time.
  func background() async {
    await sync.sync()
    rest()
  }

  // Something in the sync changed: keep it, draw it, and tell the phone who is signed in.
  private func absorb() {
    if let copy = sync.copy { Disk.write(copy) } else { Disk.remove() }
    if sync.session != savedSession {
      savedSession = sync.session
      Keychain.write(sync.session)
    }
    redraw()
    report()
  }

  private func redraw() {
    if let copy = sync.copy {
      onItsOwn = true
      pads = Outline.pads(copy.rows)
      let synced = copy.syncedAt.map { "Synced \(Date(timeIntervalSince1970: $0).formatted(date: .omitted, time: .shortened))" } ?? "Not synced yet"
      if sync.session == nil {
        footer = "Open HissyPad on your iPhone to sign in again"
      } else if copy.unsent > 0 {
        footer = "\(copy.unsent) to send. \(synced)"
      } else if sync.problem != nil {
        footer = "Offline. \(synced)"
      } else {
        footer = synced
      }
    } else {
      onItsOwn = false
      pads = snapshot?.pads ?? []
      footer = snapshotAt.map { "From your iPhone, \($0.formatted(date: .omitted, time: .shortened))" } ?? ""
    }
  }

  // The phone signs the watch in when this says nobody is, or somebody else.
  private func report() {
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    let user = sync.session?.user ?? ""
    if user == reported { return }
    do {
      try session.updateApplicationContext(["user": user, "at": Date().timeIntervalSince1970])
      reported = user
    } catch {}
  }

  // MARK: the phone

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

  // Ask the phone for a fresh snapshot, if it is in reach and the watch has no copy.
  private func askPhone() {
    let session = WCSession.default
    guard sync.copy == nil, session.activationState == .activated, session.isReachable else { return }
    session.sendMessage(["ask": "snapshot"], replyHandler: nil, errorHandler: nil)
  }

  private func take(snapshot json: String, at: Double) {
    guard var incoming = Snapshot.decode(json) else { return }
    // A pending line the phone no longer lists has been dealt with; the rest stay hidden.
    let listed = Set(incoming.pads.flatMap { $0.items.map(\.id) })
    // A line typed here that the phone now lists has arrived; the rest are put back.
    keep(added.filter { !listed.contains($0.id) })
    for action in added { incoming.add(action) }
    pending = pending.intersection(listed)
    for id in pending { incoming.remove(line: id) }
    store.set(Array(pending), forKey: pendingKey)
    snapshot = incoming
    snapshotAt = Date(timeIntervalSince1970: at)
    store.set(at, forKey: atKey)
    if let kept = incoming.encoded() { store.set(kept, forKey: snapshotKey) }
    redraw()
  }

  // A sign-in or a sign-out from the phone.
  private func take(signin: String?, signout: Bool) {
    if signout {
      sync.signOut()
    } else if let data = signin?.data(using: .utf8), let handoff = try? JSONDecoder().decode(Handoff.self, from: data) {
      sync.offer(handoff)
      kick()
    }
  }

  nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    let context = session.receivedApplicationContext
    let json = context["snapshot"] as? String
    let at = context["at"] as? Double ?? Date().timeIntervalSince1970
    Task { @MainActor in
      if let json { self.take(snapshot: json, at: at) }
      self.report()
      self.askPhone()
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    guard let json = applicationContext["snapshot"] as? String else { return }
    let at = applicationContext["at"] as? Double ?? Date().timeIntervalSince1970
    Task { @MainActor in self.take(snapshot: json, at: at) }
  }

  nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    let signin = message["signin"] as? String
    let signout = message["signout"] as? Bool == true
    Task { @MainActor in self.take(signin: signin, signout: signout) }
  }

  nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    self.session(session, didReceiveMessage: userInfo)
  }
}

// The copy of the pads, as one JSON file. Readable while the watch is locked (after its
// first unlock), so a sync in the background can use it.
private enum Disk {
  private static var file: URL? {
    guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("pad.json")
  }

  static func read() -> PadCopy? {
    guard let file, let data = try? Data(contentsOf: file) else { return nil }
    return try? JSONDecoder().decode(PadCopy.self, from: data)
  }

  static func write(_ copy: PadCopy) {
    guard let file, let data = try? JSONEncoder().encode(copy) else { return }
    try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  static func remove() {
    if let file { try? FileManager.default.removeItem(at: file) }
  }
}

// The session, in the keychain, on this watch only.
private enum Keychain {
  private static let item: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "ph.marcelo.hissypad.watch",
    kSecAttrAccount as String: "session",
  ]

  static func read() -> Session? {
    var query = item
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var found: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &found) == errSecSuccess, let data = found as? Data else { return nil }
    return try? JSONDecoder().decode(Session.self, from: data)
  }

  static func write(_ session: Session?) {
    SecItemDelete(item as CFDictionary)
    guard let session, let data = try? JSONEncoder().encode(session) else { return }
    var add = item
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(add as CFDictionary, nil)
  }
}
