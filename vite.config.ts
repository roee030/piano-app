import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { tutorPlugin } from './server/tutor';

// Web MIDI needs a secure context. localhost counts as secure; for another
// machine on the LAN, run `npm run dev:https` (a self-signed certificate).
export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the app from /<repo>/, set by the deploy workflow
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react(), tutorPlugin(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: { port: 5173 },
  // VexFlow bundles its music fonts (~1 MB), so a single large chunk is expected
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
