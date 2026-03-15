import { defineConfig } from 'vite'
import voicesPlugin from './vite-plugin-voices.js'

export default defineConfig({
  plugins: [voicesPlugin()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': {
        target: 'http://100.67.209.116:50000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/f5api': {
        target: 'http://100.67.209.116:7860',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/f5api/, ''),
      }
    }
  },
  optimizeDeps: {
    exclude: ['@breezystack/lamejs']
  }
})
