// The Apple Watch app: look at pads, cross lines out. It gets its data from the iPhone
// app (native/WatchBridge.swift), never from the server.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'HissyPadWatch',
  displayName: 'HissyPad',
  bundleIdentifier: '.watch',
  deploymentTarget: '10.0',
  icon: '../../assets/icon.png',
  frameworks: ['SwiftUI', 'WatchConnectivity'],
  colors: {
    $accent: '#e0755a', // the app's accent as it is on a dark ground: a watch is always dark
  },
}
