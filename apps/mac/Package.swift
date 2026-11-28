// swift-tools-version:5.9
import PackageDescription

// HissyPad for the Mac: a window around the web app (apps/web), which it carries a copy of
// and keeps current from the live site. HissyPadKit is the part with no window in it, so it
// can be tested.
let package = Package(
  name: "HissyPad",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "HissyPadKit"),
    .executableTarget(name: "HissyPad", dependencies: ["HissyPadKit"]),
    .testTarget(name: "HissyPadKitTests", dependencies: ["HissyPadKit"]),
  ],
  swiftLanguageVersions: [.v5]
)
