// The Today list: the open lines of the pad the Sort screen's right side sends to
// ("Today" unless set otherwise), each with a circle that crosses it out. Another pad can
// be picked in Edit Widget. The circle works like the watch's: the line leaves the list at
// once and the app crosses it out for real when it is next in front.
import AppIntents
import SwiftUI
import WidgetKit

struct TodayEntry: TimelineEntry {
  let date: Date
  let pad: WidgetPad? // nil: no such pad yet (or the app has not written a snapshot)
  let name: String    // what to call the pad when it is not there
  let ready: Bool     // false until the app has written a snapshot
}

struct TodayProvider: AppIntentTimelineProvider {
  static let sample = TodayEntry(
    date: .now,
    pad: WidgetPad(id: "today", name: "Today", count: 4, items: [
      WidgetItem(id: "1", text: "Call the dentist", subs: 0),
      WidgetItem(id: "2", text: "Send the invoice", subs: 0),
      WidgetItem(id: "3", text: "Plan the trip", subs: 2),
      WidgetItem(id: "4", text: "Water the plants", subs: 0),
    ]),
    name: "Today",
    ready: true
  )

  private func entry(for configuration: InboxConfig) -> TodayEntry {
    guard let snap = Shared.snapshot() else {
      return TodayEntry(date: .now, pad: nil, name: "Today", ready: false)
    }
    // The pad that was picked, if it is still there; else the pad Sort's right side
    // sends to, which may not have been made yet.
    let picked = configuration.pad.flatMap { want in snap.pads.first { $0.id == want.id } }
    let pad = picked ?? snap.pads.first { $0.name.lowercased() == snap.right.lowercased() }
    return TodayEntry(date: .now, pad: pad, name: snap.right, ready: true)
  }

  func placeholder(in context: Context) -> TodayEntry {
    Self.sample
  }

  func snapshot(for configuration: InboxConfig, in context: Context) async -> TodayEntry {
    let real = entry(for: configuration)
    return context.isPreview && real.pad == nil ? Self.sample : real
  }

  func timeline(for configuration: InboxConfig, in context: Context) async -> Timeline<TodayEntry> {
    Timeline(entries: [entry(for: configuration)], policy: .never)
  }
}

struct TodayView: View {
  @Environment(\.widgetFamily) private var family
  let entry: TodayEntry

  private var rows: Int { family == .systemLarge ? 10 : 4 }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(entry.pad?.name ?? entry.name)
          .font(.system(size: 13, design: serif)).italic().foregroundStyle(Color("inkSoft")).lineLimit(1)
        if let pad = entry.pad, pad.count > 0 {
          Text("\(pad.count)").font(.system(size: 12, design: serif)).foregroundStyle(Color("inkMute"))
        }
        Spacer(minLength: 0)
        if let pad = entry.pad, family != .systemSmall {
          Link(destination: appURL("add", pad: pad.id)) {
            Label("Add", systemImage: "plus")
              .font(.system(size: 13, design: serif))
              .foregroundStyle(Color("$accent"))
          }
        }
      }
      if let pad = entry.pad, !pad.items.isEmpty {
        ForEach(Array(pad.items.prefix(rows))) { item in
          HStack(alignment: .center, spacing: 8) {
            Button(intent: DoneIntent(line: item.id)) {
              Image(systemName: "circle")
                .font(.system(size: 17, weight: .light))
                .foregroundStyle(Color("inkMute"))
                .frame(width: 22, height: 22)
            }
            .buttonStyle(.plain)
            Text(item.text.isEmpty ? "(blank line)" : item.text)
              .font(.system(size: 15, design: serif)).foregroundStyle(Color("ink")).lineLimit(1)
            Spacer(minLength: 0)
          }
        }
      } else {
        Text(entry.ready ? "Nothing in \(entry.pad?.name ?? entry.name)." : "Open the app once and this fills in.")
          .font(.system(size: 15, design: serif)).italic().foregroundStyle(Color("inkMute"))
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(entry.pad.map { appURL("pad", pad: $0.id) })
  }
}

struct TodayWidget: Widget {
  let kind = "HissyPadToday"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: InboxConfig.self, provider: TodayProvider()) { entry in
      TodayView(entry: entry)
        .containerBackground(for: .widget) { Color("$widgetBackground") }
    }
    .configurationDisplayName("Today")
    .description("The open lines of your Today pad, with a circle to cross one out.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
