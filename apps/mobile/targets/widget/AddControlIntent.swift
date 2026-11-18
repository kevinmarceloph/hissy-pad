// What the "Add to Inbox" Control runs. A Control cannot take typing, so it opens the app;
// the system runs an app-opening intent inside the app, which is why this file is compiled
// into both the widget and the app (plugins/withNativeSources.js). It leaves a note in the
// shared storage and the app (src/widget.ts) shows the "Add to Inbox" prompt when it
// finds it.
import AppIntents

@available(iOS 18.0, *)
struct AddControlIntent: AppIntent {
  static let title: LocalizedStringResource = "Add to Inbox"
  static let isDiscoverable = false
  static let openAppWhenRun = true

  func perform() async throws -> some IntentResult {
    Shared.defaults?.set("add?pad=\(inboxKey)", forKey: Shared.openKey)
    return .result()
  }
}
