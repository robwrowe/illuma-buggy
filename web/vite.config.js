import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site: https://robwrowe.github.io/illuma-buggy/
export default defineConfig({
  plugins: [react()],
  base: '/illuma-buggy/',
});
