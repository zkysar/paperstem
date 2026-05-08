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
//
// Audio seeking REQUIRES HTTP Range support: when the browser issues
// `audio.currentTime = X`, it sends a `Range: bytes=N-` request to fetch
// the chunk near offset N. If the server replies 200 with the full body,
// the browser treats the resource as un-seekable and silently drops the
// seek — causing playback to fall back to position 0.
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

  function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
    if (!header) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m) return null;
    const startStr = m[1];
    const endStr = m[2];
    let start: number;
    let end: number;
    if (startStr === '' && endStr !== '') {
      // suffix form: bytes=-N → last N bytes
      const n = Number(endStr);
      if (!Number.isFinite(n) || n <= 0) return null;
      start = Math.max(0, size - n);
      end = size - 1;
    } else if (startStr !== '') {
      start = Number(startStr);
      end = endStr === '' ? size - 1 : Number(endStr);
    } else {
      return null;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start < 0 || end >= size || start > end) return null;
    return { start, end };
  }

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
          if (!s.isFile()) return next();

          const ext = extname(filePath).toLowerCase();
          const contentType = MIME[ext] || 'application/octet-stream';
          const totalSize = s.size;
          res.setHeader('Content-Type', contentType);
          res.setHeader('Accept-Ranges', 'bytes');

          const range = parseRange(
            (req.headers['range'] as string | undefined) ?? undefined,
            totalSize,
          );
          const data = await readFile(filePath);

          if (range) {
            const { start, end } = range;
            const chunk = data.subarray(start, end + 1);
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
            res.setHeader('Content-Length', String(chunk.length));
            res.end(chunk);
          } else {
            res.statusCode = 200;
            res.setHeader('Content-Length', String(totalSize));
            res.end(data);
          }
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

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  base: '/',
  plugins: [react(), publicHashPassthrough()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.PAPERSTEM_VITE_PORT ?? 5173),
    proxy: {
      '/api': `http://localhost:${process.env.PAPERSTEM_API_PORT ?? 8787}`,
      '/auth/callback': `http://localhost:${process.env.PAPERSTEM_API_PORT ?? 8787}`,
    },
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./test-setup.ts'],
  },
});
