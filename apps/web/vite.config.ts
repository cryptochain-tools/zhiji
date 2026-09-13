import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  plugins: [tailwindcss(), react()],
  server: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: { input: { public: resolve(import.meta.dirname, 'index.html'), console: resolve(import.meta.dirname, 'console.html') } },
  },
})
