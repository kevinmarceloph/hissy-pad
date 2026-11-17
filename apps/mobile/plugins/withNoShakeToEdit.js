// Turns off iOS's own shake gesture ("Undo Typing"), so a shake goes only to the app's
// undo prompt (src/shake.ts). One line in AppDelegate's didFinishLaunching.
const { withAppDelegate } = require('expo/config-plugins')

const LINE = '    application.applicationSupportsShakeToEdit = false'
const ANCHOR = /^(\s*)return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/m

module.exports = function withNoShakeToEdit(config) {
  return withAppDelegate(config, (cfg) => {
    const mod = cfg.modResults
    if (mod.language !== 'swift') throw new Error('withNoShakeToEdit: expected a Swift AppDelegate')
    if (mod.contents.includes('applicationSupportsShakeToEdit')) return cfg
    if (!ANCHOR.test(mod.contents)) throw new Error('withNoShakeToEdit: could not find didFinishLaunching in AppDelegate.swift')
    mod.contents = mod.contents.replace(ANCHOR, (m) => `${LINE}\n${m}`)
    return cfg
  })
}
