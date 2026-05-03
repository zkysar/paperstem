/// <reference types="vitest" />
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vite's dev static handler doesn't serve files whose URL contains `%23`
// (encoded `#`) — it falls back to index.html. We have stem files with `#`
// in their names. This middleware decodes the URL and serves the public/
// file directly when Vite would otherwise miss it.
function publicHashPassthrough(): Plugin {
  const MIME: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.webm': 'audio/webm',
    '.opus': 'audio/opus',
  };
  return {
    name: 'paperstem-public-hash-passthrough',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url;
        if (!raw || !raw.includes('%23')) return next();
        const decoded = decodeURIComponent(raw.split('?')[0]);
        const rel = normalize(decoded.replace(/^\//, ''));
        if (rel.startsWith('..') || rel.includes(`..${sep}`)) return next();
        const filePath = join(server.config.publicDir, rel);
        try {
          const s = await stat(filePath);
          if (!s.isFile()) {
            server.config.logger.info(`[publicHashPassthrough] not a file: ${filePath}`);
            return next();
          }
          const ext = extname(filePath).toLowerCase();
          const contentType = MIME[ext] || 'application/octet-stream';
          const data = await readFile(filePath);
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Length', String(data.length));
          server.config.logger.info(
            `[publicHashPassthrough] served ${filePath} (${data.length} bytes)`,
          );
          res.end(data);
        } catch (err) {
          server.config.logger.info(
            `[publicHashPassthrough] error for ${filePath}: ${(err as Error).message}`,
          );
          return next();
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Pages serves the site under /paperstem/. Override locally with `--base=/` if needed.
  base: '/paperstem/',
  plugins: [react(), publicHashPassthrough()],
  server: {
    port: 8765,
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
  },
});
