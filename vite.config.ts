import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/ocean-simulator/' : '/',
  server: { port: 5173, open: false },
  build: { target: 'es2022' },
});
