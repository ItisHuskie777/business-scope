import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Third-party code is grouped into a few long-lived chunks. They change far
// less often than application code, so a deploy that only touches a page does
// not invalidate the browser's cached copy of React, MUI, the charts or the map.
const VENDOR_CHUNKS = [
  ['vendor-map', ['leaflet', 'react-leaflet', '@react-leaflet']],
  ['vendor-charts', ['recharts', 'd3-', 'victory-vendor']],
  ['vendor-grid', ['@mui/x-data-grid']],
  ['vendor-mui', ['@mui/', '@emotion/']],
  ['vendor-react', ['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler']],
]

function manualChunks(id) {
  if (!id.includes('node_modules')) return undefined
  const pkg = id.split('node_modules/').pop()
  for (const [chunk, prefixes] of VENDOR_CHUNKS) {
    if (prefixes.some((prefix) => pkg === prefix || pkg.startsWith(prefix.endsWith('/') || prefix.endsWith('-') ? prefix : `${prefix}/`))) {
      return chunk
    }
  }
  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { output: { manualChunks } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
