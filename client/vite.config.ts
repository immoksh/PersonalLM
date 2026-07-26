import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Env lives at the repo root, shared with the server, so PORT stays in one place.
  const env = loadEnv(mode, path.resolve(here, '..'), '');
  const apiPort = env.PORT || '4000';

  return {
    plugins: [react(), tailwindcss()],
    // Without this, Vite would look for .env next to this config (client/) and
    // never see the repo-root file that holds VITE_* vars.
    envDir: path.resolve(here, '..'),
    resolve: {
      alias: { '@': path.resolve(here, 'src') },
    },
    server: {
      port: 5173,
      // Proxying keeps dev same-origin, so the httpOnly auth cookie is sent
      // without CORS credentials handling — matching how production serves it.
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
    },
  };
});
