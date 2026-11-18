import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        site: fileURLToPath(new URL('./index.html', import.meta.url)),
        play: fileURLToPath(new URL('./play/index.html', import.meta.url))
      }
    }
  }
});
