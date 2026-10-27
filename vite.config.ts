/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// The app is served from michael-han.com/hardest (GitHub Pages), so every asset and route lives under /hardest/.
export default defineConfig({
  base: '/hardest/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/katex') || id.includes('rehype-katex') || id.includes('remark-math')) return 'katex'
          if (id.includes('node_modules/@supabase')) return 'supabase'
          if (id.includes('react-markdown') || id.includes('node_modules/micromark') || id.includes('node_modules/mdast') || id.includes('node_modules/hast')) return 'markdown'
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
  },
})
