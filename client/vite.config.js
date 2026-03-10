import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ include: ['events', 'util', 'buffer', 'stream'] }),
  ],
  define: { global: 'globalThis' },
  server: {
    host: '0.0.0.0',
    port: 3100,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3101',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': { target: 'http://127.0.0.1:3101', ws: true },
    },
  },
})
