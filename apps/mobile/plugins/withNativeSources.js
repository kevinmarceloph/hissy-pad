// Compiles the app's own Swift into the app target. Files under targets/ only go into
// their own target (and targets/_shared into all of them), but these must be in the app
// itself: the system looks for App Shortcuts there, and the watch talks to the app.
//   native/AppShortcuts.swift    the "Add to HissyPad" Siri command
//   native/WatchBridge.swift     the phone's end of the watch app
//   targets/widget/Shared.swift  the shared-storage code both use (the widget's own
//                                file, so the repo has one copy)
// It also starts the watch bridge from the AppDelegate.
const fs = require('fs')
const path = require('path')
const { IOSConfig, withAppDelegate } = require('expo/config-plugins')

const FILES = [
  ['AppShortcuts.swift', 'native/AppShortcuts.swift'],
  ['WatchBridge.swift', 'native/WatchBridge.swift'],
  ['WidgetShared.swift', 'targets/widget/Shared.swift'],
]

const LINE = '    WatchBridge.shared.start()'
const ANCHOR = /^(\s*)return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/m

module.exports = function withNativeSources(config) {
  for (const [name, source] of FILES) {
    const contents = fs.readFileSync(path.join(__dirname, '..', source), 'utf8')
    config = IOSConfig.XcodeProjectFile.withBuildSourceFile(config, { filePath: name, contents, overwrite: true })
  }
  return withAppDelegate(config, (cfg) => {
    const mod = cfg.modResults
    if (mod.language !== 'swift') throw new Error('withNativeSources: expected a Swift AppDelegate')
    if (mod.contents.includes('WatchBridge.shared.start()')) return cfg
    if (!ANCHOR.test(mod.contents)) throw new Error('withNativeSources: could not find didFinishLaunching in AppDelegate.swift')
    mod.contents = mod.contents.replace(ANCHOR, (m) => `${LINE}\n${m}`)
    return cfg
  })
}
