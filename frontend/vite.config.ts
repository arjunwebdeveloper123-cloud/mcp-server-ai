import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    // /api, /hooks, /embed.js → Express backend (port 5000)
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/hooks': 'http://127.0.0.1:5000',
      '/embed.js': 'http://127.0.0.1:5000',
    },
  },
})
