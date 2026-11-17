import AppIntents
import SwiftUI
import WidgetKit

struct InboxEntry: TimelineEntry {
  let date: Date
  let pad: WidgetPad?   // nil until the app has written a snapshot
  let left: String
  let right: String
}

struct InboxProvider: AppIntentTimelineProvider {
  static let sample = InboxEntry(
    date: .now,
    pad: WidgetPad(id: mainPadId, name: "Inbox", count: 3, items: [
      WidgetItem(id: "1", text: "Call the dentist", subs: 0),
      WidgetItem(id: "2", text: "Plan the trip", subs: 2),
      WidgetItem(id: "3", text: "Water the plants", subs: 0),
    ]),
    left: "Later",
    right: "Today"
  )

  private func entry(for configuration: InboxConfig) -> InboxEntry {
    guard let snap = Shared.snapshot() else {
      return InboxEntry(date: .now, pad: nil, left: "Later", right: "Today")
    }
    // The pad that was picked, if it is still there; else the Inbox default; else Main.
    let wanted = configuration.pad?.id ?? snap.inbox
    let pad = snap.pads.first { $0.id == wanted } ?? snap.pads.first { $0.id == snap.inbox } ?? snap.pads.first
    return InboxEntry(date: .now, pad: pad, left: snap.left, right: snap.right)
  }

  func placeholder(in context: Context) -> InboxEntry {
    Self.sample
  }

  func snapshot(for configuration: InboxConfig, in context: Context) async -> InboxEntry {
    let real = entry(for: configuration)
    return context.isPreview && real.pad == nil ? Self.sample : real
  }

  // Nothing here changes with time: the app reloads the widget when its data changes,
  // and a button reloads it by itself.
  func timeline(for configuration: InboxConfig, in context: Context) async -> Timeline<InboxEntry> {
    Timeline(entries: [entry(for: configuration)], policy: .never)
  }
}

private let serif = Font.Design.serif

private func appURL(_ path: String, pad: String) -> URL {
  var parts = URLComponents()
  parts.scheme = "hissypad"
  parts.host = path
  parts.queryItems = [URLQueryItem(name: "pad", value: pad)]
  return parts.url ?? URL(string: "hissypad://")!
}

struct SendButton: View {
  let line: String
  let dir: String
  let label: String
  let symbol: String
  var leading = true

  var body: some View {
    Button(intent: SendIntent(line: line, dir: dir)) {
      HStack(spacing: 4) {
        if leading { Image(systemName: symbol).font(.system(size: 11, weight: .semibold)) }
        Text(label).font(.system(size: 13, design: serif)).lineLimit(1).minimumScaleFactor(0.7)
        if !leading { Image(systemName: symbol).font(.system(size: 11, weight: .semibold)) }
      }
      .frame(maxWidth: .infinity, minHeight: 30)
      .foregroundStyle(Color("ink"))
      .background(Color("paperRaised"), in: RoundedRectangle(cornerRadius: 6))
      .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color("rule"), lineWidth: 1))
    }
    .buttonStyle(.plain)
  }
}

struct InboxView: View {
  @Environment(\.widgetFamily) private var family
  let entry: InboxEntry

  var body: some View {
    if let pad = entry.pad {
      content(pad)
    } else {
      VStack(alignment: .leading, spacing: 6) {
        Text("HissyPad").font(.system(size: 15, design: serif)).italic().foregroundStyle(Color("inkSoft"))
        Text("Open the app once and this fills in.").font(.system(size: 15, design: serif)).foregroundStyle(Color("inkMute"))
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  @ViewBuilder
  private func content(_ pad: WidgetPad) -> some View {
    let top = pad.items.first
    let rest = Array(pad.items.dropFirst().prefix(family == .systemLarge ? 7 : 1))
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(pad.name).font(.system(size: 13, design: serif)).italic().foregroundStyle(Color("inkSoft")).lineLimit(1)
        if pad.count > 1 {
          Text("\(pad.count)").font(.system(size: 12, design: serif)).foregroundStyle(Color("inkMute"))
        }
        Spacer(minLength: 0)
        Link(destination: appURL("add", pad: pad.id)) {
          Label("Add", systemImage: "plus")
            .font(.system(size: 13, design: serif))
            .foregroundStyle(Color("$accent"))
        }
      }
      if let top {
        Text(top.text.isEmpty ? "(blank line)" : top.text)
          .font(.system(size: family == .systemLarge ? 20 : 18, design: serif))
          .foregroundStyle(Color("ink"))
          .lineLimit(family == .systemLarge ? 3 : 2)
          .frame(maxWidth: .infinity, alignment: .leading)
        if top.subs > 0 && family == .systemLarge {
          Text("+\(top.subs) under it").font(.system(size: 12, design: serif)).foregroundStyle(Color("inkMute"))
        }
        HStack(spacing: 6) {
          SendButton(line: top.id, dir: "left", label: entry.left, symbol: "arrow.left")
          SendButton(line: top.id, dir: "up", label: "Done", symbol: "arrow.up")
          SendButton(line: top.id, dir: "right", label: entry.right, symbol: "arrow.right", leading: false)
        }
        if family == .systemLarge {
          Rectangle().fill(Color("rule")).frame(height: 1)
          ForEach(rest) { item in
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Circle().fill(Color("inkMute")).frame(width: 4, height: 4).offset(y: -3)
              Text(item.text.isEmpty ? "(blank line)" : item.text)
                .font(.system(size: 15, design: serif)).foregroundStyle(Color("inkSoft")).lineLimit(1)
            }
          }
          if pad.count > rest.count + 1 {
            Text("and \(pad.count - rest.count - 1) more").font(.system(size: 12, design: serif)).italic().foregroundStyle(Color("inkMute"))
          }
        } else if let next = rest.first {
          Text("Next: \(next.text)").font(.system(size: 12, design: serif)).foregroundStyle(Color("inkMute")).lineLimit(1)
        }
      } else {
        Text("Nothing in \(pad.name).")
          .font(.system(size: 17, design: serif)).italic().foregroundStyle(Color("inkMute"))
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(appURL("pad", pad: pad.id))
  }
}

struct InboxWidget: Widget {
  let kind = "HissyPadInbox"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: InboxConfig.self, provider: InboxProvider()) { entry in
      InboxView(entry: entry)
        .containerBackground(for: .widget) { Color("$widgetBackground") }
    }
    .configurationDisplayName("Inbox")
    .description("The top line of a pad, with Later, Done and Today.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}

@main
struct HissyPadWidgets: WidgetBundle {
  var body: some Widget {
    InboxWidget()
  }
}
