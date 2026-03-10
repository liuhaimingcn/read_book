import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['socket.io-client', 'react', 'react-dom'],
  },
  server: {
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
