import { defineConfig } from 'vite'
import { resolve } from 'path'

const root = import.meta.dirname

export default defineConfig({
  // Multi-page app: visitor chat at / and admin at /admin
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        admin: resolve(root, 'admin/index.html'),
      },
    },
  },
  // Dev server proxy for backend API calls
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/admin/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
