import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The screens are React Native; under test they are drawn by react-native-web in jsdom.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { 'react-native': 'react-native-web' }, dedupe: ['react', 'react-dom', 'zustand'] },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], globals: true, setupFiles: ['./src/testing/setup.ts'] },
})
