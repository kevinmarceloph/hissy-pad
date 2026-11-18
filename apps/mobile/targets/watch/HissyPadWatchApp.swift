import SwiftUI
import WatchKit

@main
struct HissyPadWatchApp: App {
  @StateObject private var store = WatchStore()

  var body: some Scene {
    WindowGroup {
      PadListView()
        .environmentObject(store)
    }
  }
}

private let serif = Font.Design.serif

// The pads, each with how many open lines it has.
struct PadListView: View {
  @EnvironmentObject private var store: WatchStore

  var body: some View {
    NavigationStack {
      Group {
        if store.pads.isEmpty {
          VStack(spacing: 6) {
            Text("HissyPad").font(.system(.headline, design: serif)).italic()
            Text("Open HissyPad on your iPhone and your pads appear here.")
              .font(.system(.footnote, design: serif))
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
          }
          .padding()
        } else {
          List {
            ForEach(store.pads) { pad in
              NavigationLink(value: pad.id) {
                HStack {
                  Text(pad.name).font(.system(.body, design: serif)).lineLimit(1)
                  Spacer(minLength: 4)
                  if pad.count > 0 {
                    Text("\(pad.count)").font(.system(.footnote, design: serif)).foregroundStyle(.secondary)
                  }
                }
              }
            }
            if let at = store.updatedAt {
              Text("From your iPhone, \(at.formatted(date: .omitted, time: .shortened))")
                .font(.system(.caption2, design: serif))
                .foregroundStyle(.secondary)
                .listRowBackground(Color.clear)
            }
          }
        }
      }
      .navigationTitle("HissyPad")
      .navigationDestination(for: String.self) { PadView(padId: $0) }
    }
    .onAppear { store.refresh() }
  }
}

// One pad: its open top-level lines. The circle crosses a line out; so does a swipe.
struct PadView: View {
  @EnvironmentObject private var store: WatchStore
  let padId: String

  private func finish(_ item: WidgetItem) {
    WKInterfaceDevice.current().play(.success)
    withAnimation { store.done(item) }
  }

  var body: some View {
    let pad = store.pad(padId)
    List {
      if let pad, !pad.items.isEmpty {
        ForEach(pad.items) { item in
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Button {
              finish(item)
            } label: {
              Image(systemName: "circle").font(.system(size: 20)).foregroundStyle(Color.accentColor)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Mark done")
            VStack(alignment: .leading, spacing: 2) {
              Text(item.text.isEmpty ? "(blank line)" : item.text).font(.system(.body, design: serif))
              if item.subs > 0 {
                Text("+\(item.subs) under it").font(.system(.caption2, design: serif)).foregroundStyle(.secondary)
              }
            }
          }
          .swipeActions(edge: .trailing) {
            Button {
              finish(item)
            } label: {
              Label("Done", systemImage: "checkmark")
            }
            .tint(.accentColor)
          }
        }
        if pad.count > pad.items.count {
          Text("and \(pad.count - pad.items.count) more on your iPhone")
            .font(.system(.caption2, design: serif)).italic()
            .foregroundStyle(.secondary)
            .listRowBackground(Color.clear)
        }
      } else {
        Text("Nothing open here.")
          .font(.system(.body, design: serif)).italic()
          .foregroundStyle(.secondary)
          .listRowBackground(Color.clear)
      }
    }
    .navigationTitle(pad?.name ?? "Pad")
  }
}
