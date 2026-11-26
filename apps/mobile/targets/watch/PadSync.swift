// The watch syncing by itself: sign in with what the phone handed over, send the lines
// typed and crossed out here, fetch what changed. One round at a time. It holds no storage and no
// UI: `changed` is called whenever something here is worth saving or redrawing
// (WatchStore does both). Foundation only, so it also runs on a Mac.
import Foundation

@MainActor
final class PadSync {
  private(set) var copy: PadCopy?
  private(set) var session: Session?
  private(set) var handoff: Handoff?
  private(set) var problem: String? // why the last round stopped, if it did
  var changed: () -> Void = {}

  private var running: Task<Void, Never>?
  private var again = false
  private let page = 500

  init(copy: PadCopy?, session: Session?) {
    self.session = session
    // A session without its lines (the file is gone, or is another account's): start clean.
    if let session, copy?.user != session.user {
      self.copy = PadCopy(user: session.user)
    } else {
      self.copy = copy
    }
  }

  // The phone sent a sign-in. Nothing to do if the watch is already that account.
  func offer(_ handoff: Handoff) {
    if session?.user == handoff.user { return }
    self.handoff = handoff
  }

  // The phone signed out: forget the account and its lines.
  func signOut() {
    copy = nil
    session = nil
    handoff = nil
    problem = nil
    changed()
  }

  func done(_ id: String) -> Bool {
    guard copy?.done(id) == true else { return false }
    changed()
    return true
  }

  func add(_ text: String, pad: String?) -> Bool {
    guard copy?.add(text, pad: pad) != nil else { return false }
    changed()
    return true
  }

  func edit(_ id: String, text: String) -> Bool {
    guard copy?.edit(id, text: text) == true else { return false }
    changed()
    return true
  }

  // Runs a round, or waits for the one in flight and has it go once more.
  func sync() async {
    if let running {
      again = true
      await running.value
      return
    }
    let task = Task {
      repeat {
        again = false
        await round()
      } while again
      running = nil
    }
    running = task
    await task.value
  }

  private func signIn(_ offered: Handoff) async throws {
    do {
      let fresh = try await Remote(url: offered.url, key: offered.key).signIn(token: offered.token)
      guard handoff == offered else { return } // signed out, or a newer one came, meanwhile
      handoff = nil
      if copy?.user != fresh.user { copy = PadCopy(user: fresh.user) } // another account: start clean
      session = fresh
      changed()
    } catch Remote.Failure.refused(let why) {
      // Used or expired. The phone sends another when it sees the watch still signed out.
      if handoff == offered { handoff = nil }
      throw Remote.Failure.refused(why)
    }
  }

  private func refresh(_ old: Session) async throws -> Session {
    do {
      let fresh = try await Remote(url: old.url, key: old.key).refresh(old)
      guard session == old else { throw Remote.Failure.offline } // signed out meanwhile
      session = fresh
      changed()
      return fresh
    } catch Remote.Failure.refused(let why) {
      // The session is over. The lines stay, so the watch still shows them and still holds
      // what was crossed out, until the phone signs it in again.
      if session == old {
        session = nil
        changed()
      }
      throw Remote.Failure.refused(why)
    }
  }

  private func round(retry: Bool = true) async {
    do {
      if let handoff { try await signIn(handoff) }
      guard var s = session else { return }
      if s.expires - Date().timeIntervalSince1970 < 60 { s = try await refresh(s) }
      let remote = Remote(url: s.url, key: s.key)
      let mine = { self.copy?.user == s.user && self.session?.user == s.user }

      // New lines first: a line typed and then crossed out here needs to exist before its Done.
      for patch in copy?.added ?? [] {
        do {
          try await remote.add(patch, access: s.access)
        } catch Remote.Failure.refused {
          // The server will never take this one: let it go instead of blocking the rest.
        }
        guard mine() else { return }
        copy?.added?.removeAll { $0 == patch }
        changed()
      }

      for patch in copy?.edited ?? [] {
        do {
          try await remote.edit(patch, access: s.access)
        } catch Remote.Failure.refused {
          // The server will never take this one: let it go instead of blocking the rest.
        }
        guard mine() else { return }
        copy?.edited?.removeAll { $0 == patch }
        changed()
      }

      for patch in copy?.pending ?? [] {
        do {
          try await remote.done(patch, access: s.access)
        } catch Remote.Failure.refused {
          // The server will never take this one: let it go instead of blocking the rest.
        }
        guard mine() else { return }
        copy?.pending.removeAll { $0 == patch }
        changed()
      }

      var since = copy?.since()
      while true {
        let rows = try await remote.pull(since: since, limit: page, access: s.access)
        guard mine() else { return }
        copy?.merge(rows)
        guard rows.count == page, let last = rows.last else { break }
        since = last.synced_at
      }
      copy?.syncedAt = Date().timeIntervalSince1970
      problem = nil
      changed()
    } catch Remote.Failure.unauthorized where retry {
      // The token went stale early. One refresh, one more try.
      if let s = session, (try? await refresh(s)) != nil {
        await round(retry: false)
      } else {
        problem = "Signed out"
        changed()
      }
    } catch {
      switch error {
      case Remote.Failure.offline: problem = "Offline"
      case Remote.Failure.refused(let why): problem = why
      default: problem = "Signed out"
      }
      changed()
    }
  }
}
