// The Apple Watch app: look at pads, cross lines out. Signed in, it syncs with the server
// itself (PadSync.swift); the iPhone app (native/WatchBridge.swift) signs it in, and feeds
// it a snapshot instead when there is no account.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'HissyPadWatch',
  displayName: 'HissyPad',
  bundleIdentifier: '.watch',
  deploymentTarget: '10.0',
  icon: '../../assets/icon.png',
  frameworks: ['SwiftUI', 'WatchConnectivity', 'Security'],
  colors: {
    $accent: '#e0755a', // the app's accent as it is on a dark ground: a watch is always dark
  },
}
