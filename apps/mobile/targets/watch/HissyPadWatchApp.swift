import SwiftUI
import WatchKit

@main
struct HissyPadWatchApp: App {
  @StateObject private var store = WatchStore.shared

  var body: some Scene {
    WindowGroup {
      PadListView()
        .environmentObject(store)
    }
    // Time the system gives now and then while the app is away (WatchStore.rest asks for it).
    .backgroundTask(.appRefresh(WatchStore.refreshTask)) {
      await WatchStore.shared.background()
    }
  }
}

private let serif = Font.Design.serif

// The pads, each with how many open lines it has.
struct PadListView: View {
  @EnvironmentObject private var store: WatchStore
  @Environment(\.scenePhase) private var phase

  var body: some View {
    NavigationStack {
      Group {
        if store.pads.isEmpty {
          VStack(spacing: 6) {
            Text("HissyPad").font(.system(.headline, design: serif)).italic()
            Text("Open HissyPad on your iPhone once and your pads appear here. After that the watch syncs on its own.")
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
            if !store.footer.isEmpty {
              // Where the lines came from and when. A tap syncs now.
              Button {
                store.wake()
              } label: {
                Text(store.footer)
                  .font(.system(.caption2, design: serif))
                  .foregroundStyle(.secondary)
              }
              .buttonStyle(.plain)
              .listRowBackground(Color.clear)
            }
          }
        }
      }
      .navigationTitle("HissyPad")
      .navigationDestination(for: String.self) { PadView(padId: $0) }
    }
    .onChange(of: phase, initial: true) { _, now in
      if now == .active { store.wake() } else { store.rest() }
    }
  }
}

// One pad: its open top-level lines. The circle crosses a line out; so does a swipe.
// "New line" opens the watch's own text entry (dictation, scribble or its keyboard) and
// puts what was said at the top of the pad.
struct PadView: View {
  @EnvironmentObject private var store: WatchStore
  let padId: String
  @State private var editing: WidgetItem? // the line whose text is being changed

  private func finish(_ item: WidgetItem) {
    WKInterfaceDevice.current().play(.success)
    withAnimation { store.done(item) }
  }

  var body: some View {
    let pad = store.pad(padId)
    List {
      if pad != nil {
        TextFieldLink(prompt: Text("New line")) {
          Label("New line", systemImage: "plus")
            .font(.system(.body, design: serif))
            .foregroundStyle(Color.accentColor)
        } onSubmit: { text in
          let added = withAnimation { store.add(text, to: padId) }
          if added { WKInterfaceDevice.current().play(.click) }
        }
      }
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            // A tap on the text edits it (with the watch's own copy only: the phone's
            // snapshot cannot take an edit back).
            .onTapGesture { if store.onItsOwn { editing = item } }
          }
          .swipeActions(edge: .leading) {
            if store.onItsOwn {
              Button {
                editing = item
              } label: {
                Label("Edit", systemImage: "pencil")
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
    .sheet(item: $editing) { item in
      EditLineView(item: item) { text in
        if store.edit(item, text: text) { WKInterfaceDevice.current().play(.click) }
        editing = nil
      }
    }
  }
}

// A line's text, to change: the field starts with it, and Save keeps what is there.
struct EditLineView: View {
  let item: WidgetItem
  let save: (String) -> Void
  @State private var draft: String

  init(item: WidgetItem, save: @escaping (String) -> Void) {
    self.item = item
    self.save = save
    _draft = State(initialValue: item.text)
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        TextField("Line", text: $draft)
          .font(.system(.body, design: serif))
        Button("Save") { save(draft) }
          .tint(.accentColor)
      }
    }
  }
}
