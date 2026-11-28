import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// files.json: what is in this build, for the Mac app (apps/mac), which keeps a copy of the
// live site and has to know every file and whether its own copy is older. The service
// worker's files are left out: the Mac app has no use for one.
function fileList(): Plugin {
  let out = 'dist'
  return {
    name: 'hissypad-file-list',
    apply: 'build',
    configResolved(config) { out = config.build.outDir.startsWith('/') ? config.build.outDir : join(config.root, config.build.outDir) },
    closeBundle() {
      const skip = /^(files\.json|sw\.js|registerSW\.js|workbox-.*\.js|manifest\.webmanifest|drop-demo\.html)$/
      const files: string[] = []
      const walk = (dir: string, under: string) => {
        for (const name of readdirSync(dir).sort()) {
          const path = under ? `${under}/${name}` : name
          if (statSync(join(dir, name)).isDirectory()) walk(join(dir, name), path)
          else if (!skip.test(path) && !name.endsWith('.map')) files.push(path)
        }
      }
      try { walk(out, '') } catch { return }
      const hash = createHash('sha256')
      for (const path of files) hash.update(path).update(readFileSync(join(out, path)))
      writeFileSync(join(out, 'files.json'), JSON.stringify({ version: hash.digest('hex').slice(0, 16), built: Date.now(), files }))
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'favicon.svg', 'icons/favicon-64.png'],
      manifest: {
        name: 'HissyPad',
        short_name: 'HissyPad',
        description: 'One freeform outline. The top is what matters next.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f7f4ec',
        theme_color: '#f7f4ec',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'] },
    }),
    fileList(),
  ],
  // The Hours screens (packages/ui) are React Native: on the web that is react-native-web.
  resolve: { alias: { 'react-native': 'react-native-web' }, dedupe: ['react', 'react-dom', 'react-native-web', 'zustand'] },
  server: { port: 5180 },
})
