// Compiles the app's own Swift into the app target. Files under targets/ only go into
// their own target (and targets/_shared into all of them), but these must be in the app
// itself: the system looks for App Shortcuts there, and the watch talks to the app.
//   native/AppShortcuts.swift    the "Add to HissyPad" Siri command
//   native/SiriSync.swift        what sends that line to the server, with the watch's
//                                own targets/watch/Remote.swift and Rows.swift
//   native/WatchBridge.swift     the phone's end of the watch app
//   targets/widget/Shared.swift  the shared-storage code both use (the widget's own
//                                file, so the repo has one copy)
//   targets/widget/AddControlIntent.swift  what the Add control runs: it opens the app,
//                                so the system runs it here
// It also starts the watch bridge and Siri's sync from the AppDelegate.
const fs = require('fs')
const path = require('path')
const { IOSConfig, withAppDelegate } = require('expo/config-plugins')

const FILES = [
  ['AppShortcuts.swift', 'native/AppShortcuts.swift'],
  ['SiriSync.swift', 'native/SiriSync.swift'],
  ['WatchBridge.swift', 'native/WatchBridge.swift'],
  ['WatchRemote.swift', 'targets/watch/Remote.swift'],
  ['WatchRows.swift', 'targets/watch/Rows.swift'],
  ['WidgetShared.swift', 'targets/widget/Shared.swift'],
  ['AddControlIntent.swift', 'targets/widget/AddControlIntent.swift'],
]

const LINES = ['    WatchBridge.shared.start()', '    SiriSync.shared.start()']
const ANCHOR = /^(\s*)return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/m

module.exports = function withNativeSources(config) {
  for (const [name, source] of FILES) {
    const contents = fs.readFileSync(path.join(__dirname, '..', source), 'utf8')
    config = IOSConfig.XcodeProjectFile.withBuildSourceFile(config, { filePath: name, contents, overwrite: true })
  }
  return withAppDelegate(config, (cfg) => {
    const mod = cfg.modResults
    if (mod.language !== 'swift') throw new Error('withNativeSources: expected a Swift AppDelegate')
    const missing = LINES.filter((line) => !mod.contents.includes(line.trim()))
    if (missing.length === 0) return cfg
    if (!ANCHOR.test(mod.contents)) throw new Error('withNativeSources: could not find didFinishLaunching in AppDelegate.swift')
    mod.contents = mod.contents.replace(ANCHOR, (m) => `${missing.join('\n')}\n${m}`)
    return cfg
  })
}
