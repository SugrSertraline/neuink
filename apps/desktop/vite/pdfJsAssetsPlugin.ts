import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin, ResolvedConfig } from 'vite';

// PDF.js loads legacy image decoders at runtime, outside Vite's module graph.
const ASSET_DIRECTORIES = ['wasm', 'iccs', 'cmaps', 'standard_fonts'] as const;
const ASSET_ROUTE_PREFIX = '/pdfjs-assets/';

export function pdfJsAssetsPlugin(): Plugin {
  const sourceRoot = resolvePdfJsRoot();
  let config: ResolvedConfig;

  return {
    name: 'neuink-pdfjs-assets',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async buildStart() {
      await validateAssetDirectories(sourceRoot);
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const assetPath = resolveRequestedAsset(sourceRoot, request.url);
        if (!assetPath) {
          next();
          return;
        }

        try {
          const content = await fs.readFile(assetPath);
          response.statusCode = 200;
          response.setHeader('Content-Type', mimeTypeFor(assetPath));
          response.setHeader('Content-Length', String(content.byteLength));
          response.end(content);
        } catch (error) {
          if (isMissingFileError(error)) {
            response.statusCode = 404;
            response.end('PDF.js asset not found');
            return;
          }
          next(error as Error);
        }
      });
    },
    async writeBundle() {
      const outputRoot = path.resolve(config.root, config.build.outDir, 'pdfjs-assets');
      await Promise.all(
        ASSET_DIRECTORIES.map((directory) =>
          fs.cp(
            path.join(sourceRoot, directory),
            path.join(outputRoot, directory),
            { recursive: true }
          )
        )
      );
    }
  };
}

function resolvePdfJsRoot() {
  const require = createRequire(import.meta.url);
  return path.dirname(require.resolve('pdfjs-dist/package.json'));
}

async function validateAssetDirectories(sourceRoot: string) {
  await Promise.all(
    ASSET_DIRECTORIES.map((directory) => fs.access(path.join(sourceRoot, directory)))
  );
}

function resolveRequestedAsset(sourceRoot: string, requestUrl?: string) {
  if (!requestUrl) {
    return null;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }

  if (!pathname.startsWith(ASSET_ROUTE_PREFIX)) {
    return null;
  }

  const relativePath = pathname.slice(ASSET_ROUTE_PREFIX.length);
  const [directory] = relativePath.split('/');
  if (!ASSET_DIRECTORIES.includes(directory as (typeof ASSET_DIRECTORIES)[number])) {
    return null;
  }

  const directoryRoot = path.resolve(sourceRoot, directory);
  const assetPath = path.resolve(directoryRoot, relativePath.slice(directory.length + 1));
  const relativeAssetPath = path.relative(directoryRoot, assetPath);
  if (
    !relativeAssetPath ||
    relativeAssetPath.startsWith('..') ||
    path.isAbsolute(relativeAssetPath)
  ) {
    return null;
  }

  return assetPath;
}

function mimeTypeFor(assetPath: string) {
  switch (path.extname(assetPath).toLowerCase()) {
    case '.wasm':
      return 'application/wasm';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.icc':
      return 'application/vnd.iccprofile';
    default:
      return 'application/octet-stream';
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'EISDIR')
  );
}
