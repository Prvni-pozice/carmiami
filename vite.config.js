import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: true, port: 5182 },
  preview: { host: true, port: 5182 },
  build: { target: 'es2019' },
})
