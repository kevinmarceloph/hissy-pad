// "Add to HissyPad" for Siri, Spotlight and the Shortcuts app. Compiled into the app
// itself (plugins/withAppShortcuts.js adds this file and Shared.swift to the app target),
// because the system only looks for App Shortcuts in the app, not in its widget.
//
// The intent does not open the app or run its JavaScript. It queues the line in the
// shared storage, the same way a widget button does, and the app adds it for real the
// next time it is in front. The widget shows it straight away.
import AppIntents
import WidgetKit

struct AddToInboxIntent: AppIntent {
  static let title: LocalizedStringResource = "Add to Inbox"
  static let description = IntentDescription("Adds a line at the top of your Inbox pad in HissyPad.")
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
    Shared.add(text: clean)
    WidgetCenter.shared.reloadAllTimelines()
    return .result(dialog: IntentDialog("Added to Inbox."))
  }
}

struct HissyPadShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AddToInboxIntent(),
      phrases: [
        "Add to \(.applicationName)",
        "Add to my \(.applicationName) Inbox",
        "New line in \(.applicationName)",
      ],
      shortTitle: "Add to Inbox",
      systemImageName: "plus"
    )
  }
}
