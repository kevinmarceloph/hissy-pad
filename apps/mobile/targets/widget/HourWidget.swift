// The Current hour: the lines put in the hour the clock is in, each followed by what is
// under it, behind their bullets. No summary and no flags; the category shown is the
// first line's. A tap on a bullet moves the line on through open, doing and done, and the
// line stays where it is in every state.
//
// The app cannot run when the hour turns, so the snapshot holds the coming hours too
// (Snapshot.hours, by "YYYY-MM-DDTHH" in local time) and the timeline has an entry for the
// start of each of the next 24.
import AppIntents
import SwiftUI
import WidgetKit

// ---- a line behind its bullet, as the Today list and the Current hour draw it ------------

// The bullet is the line's state, as in the app: a dot (open), a dot in a ring (doing), a
// cross (done). Three shapes, so nothing rests on the color.
struct Bullet: View {
  let item: WidgetItem

  private var name: String {
    switch item.state {
    case "doing": return "Doing. Tap to mark done"
    case "done": return "Done. Tap to reopen"
    default: return "Open. Tap to mark doing"
    }
  }

  var body: some View {
    Button(intent: CycleIntent(line: item.id)) {
      ZStack {
        switch item.state {
        case "done":
          Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color("inkMute"))
        case "doing":
          Circle().stroke(Color("$accent"), lineWidth: 1.5).frame(width: 14, height: 14)
          Circle().fill(Color("$accent")).frame(width: 6, height: 6)
        default:
          Circle().fill(Color("inkSoft")).frame(width: 6, height: 6)
        }
      }
      .frame(width: 22, height: 22)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(name)
  }
}

struct LineRow: View {
  let item: WidgetItem

  var body: some View {
    HStack(alignment: .center, spacing: 6) {
      Bullet(item: item)
      Text(item.text.isEmpty ? "(blank line)" : item.text)
        .font(.system(size: 15, design: serif))
        .strikethrough(item.isDone)
        .foregroundStyle(Color(item.isDone ? "inkMute" : "ink"))
        .lineLimit(1)
      Spacer(minLength: 0)
    }
    .padding(.leading, CGFloat(min(item.depth ?? 0, 4)) * 14)
  }
}

// ---- the widget ----------------------------------------------------------------------------

struct HourEntry: TimelineEntry {
  let date: Date
  let hour: WidgetHour? // nil: nothing was put in this hour
  let ready: Bool       // false until the app has written a snapshot
}

// The slot key of the hour a moment is in, the way the app writes it (core/slot.ts).
func hourKey(_ date: Date) -> String {
  let c = Calendar.current.dateComponents([.year, .month, .day, .hour], from: date)
  return String(format: "%04d-%02d-%02dT%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1, c.hour ?? 0)
}

// "2pm", as the app says it.
func hourWord(_ date: Date) -> String {
  let hour = Calendar.current.component(.hour, from: date)
  let h = hour % 12 == 0 ? 12 : hour % 12
  return "\(h)\(hour < 12 ? "am" : "pm")"
}

struct HourProvider: TimelineProvider {
  static let sample = HourEntry(
    date: .now,
    hour: WidgetHour(items: [
      WidgetItem(id: "1", text: "Write the proposal", subs: 2, state: "doing"),
      WidgetItem(id: "2", text: "Outline", subs: 0, state: "done", depth: 1),
      WidgetItem(id: "3", text: "First draft", subs: 0, depth: 1),
      WidgetItem(id: "4", text: "Send the invoice", subs: 0),
    ], category: WidgetCategory(label: "Deep work", icon: "", light: "#5589e0", dark: "#145dff")),
    ready: true
  )

  private func entry(at date: Date, from snap: Snapshot?) -> HourEntry {
    HourEntry(date: date, hour: snap?.hours?[hourKey(date)], ready: snap != nil)
  }

  func placeholder(in context: Context) -> HourEntry {
    Self.sample
  }

  func getSnapshot(in context: Context, completion: @escaping (HourEntry) -> Void) {
    let real = entry(at: .now, from: Shared.snapshot())
    completion(context.isPreview && real.hour == nil ? Self.sample : real)
  }

  // Now, then the start of each of the next 24 hours; after that the system asks again.
  // The app reloads the widget when its data changes, and a bullet reloads it by itself.
  func getTimeline(in context: Context, completion: @escaping (Timeline<HourEntry>) -> Void) {
    let snap = Shared.snapshot()
    let calendar = Calendar.current
    let now = Date()
    let start = calendar.dateInterval(of: .hour, for: now)?.start ?? now
    var entries = [entry(at: now, from: snap)]
    var last = start
    for i in 1...24 {
      guard let next = calendar.date(byAdding: .hour, value: i, to: start) else { break }
      entries.append(entry(at: next, from: snap))
      last = next
    }
    completion(Timeline(entries: entries, policy: .after(last)))
  }
}

extension Color {
  // "#5589e0"; nil for anything else.
  init?(hex: String) {
    let text = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard text.count == 6, let n = UInt32(text, radix: 16) else { return nil }
    self.init(red: Double((n >> 16) & 0xff) / 255, green: Double((n >> 8) & 0xff) / 255, blue: Double(n & 0xff) / 255)
  }
}

struct HourView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme
  let entry: HourEntry

  private var rows: Int { family == .systemLarge ? 11 : 4 }

  var body: some View {
    let items = entry.hour?.items ?? []
    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .center, spacing: 6) {
        Text(hourWord(entry.date))
          .font(.system(size: 13, design: serif)).italic().foregroundStyle(Color("inkSoft")).lineLimit(1)
        if let category = entry.hour?.category {
          // The color is a swatch beside the name, never the only sign of the category.
          RoundedRectangle(cornerRadius: 3)
            .fill(Color(hex: scheme == .dark ? category.dark : category.light) ?? Color("inkMute"))
            .frame(width: 10, height: 10)
          Text(category.icon.isEmpty ? category.label : "\(category.icon) \(category.label)")
            .font(.system(size: 12, design: serif)).foregroundStyle(Color("inkSoft")).lineLimit(1)
        }
        Spacer(minLength: 0)
        if items.count > rows {
          Text("+\(items.count - rows)").font(.system(size: 12, design: serif)).foregroundStyle(Color("inkMute"))
        }
      }
      if !items.isEmpty {
        ForEach(Array(items.prefix(rows))) { item in
          LineRow(item: item)
        }
      } else {
        Text(entry.ready ? "Nothing in this hour." : "Open the app once and this fills in.")
          .font(.system(size: 15, design: serif)).italic().foregroundStyle(Color("inkMute"))
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct HourWidget: Widget {
  let kind = "HissyPadHour"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: HourProvider()) { entry in
      HourView(entry: entry)
        .containerBackground(for: .widget) { Color("$widgetBackground") }
    }
    .configurationDisplayName("Current hour")
    .description("The lines you put in this hour and what is under them. Tap a bullet: open, doing, done.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
