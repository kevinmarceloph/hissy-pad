// The iPhone's end of the watch app. It does two jobs.
//
// Signing the watch in, so it can sync with the server by itself (targets/watch/PadSync.swift):
//   watch -> phone   {user}, as the session's application context: the account the watch
//                    is signed in to, "" for none. Kept under watch.state in the shared
//                    defaults, where the app's JavaScript reads it (src/widget.ts).
//   phone -> watch   {signin: <json>} or {signout: true}. The JavaScript leaves it under
//                    watch.handoff; it is sent on and taken out of the defaults here.
//
// Feeding a watch that has no account to sync with (the phone app is not signed in). It
// cannot read the phone's storage, so the phone hands it the snapshot the widget draws
// from, and takes back the lines crossed out on the watch:
//   phone -> watch   the snapshot, as the session's application context (the watch gets
//                    the latest one whenever it can, and keeps it)
//   watch -> phone   {id, dir: "done"}, sent at once when the phone is in reach, else
//                    queued by the system until it is
// A Done that arrives this way goes into the same queue as a widget button (Shared.done),
// so the app applies it the next time it is in front.
//
// Compiled into the app target by plugins/withNativeSources.js, which also starts it from
// the AppDelegate.
import OSLog
import UIKit
import WatchConnectivity
import WidgetKit

final class WatchBridge: NSObject, WCSessionDelegate, @unchecked Sendable {
  static let shared = WatchBridge()

  private let log = Logger(subsystem: "ph.marcelo.hissypad", category: "watch")
  private var started = false
  private var lastSent: String?
  private var pending: DispatchWorkItem?
  private let stateKey = "watch.state"
  private let handoffKey = "watch.handoff"

  func start() {
    guard !started, WCSession.isSupported() else { return }
    started = true
    WCSession.default.delegate = self
    WCSession.default.activate()
    // The app writes the snapshot into the shared defaults (src/widget.ts). Any write to
    // any defaults in this process lands here; push() sends only when the snapshot changed.
    NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
      self?.pushSoon()
    }
    // And once more as the app leaves the foreground, in case that write is still landing.
    NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
      self?.pushSoon(after: 1)
    }
  }

  private func pushSoon(after delay: TimeInterval = 0.5) {
    pending?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.push() }
    pending = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
  }

  // Hand the watch the current snapshot, if it is not the one it already has. `force`
  // sends it regardless (the watch asked, or was just paired); the stamp makes that a new
  // context, so the watch is told even when the pads did not change.
  func push(force: Bool = false) {
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    // No watch, or no HissyPad on it: nothing to do, and nothing worth logging.
    guard session.isPaired, session.isWatchAppInstalled else {
      Shared.defaults?.removeObject(forKey: handoffKey)
      return
    }
    handOver()
    guard let json = Shared.defaults?.string(forKey: Shared.snapshotKey) else {
      log.debug("push: no snapshot yet")
      return
    }
    if !force, json == lastSent { return }
    do {
      try session.updateApplicationContext(["snapshot": json, "at": Date().timeIntervalSince1970])
      lastSent = json
      log.notice("push: sent \(json.count) bytes")
    } catch {
      log.error("push failed: \(error.localizedDescription, privacy: .public)")
    }
  }

  // Pass on the sign-in (or sign-out) the app left for the watch. Straight away when the
  // watch is in reach; otherwise, or if that fails, as a transfer the system holds.
  private func handOver() {
    guard let left = Shared.defaults?.string(forKey: handoffKey) else { return }
    Shared.defaults?.removeObject(forKey: handoffKey)
    let message: [String: Any] = left == "signout" ? ["signout": true] : ["signin": left]
    let session = WCSession.default
    log.notice("handing the watch a \(left == "signout" ? "sign-out" : "sign-in", privacy: .public)")
    if session.isReachable {
      session.sendMessage(message, replyHandler: nil) { _ in
        session.transferUserInfo(message)
      }
    } else {
      session.transferUserInfo(message)
    }
  }

  // The watch said which account it is signed in to. The app reads this and signs it in
  // when it is not the phone's.
  private func note(_ context: [String: Any]) {
    guard let user = context["user"] as? String else { return }
    guard let data = try? JSONSerialization.data(withJSONObject: ["user": user]), let json = String(data: data, encoding: .utf8) else { return }
    if Shared.defaults?.string(forKey: stateKey) != json { Shared.defaults?.set(json, forKey: stateKey) }
  }

  private func handle(_ message: [String: Any]) {
    if message["ask"] as? String == "snapshot" {
      push(force: true)
      return
    }
    guard let id = message["id"] as? String, message["dir"] as? String == "done" else { return }
    log.notice("done from the watch: \(id, privacy: .public)")
    Shared.done(line: id)
    WidgetCenter.shared.reloadAllTimelines()
    push(force: true)
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    note(session.receivedApplicationContext)
    push(force: true)
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    note(applicationContext)
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate() // a different watch was paired
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    // The watch app was just installed, or the watch paired; or it is gone, and so is
    // what it last said about itself.
    if !session.isPaired || !session.isWatchAppInstalled { Shared.defaults?.removeObject(forKey: stateKey) }
    push(force: true)
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    handle(userInfo)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handle(message)
  }
}
