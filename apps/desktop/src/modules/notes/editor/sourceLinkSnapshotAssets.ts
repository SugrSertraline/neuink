import type { PDFDocumentProxy } from 'pdfjs-dist';
import { createPdfDocumentOptions } from '@/modules/reader/components/pdf-reader/pdfDocumentOptions';
import { readPdfBytes, readPdfReader } from '@/shared/ipc/workspaceApi';
import { saveOwnedNoteAssetBytes } from '@/shared/ipc/noteOwnerApi';
import type { SourceLinkAttrs as SourceLinkNodeAttrs, SourceLinkSnapshotAssetContext } from './SourceLinkNode';

const originalSnapshotAssetSaves = new Map<string, Promise<string | null>>();
const SOURCE_PDF_CACHE_LIMIT = 2;
const SOURCE_PDF_IDLE_DISPOSE_MS = 30_000;

type SourcePdfDocumentResource = {
  disposeTimer: number | null;
  lastUsedAt: number;
  promise: Promise<OwnedSourcePdfDocument | null>;
  refCount: number;
};

type OwnedSourcePdfDocument = {
  destroy: () => Promise<void>;
  document: PDFDocumentProxy;
};

const sourcePdfDocumentLoads = new Map<string, SourcePdfDocumentResource>();

export function resolveSourcePdfDocument(
  pdfDocument: PDFDocumentProxy | null,
  attrs: SourceLinkNodeAttrs,
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null
) {
  // The mounted reader may belong to the note owner, not this citation's source.
  if (pdfDocument && (!snapshotAssetContext || snapshotAssetContext.entryId === attrs.sourceEntryId)) {
    return Promise.resolve({ document: pdfDocument, release: () => undefined });
  }
  if (!snapshotAssetContext?.workspaceRoot || !attrs.sourceEntryId) {
    return Promise.resolve({ document: null, release: () => undefined });
  }

  const cacheKey = [
    snapshotAssetContext.workspaceRoot,
    attrs.sourceEntryId
  ].join('|');
  const existing = sourcePdfDocumentLoads.get(cacheKey);
  if (existing) {
    existing.refCount += 1;
    existing.lastUsedAt = Date.now();
    if (existing.disposeTimer !== null) {
      window.clearTimeout(existing.disposeTimer);
      existing.disposeTimer = null;
    }
    sourcePdfDocumentLoads.delete(cacheKey);
    sourcePdfDocumentLoads.set(cacheKey, existing);
    return existing.promise.then((document) => ({
      document: document?.document ?? null,
      release: releaseSourcePdfDocument(cacheKey, existing)
    }));
  }

  const resource: SourcePdfDocumentResource = {
    disposeTimer: null,
    lastUsedAt: Date.now(),
    promise: Promise.resolve(null),
    refCount: 1
  };
  resource.promise = loadSourcePdfDocument(
    snapshotAssetContext.workspaceRoot,
    attrs.sourceEntryId
  ).catch(() => null).then((document) => {
    if (!document && sourcePdfDocumentLoads.get(cacheKey) === resource) {
      sourcePdfDocumentLoads.delete(cacheKey);
    }
    return document;
  });
  sourcePdfDocumentLoads.set(cacheKey, resource);
  trimSourcePdfDocumentCache();
  return resource.promise.then((document) => ({
    document: document?.document ?? null,
    release: releaseSourcePdfDocument(cacheKey, resource)
  }));
}

function releaseSourcePdfDocument(cacheKey: string, resource: SourcePdfDocumentResource) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    resource.refCount = Math.max(0, resource.refCount - 1);
    resource.lastUsedAt = Date.now();
    if (resource.refCount > 0 || sourcePdfDocumentLoads.get(cacheKey) !== resource) return;
    resource.disposeTimer = window.setTimeout(() => {
      disposeSourcePdfDocument(cacheKey, resource);
    }, SOURCE_PDF_IDLE_DISPOSE_MS);
  };
}

function trimSourcePdfDocumentCache() {
  if (sourcePdfDocumentLoads.size <= SOURCE_PDF_CACHE_LIMIT) return;
  const candidates = [...sourcePdfDocumentLoads.entries()]
    .filter(([, resource]) => resource.refCount === 0)
    .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt);
  for (const [key, resource] of candidates) {
    if (sourcePdfDocumentLoads.size <= SOURCE_PDF_CACHE_LIMIT) break;
    disposeSourcePdfDocument(key, resource);
  }
}

