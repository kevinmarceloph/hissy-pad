// "HissyPad inbox" for Siri, Spotlight and the Shortcuts app. Compiled into the app
// itself (plugins/withNativeSources.js adds this file and Shared.swift to the app target),
// because the system only looks for App Shortcuts in the app, not in its widget.
//
// The intent does not open the app or run its JavaScript. It queues the line in the
// shared storage, the same way a widget button does, so the widget shows it straight
// away; then it sends the line to the server itself (SiriSync.swift) and takes it back out
// of the queue. If that does not work (signed out, no network), the
// line stays queued and the app adds it for real the next time it is in front.
import AppIntents
import WidgetKit

struct AddToInboxIntent: AppIntent {
  static let title: LocalizedStringResource = "Add to Inbox"
  static let description = IntentDescription("Adds a line at the top of your Inbox in HissyPad.")
  static let openAppWhenRun = false

  @Parameter(title: "Text", requestValueDialog: IntentDialog("What should I add?"))
  var text: String

  static var parameterSummary: some ParameterSummary {
    Summary("Add \(\.$text) to Inbox")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty else {
      throw $text.needsValueError(IntentDialog("What should I add?"))
    }
    let id = Shared.add(text: clean)
    if await SiriSync.shared.add(id: id, text: clean) { Shared.sent(id: id) }
    WidgetCenter.shared.reloadAllTimelines()
    return .result(dialog: IntentDialog("Added to Inbox."))
  }
}

// The phrases, said as they are: Siri asks for the line after. The first ones are the ones
// to use. "Add to …" and "New line in …" came first and are kept, but Siri tends to hear
// them as its own (add a song to a playlist, a search), 2026-11-24. The watch app has the
// same list (targets/watch/WatchShortcuts.swift): keep them the same.
struct HissyPadShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AddToInboxIntent(),
      phrases: [
        "\(.applicationName) inbox",
        "Jot in \(.applicationName)",
        "Capture in \(.applicationName)",
        "Write in \(.applicationName)",
        "New \(.applicationName) line",
        "Add to \(.applicationName)",
        "Add to my \(.applicationName) Inbox",
        "New line in \(.applicationName)",
      ],
      shortTitle: "Add to Inbox",
      systemImageName: "plus"
    )
  }
}
