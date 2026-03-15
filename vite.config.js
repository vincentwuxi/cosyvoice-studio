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
      }
    }
  },
  optimizeDeps: {
    exclude: ['@breezystack/lamejs']
  }
})
