// The iPhone's end of the watch app. The watch cannot read the phone's storage, so the
// phone hands it the same snapshot the widget draws from, and takes back the lines
// crossed out on the watch.
//
//   phone -> watch   the snapshot, as the session's application context (the watch gets
//                    the latest one whenever it can, and keeps it)
//   watch -> phone   {id, dir: "done"}, sent at once when the phone is in reach, else
//                    queued by the system until it is
//
// A Done from the watch goes into the same queue as a widget button (Shared.done), so the
// app applies it the next time it is in front. Compiled into the app target by
// plugins/withNativeSources.js, which also starts it from the AppDelegate.
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
    // No watch, or no HissyPad on it: nothing to do, and nothing worth logging.
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
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
    push(force: true)
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate() // a different watch was paired
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    push(force: true) // the watch app was just installed, or the watch paired
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    handle(userInfo)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handle(message)
  }
}
