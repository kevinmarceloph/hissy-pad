import AppKit
import HissyPadKit
import UserNotifications
import WebKit

// HissyPad for the Mac. One window around the web app, served from a folder on this Mac
// under the app's own scheme (app://hissypad/), so it opens with no network. What the shell
// adds: the menu bar, a link scheme for sign-in (hissypad://), notifications for chimes, and
// a copy of the live site's build fetched in the background (HissyPadKit's Updater).
//
// The page knows it is here by `window.hissypadMac` (apps/web/src/platform/os.ts) and talks
// back through `window.webkit.messageHandlers.hissypad`.

let scheme = "app"
let home = URL(string: "app://hissypad/")!
let paper = NSColor(srgbRed: 0xf7 / 255, green: 0xf4 / 255, blue: 0xec / 255, alpha: 1)
let paperDark = NSColor(srgbRed: 0x1b / 255, green: 0x1a / 255, blue: 0x17 / 255, alpha: 1)

// Serves the build's files for app://hissypad/….
final class Files: NSObject, WKURLSchemeHandler {
  var folder: URL?

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url, let folder,
          let file = fileFor(path: url.path, in: folder),
          let data = try? Data(contentsOf: file) else {
      let gone = HTTPURLResponse(url: task.request.url ?? home, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0"])!
      task.didReceive(gone)
      task.didFinish()
      return
    }
    let headers = ["Content-Type": mimeType(file), "Content-Length": String(data.count), "Cache-Control": "no-cache"]
    task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, UNUserNotificationCenterDelegate {
  private var window: NSWindow!
  private var web: WKWebView!
  private let files = Files()
  private var showing: WebBundle?
  private var waiting: WebBundle?
  private var updater: Updater?
  private var checkedAt = Date.distantPast
  private var loaded = false
  // Links that arrived before the page was up.
  private var links: [URL] = []
  private let env = ProcessInfo.processInfo.environment
  // A check run from the command line (see apps/mac/README.md): no update, no saved data.
  private var probe: String? { env["HISSYPAD_PROBE"] }
  // Notifications need a real app bundle; `swift run` has none.
  private var canNotify: Bool { Bundle.main.bundleIdentifier != nil && probe == nil }

  // ---- launch ----------------------------------------------------------------------------

  func applicationDidFinishLaunching(_ note: Notification) {
    let shipped = (env["HISSYPAD_WEB"].map { URL(fileURLWithPath: $0) } ?? Bundle.main.resourceURL?.appendingPathComponent("web")).flatMap(WebBundle.at)
    if probe == nil, env["HISSYPAD_WEB"] == nil,
       let site = (Bundle.main.object(forInfoDictionaryKey: "HissyPadSite") as? String).flatMap(URL.init(string:)) {
      updater = Updater(site: site, store: Updater.defaultStore())
    }
    showing = WebBundle.pick(shipped: shipped, fetched: updater?.fetched())
    files.folder = showing?.folder

    NSApp.mainMenu = buildMenu()
    buildWindow()
    if canNotify { UNUserNotificationCenter.current().delegate = self }

    if showing == nil {
      web.loadHTMLString("<body style='font: 17px Charter, Georgia, serif; padding: 3rem; background: #f7f4ec; color: #1f1c17'><p>HissyPad has no copy of itself to open yet. It fetches one when this Mac is online: connect, then choose Reload from the View menu.</p></body>", baseURL: nil)
    } else {
      web.load(URLRequest(url: home))
    }
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    checkForUpdate(force: showing == nil)
    if probe != nil { runProbe() }
  }

  private func buildWindow() {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(files, forURLScheme: scheme)
    if probe != nil { config.websiteDataStore = .nonPersistent() }
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    let hello = "window.hissypadMac = { version: \(json(version)), notifications: \(canNotify) }; document.documentElement.classList.add('is-mac');"
    config.userContentController.addUserScript(WKUserScript(source: hello, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "hissypad")

    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = false
    web.setValue(false, forKey: "drawsBackground")
    if #available(macOS 13.3, *) { web.isInspectable = true }
    let zoom = UserDefaults.standard.double(forKey: "zoom")
    if zoom > 0 { web.pageZoom = zoom }

    // The page draws under the title bar: the strip stays the window's handle, so the page
    // keeps its top 28pt free of anything to press (`.is-mac` in styles.css).
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    window.title = "HissyPad"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.backgroundColor = paper
    window.minSize = NSSize(width: 760, height: 480)
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.contentView = web
    window.center()
    window.setFrameAutosaveName("HissyPad")
  }

  // ---- the window stays the app --------------------------------------------------------------

  // Closing the window hides it: the page keeps ringing its chimes, and the Dock brings it back.
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if probe != nil { return true }
    sender.orderOut(nil)
    return false
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    window.makeKeyAndOrderFront(nil)
    return true
  }

  func applicationDidBecomeActive(_ note: Notification) {
    checkForUpdate(force: false)
  }

  // A newer build is put in while nobody is looking at the page.
  func applicationDidResignActive(_ note: Notification) {
    applyWaiting()
  }

  // ---- links ---------------------------------------------------------------------------------

  // hissypad://auth#access_token=…: the way back in from a sign-in in the browser.
  func application(_ application: NSApplication, open urls: [URL]) {
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    for url in urls where url.scheme == "hissypad" {
      if loaded { hand(url) } else { links.append(url) }
    }
  }

  private func hand(_ url: URL) {
    web.evaluateJavaScript("window.hissypadOpen && window.hissypadOpen(\(json(linkParams(url))))", completionHandler: nil)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded = true
    links.forEach(hand)
    links = []
  }

  // Only the app's own pages open in the window. Anything else (a link in a line, the
  // sign-in page of Google) goes to the browser.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    if url.scheme == scheme || url.scheme == "about" || action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
    if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
    return nil
  }

  // The web process can be put down under memory pressure: bring the page back.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    webView.reload()
  }

