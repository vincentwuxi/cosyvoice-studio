import { defineConfig } from 'vite'

export default defineConfig({
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
