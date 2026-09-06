import { defineConfig } from 'vite';

export default defineConfig({
  base: '/moon-villa/',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});
