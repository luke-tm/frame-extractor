import { defineConfig } from 'vite';
import { resolve } from 'path';

const REPO_NAME = process.env.VITE_REPO_NAME ?? 'frame-extractor';
const BASE = process.env.GITHUB_ACTIONS ? `/${REPO_NAME}/` : '/';

export default defineConfig({
  base: BASE,
  build: {
    target: ['es2022', 'safari17'],
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  define: {
    __BASE__: JSON.stringify(BASE),
    __REPO_NAME__: JSON.stringify(REPO_NAME),
  },
});
