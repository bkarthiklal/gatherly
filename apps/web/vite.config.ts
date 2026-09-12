import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * In development the browser talks only to Vite (localhost:5173), which
 * forwards /api and /socket.io to the API. The page and the API therefore
 * share one origin, exactly as they do in production behind the Netlify
 * rewrite — so the SameSite=Lax refresh cookie behaves identically in both.
 */
export default defineConfig({
  plugins: [react({ compiler: true }), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('@zxing')) return 'scanner';
          return undefined;
        },
      },
    },
  },
});