  // ---- the page talks back -------------------------------------------------------------------

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == scheme,
          let body = message.body as? [String: Any], let type = body["type"] as? String else { return replyHandler(nil, "not understood") }
    switch type {
    case "theme":
      // "light", "dark", or anything else for the system's.
      let theme = body["theme"] as? String
      window.appearance = theme == "dark" ? NSAppearance(named: .darkAqua) : theme == "light" ? NSAppearance(named: .aqua) : nil
      let dark = window.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      window.backgroundColor = dark ? paperDark : paper
      replyHandler(nil, nil)
    case "notifyState":
      notifyState(replyHandler)
    case "notifyAsk":
      guard canNotify else { return replyHandler("denied", nil) }
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { _, _ in self.notifyState(replyHandler) }
    case "notify":
      guard canNotify else { return replyHandler(nil, nil) }
      let content = UNMutableNotificationContent()
      content.title = body["title"] as? String ?? "HissyPad"
      content.body = body["body"] as? String ?? ""
      // One chime replaces the last instead of stacking up.
      let id = body["tag"] as? String ?? UUID().uuidString
      UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
      replyHandler(nil, nil)
    default:
      replyHandler(nil, "not understood")
    }
  }

  private func notifyState(_ reply: @escaping (Any?, String?) -> Void) {
    guard canNotify else { return reply("denied", nil) }
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      let state = settings.authorizationStatus == .notDetermined ? "default" : settings.authorizationStatus == .denied ? "denied" : "granted"
      DispatchQueue.main.async { reply(state, nil) }
    }
  }

  // A chime shows while the app is in front too: the page plays the sound itself.
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .list])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    DispatchQueue.main.async {
      self.window.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      self.web.evaluateJavaScript("location.hash = '#hours'", completionHandler: nil)
    }
    done()
  }

  // ---- updates -------------------------------------------------------------------------------

  private func checkForUpdate(force: Bool, said: Bool = false) {
    guard let updater else {
      if said { say("This copy does not check for updates.", "It was started for a test, or it has no site to ask.") }
      return
    }
    if !force && Date().timeIntervalSince(checkedAt) < 600 { return }
    checkedAt = Date()
    let showingNow = showing?.manifest
    Task { @MainActor in
      do {
        if let next = try await updater.check(showing: showingNow) {
          self.waiting = next
          if force || !NSApp.isActive { self.applyWaiting() }
        } else if said {
          self.say("HissyPad is up to date.", "This is the build the site has.")
        }
      } catch {
        if said { self.say("The update did not come through.", error.localizedDescription) }
      }
    }
  }

  private func applyWaiting() {
    guard let next = waiting else { return }
    waiting = nil
    showing = next
    files.folder = next.folder
    updater?.prune(keeping: [next.manifest.version])
    if web.url?.scheme == scheme { web.reload() } else { web.load(URLRequest(url: home)) }
  }

  private func say(_ title: String, _ text: String) {
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = text
    alert.beginSheetModal(for: window)
  }

  // ---- menus ---------------------------------------------------------------------------------

  private func buildMenu() -> NSMenu {
    let bar = NSMenu()
    func menu(_ title: String, _ fill: (NSMenu) -> Void) {
      let item = NSMenuItem()
      let sub = NSMenu(title: title)
      fill(sub)
      item.submenu = sub
      bar.addItem(item)
    }
    func add(_ menu: NSMenu, _ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, tag: Int = 0) {
      let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
      item.keyEquivalentModifierMask = mods
      item.tag = tag
    }

    menu("HissyPad") { m in
      add(m, "About HissyPad", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
      add(m, "Check for Updates…", #selector(checkNow))
      m.addItem(.separator())
      add(m, "Hide HissyPad", #selector(NSApplication.hide(_:)), "h")
      add(m, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
      add(m, "Show All", #selector(NSApplication.unhideAllApplications(_:)))
      m.addItem(.separator())
      add(m, "Quit HissyPad", #selector(NSApplication.terminate(_:)), "q")
    }
    menu("File") { m in
      add(m, "New Item", #selector(pageCommand(_:)), "n", tag: 0)
      add(m, "Search…", #selector(pageCommand(_:)), "k", tag: 1)
      m.addItem(.separator())
      add(m, "Close Window", #selector(NSWindow.performClose(_:)), "w")
    }
    // The page takes its own keys first (its undo is not the text field's), and these act
    // on what it leaves.
    menu("Edit") { m in
      add(m, "Undo", Selector(("undo:")), "z")
      add(m, "Redo", Selector(("redo:")), "z", [.command, .shift])
      m.addItem(.separator())
      add(m, "Cut", #selector(NSText.cut(_:)), "x")
      add(m, "Copy", #selector(NSText.copy(_:)), "c")
      add(m, "Paste", #selector(NSText.paste(_:)), "v")
      add(m, "Select All", #selector(NSText.selectAll(_:)), "a")
    }
    menu("View") { m in
      for (i, mode) in modes.enumerated() { add(m, mode.title, #selector(showMode(_:)), String(i + 1), tag: i) }
      m.addItem(.separator())
      add(m, "Actual Size", #selector(zoom(_:)), "0", tag: 0)
      add(m, "Zoom In", #selector(zoom(_:)), "+", tag: 1)
      add(m, "Zoom Out", #selector(zoom(_:)), "-", tag: -1)
      m.addItem(.separator())
      add(m, "Reload", #selector(reload), "r")
      add(m, "Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
    }
    menu("Window") { m in
      add(m, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
      add(m, "Zoom", #selector(NSWindow.performZoom(_:)))
      m.addItem(.separator())
      add(m, "HissyPad", #selector(showWindow))
      NSApp.windowsMenu = m
    }
    return bar
  }

  private let modes: [(title: String, hash: String)] = [("Hours", "#hours"), ("Pad", "#pads"), ("Categories", "#categories"), ("Sort", "#sort")]

  @objc private func showMode(_ sender: NSMenuItem) {
    window.makeKeyAndOrderFront(nil)
    web.evaluateJavaScript("location.hash = \(json(modes[sender.tag].hash))", completionHandler: nil)
  }

  // New Item and Search are the page's own: it hears them as an event (app/App.tsx).
  @objc private func pageCommand(_ sender: NSMenuItem) {
    window.makeKeyAndOrderFront(nil)
    let name = sender.tag == 0 ? "new" : "search"
    web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('hissypad:menu', { detail: \(json(name)) }))", completionHandler: nil)
  }

  @objc private func zoom(_ sender: NSMenuItem) {
    let next = sender.tag == 0 ? 1 : min(2, max(0.6, web.pageZoom + CGFloat(sender.tag) * 0.1))
    web.pageZoom = next
    UserDefaults.standard.set(Double(next), forKey: "zoom")
  }

  @objc private func reload() {
    if showing == nil { checkForUpdate(force: true) } else if web.url?.scheme == scheme { web.reload() } else { web.load(URLRequest(url: home)) }
  }

  @objc private func checkNow() {
    checkForUpdate(force: true, said: true)
  }

  @objc private func showWindow() {
    window.makeKeyAndOrderFront(nil)
  }

  // ---- a check from the command line -------------------------------------------------------

  // HISSYPAD_PROBE=<folder> opens the app with no saved data, waits, runs HISSYPAD_PROBE_JS
  // (the body of an async function) in the page, writes what it returned to probe.json and
  // the window to shot.png, and quits.
  private func runProbe() {
    guard let folder = probe.map({ URL(fileURLWithPath: $0, isDirectory: true) }) else { return }
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    if let size = env["HISSYPAD_PROBE_SIZE"]?.split(separator: "x").compactMap({ Double($0) }), size.count == 2 {
      window.setContentSize(NSSize(width: size[0], height: size[1]))
    }
    let wait = Double(env["HISSYPAD_PROBE_WAIT"] ?? "") ?? 3
    let script = env["HISSYPAD_PROBE_JS"] ?? "return { secure: window.isSecureContext, uuid: typeof crypto.randomUUID, idb: typeof indexedDB, title: document.title, text: document.body.innerText.slice(0, 400) }"
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
      self.web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
        var out: Any = NSNull()
        switch result {
        case .success(let value): out = ["ok": value]
        case .failure(let error): out = ["error": "\(error)"]
        }
        let data = (try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .fragmentsAllowed])) ?? Data("{\"error\":\"not json\"}".utf8)
        try? data.write(to: folder.appendingPathComponent("probe.json"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
          self.web.takeSnapshot(with: nil) { image, _ in
            if let tiff = image?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
              try? png.write(to: folder.appendingPathComponent("shot.png"))
            }
            NSApp.terminate(nil)
          }
        }
      }
    }
  }
}

func json(_ value: Any) -> String {
  let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
  return data.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
