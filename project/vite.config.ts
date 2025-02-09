import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react({
    // This is important for automatic runtime
    jsxRuntime: 'automatic',
    // Include React imports automatically
    include: "**/*.{jsx,tsx}",
  })],
  optimizeDeps: {
    include: ['react', 'react-dom']
  },
  server: {
    host: '0.0.0.0',
    port: 5173, // Vite's default port
    strictPort: true,
    hmr: {
      host: '192.168.0.100',
      port: 5173
    }
  }
});
