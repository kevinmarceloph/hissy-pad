// Siri's own line to the server. "Add to HissyPad" (AppShortcuts.swift) runs without the
// app's JavaScript, so on its own it can only queue the line for the app to add the next
// time it is opened. This sends it straight to Supabase instead, the way the watch sends
// a line typed on it, with the watch's own code (targets/watch/Remote.swift and
// Rows.swift, compiled into the app by plugins/withNativeSources.js).
//
// It needs a session of its own, for the reason the watch does: a refresh token works
// once, so sharing the app's would sign one of them out. The app's JavaScript gets it the
// same way too (src/widget.ts), through the shared defaults:
//   siri.state    {user}: the account this is signed in to, "" for none (written here)
//   siri.handoff  a sign-in as JSON (a Handoff), or "signout" (written by the app; taken
//                 here as soon as it lands)
// The session is in the keychain, on this phone only.
import Foundation
import Security

actor SiriSync {
  static let shared = SiriSync()

  private static let stateKey = "siri.state"
  private static let handoffKey = "siri.handoff"
  private static let installedKey = "siri.installed"

  private var session: Session?
  private var trading: String?

  private init() {
    // A keychain item outlives the app being deleted; the app's own defaults do not. A
    // session found without that mark is from an earlier install: the app is signed out
    // now, so this is too.
    if UserDefaults.standard.bool(forKey: Self.installedKey) {
      session = Keychain.read()
    } else {
      Keychain.write(nil)
      UserDefaults.standard.set(true, forKey: Self.installedKey)
    }
  }

  // From the AppDelegate. The app's JavaScript writes the hand-over into the shared
  // defaults in this same process, which is what the notification is for.
  nonisolated func start() {
    NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: nil) { _ in
      Task { await SiriSync.shared.take() }
    }
    Task { await take() }
  }

  // Take what the app left: a sign-in to trade for a session, or a sign-out.
  func take() async {
    guard let left = Shared.defaults?.string(forKey: Self.handoffKey) else { return report() }
    if left == "signout" {
      Shared.defaults?.removeObject(forKey: Self.handoffKey)
      keep(nil)
      return report()
    }
    if left == trading { return }
    guard let data = left.data(using: .utf8), let offered = try? JSONDecoder().decode(Handoff.self, from: data), session?.user != offered.user else {
      drop(left)
      return report()
    }
    trading = left
    defer { trading = nil }
    do {
      let fresh = try await Remote(url: offered.url, key: offered.key).signIn(token: offered.token)
      // A sign-out, or a newer sign-in, may have landed during the wait: then this one is void.
      guard Shared.defaults?.string(forKey: Self.handoffKey) == left else { return }
      keep(fresh)
      drop(left)
    } catch Remote.Failure.refused {
      drop(left) // used or expired: the app sends another when it sees this still signed out
    } catch {
      // No network. It stays where it is for the next try.
    }
    report()
  }

  // Send a new line to the top of the Inbox (the root level since 2026-11-24), under the id
  // it was queued with. True when the server has it. False (no session, no network, out of
  // time) leaves it to the queue. Siri gives an intent only so long, hence the limit.
  nonisolated func add(id: String, text: String, within seconds: Double = 8) async -> Bool {
    let work = Task { await self.send(id: id, text: text) }
    let limit = Task {
      try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      work.cancel()
    }
    let sent = await work.value
    limit.cancel()
    return sent
  }

  private func send(id: String, text: String) async -> Bool {
    await take()
    guard var s = session else { return false }
    do {
      if s.expires - Date().timeIntervalSince1970 < 60 { s = try await refresh(s) }
      do {
        try await post(id: id, text: text, pad: nil, s)
      } catch Remote.Failure.unauthorized {
        // The token went stale early. One refresh, one more try.
        s = try await refresh(s)
        try await post(id: id, text: text, pad: nil, s)
      }
      return true
    } catch {
      return false
    }
  }

  // Above the first row of the pad, as the server has it now (cmdAddToPad in
  // packages/state/src/widget.ts, PadCopy.add on the watch).
  private func post(id: String, text: String, pad: String?, _ s: Session) async throws {
    let remote = Remote(url: s.url, key: s.key)
    let first = try await remote.ranks(under: pad, access: s.access).min { $0.utf8.lexicographicallyPrecedes($1.utf8) }
    guard let rank = Rank.before(first) else { throw Remote.Failure.refused("No rank above the first line") }
    try await remote.add(AddPatch(id: id, parent: pad, rank: rank, text: text, at: Stamp.now()), access: s.access)
  }

  private func refresh(_ old: Session) async throws -> Session {
    do {
      let fresh = try await Remote(url: old.url, key: old.key).refresh(old)
      guard session == old else { throw Remote.Failure.offline } // signed out meanwhile
      keep(fresh)
      return fresh
    } catch Remote.Failure.refused(let why) {
      // The session is over. The app signs this in again when it sees no account here.
      if session == old {
        keep(nil)
        report()
      }
      throw Remote.Failure.refused(why)
    }
  }

  private func keep(_ fresh: Session?) {
    session = fresh
    Keychain.write(fresh)
  }

  private func drop(_ left: String) {
    if Shared.defaults?.string(forKey: Self.handoffKey) == left { Shared.defaults?.removeObject(forKey: Self.handoffKey) }
  }

  // Tell the app which account this is on. Written only when it changed: every write to
  // the defaults comes back here as a notification.
  private func report() {
    guard let data = try? JSONSerialization.data(withJSONObject: ["user": session?.user ?? ""]), let json = String(data: data, encoding: .utf8) else { return }
    if Shared.defaults?.string(forKey: Self.stateKey) != json { Shared.defaults?.set(json, forKey: Self.stateKey) }
  }
}

// Readable while the phone is locked (after its first unlock): Siri works from the Lock Screen.
private enum Keychain {
  private static let item: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "ph.marcelo.hissypad.siri",
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
