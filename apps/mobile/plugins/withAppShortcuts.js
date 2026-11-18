// Compiles two Swift files into the app target itself: the Siri shortcut
// (native/AppShortcuts.swift) and the shared-storage code it uses, which is the widget's
// own Shared.swift so there is one copy of it in the repo. Files under targets/ only go
// into their own target, and the system looks for App Shortcuts in the app.
const fs = require('fs')
const path = require('path')
const { IOSConfig } = require('expo/config-plugins')

const FILES = [
  ['AppShortcuts.swift', 'native/AppShortcuts.swift'],
  ['WidgetShared.swift', 'targets/widget/Shared.swift'],
]

module.exports = function withAppShortcuts(config) {
  for (const [name, source] of FILES) {
    const contents = fs.readFileSync(path.join(__dirname, '..', source), 'utf8')
    config = IOSConfig.XcodeProjectFile.withBuildSourceFile(config, { filePath: name, contents, overwrite: true })
  }
  return config
}
