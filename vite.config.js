import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  server: { host: true, port: 5182 },
  preview: { host: true, port: 5182 },
  build: {
    target: 'es2019',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        miami: resolve(__dirname, 'miami.html'),
        skrysov: resolve(__dirname, 'skrysov.html'),
      },
    },
  },
})
