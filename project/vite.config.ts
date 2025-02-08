import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    host: true, // Listen on all addresses
    strictPort: true, // Don't try other ports if default is in use
    hmr: {
      clientPort: 443 // Force client to use secure WebSocket
    }
  }
});
