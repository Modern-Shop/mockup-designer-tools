import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative asset paths, so the built demo works from any folder, such as a GitHub Pages project site.
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: { input: { demo: fileURLToPath(new URL('./index.html', import.meta.url)), checks: fileURLToPath(new URL('./tests/browser.html', import.meta.url)) } },
  },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
