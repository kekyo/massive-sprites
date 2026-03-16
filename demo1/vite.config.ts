// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type { Connect } from 'vite';
import { defineConfig } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import prettierMax from 'prettier-max';

const wasmMimePlugin = () => ({
  name: 'wasm-mime',
  configureServer(server: { middlewares: Connect.Server }) {
    server.middlewares.use(
      (
        req: IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction
      ) => {
        if (req.url && req.url.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
        }
        next();
      }
    );
  },
});

export default defineConfig({
  plugins: [prettierMax(), wasmMimePlugin()],
  define: {
    global: 'globalThis',
    // Provide Buffer polyfill directly
    'globalThis.Buffer': 'globalThis.Buffer',
    // Node.js environment variables for browser compatibility
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  server: {
    // Do not specify port number here as it will be specified with --port option when starting from package.json scripts.
    // npm run dev is for manual operation verification, npm run test:playwright is for e2e test server.
    open: true,
    host: true,
    fs: {
      allow: ['..'],
    },
    watch: {
      // Include parent directory src in watch targets
      ignored: ['!**/src/**'],
    },
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    rollupOptions: {
      external: ['massive-sprites'],
    },
  },
});
