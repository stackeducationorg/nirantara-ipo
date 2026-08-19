import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind every interface so phones and laptops on the same Wi-Fi can open the site.
    host: true,
    // Fail loudly instead of drifting to 5174, 5175… — a moving port silently invalidates the
    // URL you handed to your phone, and hides that an old dev server is still running.
    strictPort: true,
    // The proxy runs inside the Vite process on this machine, so it can keep using localhost
    // even when the browser is on another device — which also keeps the page same-origin and
    // means no CORS configuration is needed.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
  },
});