function disposeSourcePdfDocument(cacheKey: string, resource: SourcePdfDocumentResource) {
  if (resource.refCount > 0 || sourcePdfDocumentLoads.get(cacheKey) !== resource) return;
  sourcePdfDocumentLoads.delete(cacheKey);
  if (resource.disposeTimer !== null) {
    window.clearTimeout(resource.disposeTimer);
    resource.disposeTimer = null;
  }
  void resource.promise.then((document) => document?.destroy());
}

async function loadSourcePdfDocument(root: string, sourceEntryId: string) {
  const reader = await readPdfReader(root, sourceEntryId);
  const bytes = await readPdfBytes(reader.pdf_path);
  const [pdfjsLib, pdfWorkerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?worker')
  ]);
  if (
    typeof window !== 'undefined' &&
    'Worker' in window &&
    !pdfjsLib.GlobalWorkerOptions.workerPort
  ) {
    const PdfWorker = pdfWorkerModule.default;
    pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
  }
  const loadingTask = pdfjsLib.getDocument(createPdfDocumentOptions(new Uint8Array(bytes)));
  const document = await loadingTask.promise;
  return {
    destroy: () => loadingTask.destroy(),
    document
  };
}

export function buildOriginalSnapshotCacheKey(
  attrs: SourceLinkNodeAttrs,
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null
) {
  if (
    !snapshotAssetContext?.workspaceRoot ||
    !attrs.sourceEntryId ||
    !attrs.segmentUid ||
    !attrs.page ||
    !attrs.sourceBbox
  ) {
    return null;
  }

  return [
    'neuink.sourceLinkOriginalSnapshot.v1',
    snapshotAssetContext.workspaceRoot,
    snapshotAssetContext.entryId,
    snapshotAssetContext.noteId,
    attrs.sourceEntryId,
    attrs.segmentUid,
    attrs.page,
    attrs.sourceBbox.map((value) => Number(value).toFixed(3)).join(',')
  ].join('|');
}

export function readOriginalSnapshotAssetCache(cacheKey: string) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(cacheKey);
  } catch {
    return null;
  }
}

function writeOriginalSnapshotAssetCache(cacheKey: string, assetPath: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(cacheKey, assetPath);
  } catch {
    // Best-effort cache only. The preview can still use the in-memory data URL.
  }
}

export async function persistOriginalSnapshotAsset(
  cacheKey: string,
  dataUrl: string,
  attrs: SourceLinkNodeAttrs,
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null
) {
  const existing = originalSnapshotAssetSaves.get(cacheKey);
  if (existing) {
    return existing;
  }

  const task = persistOriginalSnapshotAssetOnce(dataUrl, attrs, snapshotAssetContext)
    .then((assetPath) => {
      if (assetPath) {
        writeOriginalSnapshotAssetCache(cacheKey, assetPath);
      }
      return assetPath;
    })
    .catch(() => null)
    .finally(() => originalSnapshotAssetSaves.delete(cacheKey));
  originalSnapshotAssetSaves.set(cacheKey, task);
  return task;
}

async function persistOriginalSnapshotAssetOnce(
  dataUrl: string,
  attrs: SourceLinkNodeAttrs,
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null
) {
  const payload = parsePngDataUrl(dataUrl);
  if (!payload || !snapshotAssetContext?.workspaceRoot) {
    return null;
  }

  const saved = await saveOwnedNoteAssetBytes(
    snapshotAssetContext.workspaceRoot,
    snapshotAssetContext.noteOwner ?? { kind: 'entry', entry_id: snapshotAssetContext.entryId },
    snapshotAssetContext.noteId,
    payload.mimeType,
    payload.base64,
    originalSnapshotAssetFileName(attrs)
  );
  return saved.markdown_path;
}

function parsePngDataUrl(value: string) {
  const match = /^data:(image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) {
    return null;
  }
  return {
    base64: match[2],
    mimeType: match[1]
  };
}

function originalSnapshotAssetFileName(attrs: SourceLinkNodeAttrs) {
  const segmentUid = (attrs.segmentUid || attrs.anchorId || 'source-link')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `source-original-${segmentUid || 'snapshot'}.png`;
}
