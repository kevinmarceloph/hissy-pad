import Foundation

// Keeps a copy of the live web app beside the one the app came with, so a push to main
// reaches the Mac app as it reaches the browser. Builds live in
// ~/Library/Application Support/HissyPad/web/<version>; `current` names the one to show.
public final class Updater {
  public let site: URL
  public let store: URL
  private let session: URLSession

  public init(site: URL, store: URL, session: URLSession = Updater.freshSession()) {
    self.site = site
    self.store = store
    self.session = session
  }

  // No cache: files.json and index.html keep their names from one build to the next.
  public static func freshSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = 30
    return URLSession(configuration: config)
  }

  public static func defaultStore() -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("HissyPad/web", isDirectory: true)
  }

  // The build fetched last, if it is whole.
  public func fetched() -> WebBundle? {
    guard let name = try? String(contentsOf: store.appendingPathComponent("current"), encoding: .utf8) else { return nil }
    guard let safe = safePath(name.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
    return WebBundle.at(store.appendingPathComponent(safe, isDirectory: true))
  }

  // Fetch the site's build if it is newer than the one shown. Returns it once every file is
  // on disk, nil when there is nothing newer. A half-fetched build is never shown: `current`
  // is written last.
  public func check(showing: WebManifest?) async throws -> WebBundle? {
    let (data, response) = try await session.data(from: site.appendingPathComponent("files.json"))
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
    let live = try JSONDecoder().decode(WebManifest.self, from: data)
    if let showing, live.version == showing.version || live.built <= showing.built { return nil }
    guard let name = safePath(live.version), !name.contains("/") else { return nil }
    let paths = live.files.compactMap(safePath)
    guard paths.count == live.files.count, paths.contains("index.html") else { return nil }

    let fm = FileManager.default
    let folder = store.appendingPathComponent(name, isDirectory: true)
    let work = store.appendingPathComponent(name + ".part", isDirectory: true)
    try? fm.removeItem(at: work)
    try fm.createDirectory(at: work, withIntermediateDirectories: true)
    for path in paths {
      let (body, got) = try await session.data(from: site.appendingPathComponent(path))
      guard (got as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
      let file = work.appendingPathComponent(path)
      try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try body.write(to: file)
    }
    try data.write(to: work.appendingPathComponent("files.json"))
    try? fm.removeItem(at: folder)
    try fm.moveItem(at: work, to: folder)
    try name.write(to: store.appendingPathComponent("current"), atomically: true, encoding: .utf8)
    return WebBundle.at(folder)
  }

  // Older builds go once another is in use.
  public func prune(keeping: Set<String>) {
    let fm = FileManager.default
    for item in (try? fm.contentsOfDirectory(atPath: store.path)) ?? [] where item != "current" && !keeping.contains(item) {
      try? fm.removeItem(at: store.appendingPathComponent(item))
    }
  }
}
