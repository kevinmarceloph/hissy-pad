import Foundation

// One build of the web app on disk: a folder holding index.html, its assets and files.json,
// the list the web build writes of what is in it (apps/web/vite.config.ts).
public struct WebManifest: Codable, Equatable {
  public var version: String
  // When it was built, in ms. The later of two builds is the one shown.
  public var built: Double
  public var files: [String]

  public init(version: String, built: Double, files: [String]) {
    self.version = version
    self.built = built
    self.files = files
  }

  public static func read(_ folder: URL) -> WebManifest? {
    guard let data = try? Data(contentsOf: folder.appendingPathComponent("files.json")) else { return nil }
    return try? JSONDecoder().decode(WebManifest.self, from: data)
  }
}

public struct WebBundle: Equatable {
  public var folder: URL
  public var manifest: WebManifest

  public init(folder: URL, manifest: WebManifest) {
    self.folder = folder
    self.manifest = manifest
  }

  // A folder is a build only with its list and its page.
  public static func at(_ folder: URL) -> WebBundle? {
    guard let manifest = WebManifest.read(folder),
          FileManager.default.fileExists(atPath: folder.appendingPathComponent("index.html").path) else { return nil }
    return WebBundle(folder: folder, manifest: manifest)
  }

  // The build to show: the one fetched from the site if it is newer than the one the app
  // came with, else the app's own.
  public static func pick(shipped: WebBundle?, fetched: WebBundle?) -> WebBundle? {
    guard let fetched else { return shipped }
    guard let shipped else { return fetched }
    return fetched.manifest.built > shipped.manifest.built ? fetched : shipped
  }
}

// A path from a list or an address is only ever a file inside the build's folder.
public func safePath(_ path: String) -> String? {
  let parts = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
  if parts.isEmpty || path.hasPrefix("/") || path.contains("\\") { return nil }
  if parts.contains(where: { $0 == ".." || $0 == "." }) { return nil }
  return parts.joined(separator: "/")
}

// The file an address of the app's own scheme means. The page for the root and for any
// address with no file behind it that has no extension (a route of the single page app).
public func fileFor(path: String, in folder: URL) -> URL? {
  let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
  let index = folder.appendingPathComponent("index.html")
  guard !trimmed.isEmpty else { return index }
  guard let safe = safePath(trimmed) else { return nil }
  let file = folder.appendingPathComponent(safe)
  var isFolder: ObjCBool = false
  if FileManager.default.fileExists(atPath: file.path, isDirectory: &isFolder), !isFolder.boolValue { return file }
  return (safe as NSString).pathExtension.isEmpty ? index : nil
}

public func mimeType(_ file: URL) -> String {
  switch file.pathExtension.lowercased() {
  case "html": return "text/html; charset=utf-8"
  case "js", "mjs": return "text/javascript; charset=utf-8"
  case "css": return "text/css; charset=utf-8"
  case "json", "map": return "application/json; charset=utf-8"
  case "webmanifest": return "application/manifest+json; charset=utf-8"
  case "svg": return "image/svg+xml"
  case "png": return "image/png"
  case "jpg", "jpeg": return "image/jpeg"
  case "ico": return "image/x-icon"
  case "woff2": return "font/woff2"
  case "woff": return "font/woff"
  case "wasm": return "application/wasm"
  case "txt": return "text/plain; charset=utf-8"
  default: return "application/octet-stream"
  }
}

// What a link the system handed the app (hissypad://auth#access_token=…) carries for the
// page: the query and the fragment as one flat list. A sign-in's tokens are in the
// fragment, a code in the query.
public func linkParams(_ url: URL) -> [String: String] {
  var out: [String: String] = [:]
  func take(_ text: String?) {
    guard let text, !text.isEmpty, let parts = URLComponents(string: "x://x?" + text)?.queryItems else { return }
    for item in parts { out[item.name] = item.value ?? "" }
  }
  let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
  take(parts?.percentEncodedQuery)
  take(parts?.percentEncodedFragment)
  return out
}
