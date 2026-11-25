import AppIntents
import WidgetKit

// A pad, as the widget's "Pad" setting lists them.
struct PadEntity: AppEntity {
  let id: String
  let name: String

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Pad"
  static let defaultQuery = PadQuery()

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)")
  }
}

struct PadQuery: EntityQuery {
  private func all() -> [PadEntity] {
    (Shared.snapshot()?.pads ?? []).map { PadEntity(id: $0.id, name: $0.name) }
  }

  func entities(for identifiers: [String]) async throws -> [PadEntity] {
    all().filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [PadEntity] {
    all()
  }
}

// Edit Widget: which pad to show. Left unset, the widget shows the pad named "Inbox",
// or Main when there is none.
struct InboxConfig: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Pad"
  static let description = IntentDescription("Choose the pad this widget shows.")

  @Parameter(title: "Pad")
  var pad: PadEntity?
}

// One of the three buttons under the top line. Runs inside the widget, which cannot
// reach the app's data: it records the press and redraws from the edited snapshot.
struct SendIntent: AppIntent {
  static let title: LocalizedStringResource = "Send line"
  static let isDiscoverable = false

  @Parameter(title: "Line")
  var line: String

  @Parameter(title: "Direction")
  var dir: String

  init() {}

  init(line: String, dir: String) {
    self.line = line
    self.dir = dir
  }

  func perform() async throws -> some IntentResult {
    Shared.send(line: line, dir: dir)
    return .result()
  }
}

// The bullet in front of a line, in the Today list and the Current hour: each tap moves
// the line on through open, doing and done. It stays on the widget in every state.
struct CycleIntent: AppIntent {
  static let title: LocalizedStringResource = "Change line state"
  static let isDiscoverable = false

  @Parameter(title: "Line")
  var line: String

  init() {}

  init(line: String) {
    self.line = line
  }

  func perform() async throws -> some IntentResult {
    Shared.cycle(line: line)
    WidgetCenter.shared.reloadAllTimelines() // the other widgets may list the same line
    return .result()
  }
}
