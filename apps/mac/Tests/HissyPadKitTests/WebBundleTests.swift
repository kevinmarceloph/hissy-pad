import XCTest
@testable import HissyPadKit

final class WebBundleTests: XCTestCase {
  private var folder: URL!

  override func setUpWithError() throws {
    folder = FileManager.default.temporaryDirectory.appendingPathComponent("hissypad-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: folder.appendingPathComponent("assets"), withIntermediateDirectories: true)
    try "<html>".write(to: folder.appendingPathComponent("index.html"), atomically: true, encoding: .utf8)
    try "x".write(to: folder.appendingPathComponent("assets/app.js"), atomically: true, encoding: .utf8)
  }

  override func tearDown() {
    try? FileManager.default.removeItem(at: folder)
  }

  func testSafePathKeepsFilesInsideTheFolder() {
    XCTAssertEqual(safePath("assets/app.js"), "assets/app.js")
    XCTAssertNil(safePath("../secret"))
    XCTAssertNil(safePath("assets/../../secret"))
    XCTAssertNil(safePath("/etc/passwd"))
    XCTAssertNil(safePath(""))
  }

  func testAnAddressMeansAFileOrThePage() {
    XCTAssertEqual(fileFor(path: "/", in: folder)?.lastPathComponent, "index.html")
    XCTAssertEqual(fileFor(path: "/assets/app.js", in: folder)?.lastPathComponent, "app.js")
    XCTAssertEqual(fileFor(path: "/some/route", in: folder)?.lastPathComponent, "index.html")
    XCTAssertNil(fileFor(path: "/assets/gone.js", in: folder))
    XCTAssertNil(fileFor(path: "/../index.html", in: folder))
  }

  func testTheNewerBuildIsShown() throws {
    let old = WebBundle(folder: folder, manifest: WebManifest(version: "a", built: 1, files: []))
    let new = WebBundle(folder: folder, manifest: WebManifest(version: "b", built: 2, files: []))
    XCTAssertEqual(WebBundle.pick(shipped: old, fetched: new), new)
    XCTAssertEqual(WebBundle.pick(shipped: new, fetched: old), new)
    XCTAssertEqual(WebBundle.pick(shipped: old, fetched: nil), old)
    XCTAssertEqual(WebBundle.pick(shipped: nil, fetched: new), new)
    XCTAssertNil(WebBundle.pick(shipped: nil, fetched: nil))
  }

  func testAFolderIsABuildOnlyWithItsList() throws {
    XCTAssertNil(WebBundle.at(folder))
    let list = WebManifest(version: "abc", built: 5, files: ["index.html", "assets/app.js"])
    try JSONEncoder().encode(list).write(to: folder.appendingPathComponent("files.json"))
    XCTAssertEqual(WebBundle.at(folder)?.manifest, list)
  }

  func testASignInLinkCarriesItsTokens() {
    let link = URL(string: "hissypad://auth#access_token=aa.bb&refresh_token=cc&type=magiclink")!
    XCTAssertEqual(linkParams(link)["access_token"], "aa.bb")
    XCTAssertEqual(linkParams(link)["refresh_token"], "cc")
    XCTAssertEqual(linkParams(URL(string: "hissypad://auth?code=xyz")!)["code"], "xyz")
    XCTAssertEqual(linkParams(URL(string: "hissypad://auth#error_description=Link%20expired")!)["error_description"], "Link expired")
  }

  func testTheFetchedBuildIsReadFromCurrent() throws {
    let updater = Updater(site: URL(string: "https://example.invalid")!, store: folder)
    XCTAssertNil(updater.fetched())
    let build = folder.appendingPathComponent("v1")
    try FileManager.default.createDirectory(at: build, withIntermediateDirectories: true)
    try "<html>".write(to: build.appendingPathComponent("index.html"), atomically: true, encoding: .utf8)
    try JSONEncoder().encode(WebManifest(version: "v1", built: 9, files: ["index.html"])).write(to: build.appendingPathComponent("files.json"))
    try "v1\n".write(to: folder.appendingPathComponent("current"), atomically: true, encoding: .utf8)
    XCTAssertEqual(updater.fetched()?.manifest.version, "v1")
    updater.prune(keeping: ["v1"])
    XCTAssertTrue(FileManager.default.fileExists(atPath: build.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent("assets").path))
  }
}
