import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const apiTarget = `http://localhost:${process.env.API_PORT ?? 8080}`;

export default defineConfig({
  base: '/',
  envDir: path.resolve(import.meta.dirname, '../..'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.PORT ?? 5173),
    proxy: { '/api': apiTarget },
  },
  preview: {
    port: Number(process.env.PORT ?? 5173),
    proxy: { '/api': apiTarget },
  },
});
