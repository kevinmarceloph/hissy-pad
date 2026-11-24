// "HissyPad inbox" for Siri on the watch. Siri on a watch only knows the commands of the
// watch app itself, not the iPhone app's (native/AppShortcuts.swift), so the watch has its
// own: the same phrases, the same question, and WatchStore does the adding, the way the
// "New line" row does. Keep the phrases the same as the phone's.
import AppIntents

struct AddToInboxIntent: AppIntent {
  static let title: LocalizedStringResource = "Add to Inbox"
  static let description = IntentDescription("Adds a line at the top of your Inbox pad in HissyPad.")
  static let openAppWhenRun = false

  @Parameter(title: "Text", requestValueDialog: IntentDialog("What should I add?"))
  var text: String

  static var parameterSummary: some ParameterSummary {
    Summary("Add \(\.$text) to Inbox")
  }

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty else {
      throw $text.needsValueError(IntentDialog("What should I add?"))
    }
    guard await WatchStore.shared.addToInbox(clean) else {
      return .result(dialog: IntentDialog("HissyPad on this watch has nothing yet. Open it on your iPhone first."))
    }
    return .result(dialog: IntentDialog("Added to Inbox."))
  }
}

struct HissyPadWatchShortcuts: AppShortcutsProvider {
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
