import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    basicSsl(), // 开发环境 HTTPS，自动生成自签名证书
    nodePolyfills({ include: ['events', 'util', 'buffer', 'stream'] }),
  ],
  define: { global: 'globalThis' },
  optimizeDeps: {
    include: ['simple-peer', 'socket.io-client', 'react', 'react-dom'],
  },
  server: {
    https: true,
    host: '0.0.0.0',
    port: 3100,
    warmup: {
      clientFiles: ['./src/main.jsx', './src/App.jsx', './src/pages/Home.jsx', './src/pages/Room.jsx'],
    },
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
