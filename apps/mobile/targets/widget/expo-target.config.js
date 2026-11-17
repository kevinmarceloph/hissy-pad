// The home-screen widget: one pad's top line with Later / Done / Today buttons.
// Colors are the app's paper-and-ink tokens (src/theme.ts), light and dark.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'HissyPadWidget',
  displayName: 'HissyPad',
  bundleIdentifier: '.widget',
  deploymentTarget: '17.0', // buttons in widgets (App Intents) start at iOS 17
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
  colors: {
    $widgetBackground: { light: '#f7f4ec', dark: '#1b1a17' },
    $accent: { light: '#b5452b', dark: '#e0755a' },
    ink: { light: '#1f1c17', dark: '#ebe6db' },
    inkSoft: { light: '#4d4842', dark: '#c9c3b6' },
    inkMute: { light: '#8a847a', dark: '#857f74' },
    rule: { light: '#d9d3c6', dark: '#3a3731' },
    paperRaised: { light: '#fffdf8', dark: '#24221e' },
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
})
