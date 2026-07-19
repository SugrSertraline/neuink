import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { UI_TERMS, pageLabel } from '@/shared/lib/uiTerminology';
import {
  readNote,
  readPdfReader,
  type SearchHit
} from '@/shared/ipc/workspaceApi';
import type {
  NoteDocument,
  SegmentBlockNote,
  SourceSegment
} from '@/shared/types/domain';

type SearchResultPreviewProps = {
  hit: SearchHit;
  query: string;
  root: string | null;
};

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; data: SearchPreviewData }
  | { status: 'error'; error: string };

type SearchPreviewData =
  | {
      kind: 'entry';
    }
  | {
      kind: 'note';
      note: NoteDocument;
    }
  | {
      kind: 'page';
      segments: SourceSegment[];
    }
  | {
      kind: 'segment';
      segment: SourceSegment;
      segmentNote: SegmentBlockNote | null;
    };

const pdfReaderCache = new Map<string, ReturnType<typeof readPdfReader>>();
const noteCache = new Map<string, ReturnType<typeof readNote>>();
const PDF_READER_CACHE_LIMIT = 16;
const NOTE_CACHE_LIMIT = 64;

export function SearchResultPreview({
  hit,
  query,
  root
}: SearchResultPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    void loadPreviewData(root, hit)
      .then((data) => {
        if (!cancelled) {
          setState({ status: 'ready', data });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hit, root]);

  return (
    <div className="text-xs leading-5">
      <PreviewHeader hit={hit} />
      <div className="mt-2 max-h-[min(28rem,calc(100vh-5rem))] min-w-0 overflow-auto overscroll-contain">
        {state.status === 'loading' ? (
          <div className="flex items-center gap-2 rounded-sm bg-muted/50 px-2 py-3 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            <span>正在加载预览</span>
          </div>
        ) : state.status === 'error' ? (
          <div className="rounded-sm border border-destructive/25 bg-destructive/5 px-2 py-2 text-destructive">
            {state.error}
          </div>
        ) : (
          <PreviewContent data={state.data} hit={hit} query={query} root={root} />
        )}
      </div>
    </div>
  );
}

function PreviewHeader({ hit }: { hit: SearchHit }) {
  const pageIdx =
    hit.target.kind === 'page' || hit.target.kind === 'segment'
      ? hit.target.page_idx
      : null;

  return (
    <div className="min-w-0 border-b pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="secondary">{hit.source.label}</Badge>
        {pageIdx !== null && pageIdx >= 0 ? (
          <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
            {pageLabel(pageIdx)}
          </span>
        ) : null}
      </div>
      <div className="mt-1 min-w-0 truncate font-semibold">{hit.title}</div>
      <div className="mt-0.5 min-w-0 truncate text-[11px] text-muted-foreground">
        {hit.entry_title}
      </div>
    </div>
  );
}

function PreviewContent({
  data,
  hit,
  query,
  root
}: {
  data: SearchPreviewData;
  hit: SearchHit;
  query: string;
  root: string | null;
}) {
  if (data.kind === 'note') {
    const context = contextExcerpt(
      data.note.markdown || hit.snippet,
      [query, ...hit.matched_terms],
      900
    );

    return (
      <div className="space-y-2">
        <MetadataRow label={UI_TERMS.entry} value={hit.entry_title} />
        <MetadataRow label="笔记" value={data.note.title} />
        <div>
          <div className="mb-1 text-[11px] font-semibold text-foreground/70">
            命中上下文
          </div>
          <div className="whitespace-pre-wrap rounded-sm bg-muted/45 px-2 py-2 text-muted-foreground">
            <HighlightedContext
              query={query}
              terms={hit.matched_terms}
              text={context || hit.snippet}
            />
          </div>
        </div>
      </div>
    );
  }

  if (data.kind === 'segment') {
    const snapshot = data.segment.markdown ?? data.segment.text;

    return (
      <div className="space-y-2">
        {hit.source.kind === 'segment_note' && data.segmentNote?.text ? (
          <div>
            <div className="mb-1 text-[11px] font-semibold text-foreground/70">
              {UI_TERMS.segmentNote}命中
            </div>
            <div className="whitespace-pre-wrap rounded-sm bg-muted/45 px-2 py-2 text-muted-foreground">
              <HighlightedContext
                query={query}
                terms={hit.matched_terms}
                text={contextExcerpt(
                  data.segmentNote.text,
                  [query, ...hit.matched_terms],
                  600
                )}
              />
            </div>
          </div>
        ) : null}
        {hit.source.kind === 'annotation' ? (
          <div>
            <div className="mb-1 text-[11px] font-semibold text-foreground/70">
              批注命中
            </div>
            <div className="whitespace-pre-wrap rounded-sm bg-muted/45 px-2 py-2 text-muted-foreground">
              <HighlightedContext
                query={query}
                terms={hit.matched_terms}
                text={contextExcerpt(hit.snippet, [query, ...hit.matched_terms], 600)}
              />
            </div>
          </div>
        ) : null}
        <div>
          <div className="mb-1 text-[11px] font-semibold text-foreground/70">
            {UI_TERMS.segment}
          </div>
          <div className="rounded-sm border bg-background px-2 py-2 text-muted-foreground">
            <SourceSnapshotPreview
              markdown={snapshot}
              relatedImagePath={data.segment.asset_path}
              segmentType={data.segment.segment_type}
              sourceEntryId={hit.entry_id}
              workspaceRoot={root}
            />
          </div>
        </div>
      </div>
    );
  }

  if (data.kind === 'page') {
    const pageIdx = hit.target.kind === 'page' ? hit.target.page_idx : 0;
    const snapshot = data.segments
      .map((segment) => segment.markdown ?? segment.text)
      .filter((text) => text.trim().length > 0)
      .join('\n\n');

    return (
      <div className="space-y-2">
        <MetadataRow label={UI_TERMS.entry} value={hit.entry_title} />
        <MetadataRow label="页码" value={pageLabel(pageIdx)} />
        <div>
          <div className="mb-1 text-[11px] font-semibold text-foreground/70">
            页面命中上下文
          </div>
          <div className="whitespace-pre-wrap rounded-sm bg-muted/45 px-2 py-2 text-muted-foreground">
            <HighlightedContext
              query={query}
              terms={hit.matched_terms}
              text={contextExcerpt(
                snapshot || hit.snippet,
                [query, ...hit.matched_terms],
                1200
              )}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <MetadataRow label="Entry" value={hit.entry_title} />
      <div>
        <div className="mb-1 text-[11px] font-semibold text-foreground/70">
          命中上下文
        </div>
        <div className="whitespace-pre-wrap rounded-sm bg-muted/45 px-2 py-2 text-muted-foreground">
          <HighlightedContext
            query={query}
            terms={hit.matched_terms}
            text={hit.snippet}
          />
        </div>
      </div>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2 text-[11px]">
      <span className="shrink-0 font-semibold text-foreground/70">{label}</span>
      <span className="min-w-0 truncate text-muted-foreground">{value}</span>
    </div>
  );
}

function HighlightedContext({
  query,
  terms,
  text
}: {
  query: string;
  terms: string[];
  text: string;
}) {
  const needles = Array.from(
    new Set([query.trim(), ...terms].filter((term) => term.trim().length > 0))
  ).sort((left, right) => right.length - left.length);

  if (needles.length === 0) {
    return <>{text}</>;
  }

  const lowerText = text.toLocaleLowerCase();
  const lowerNeedles = needles.map((term) => term.toLocaleLowerCase());
  const parts: Array<{ highlight: boolean; value: string }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    let nextIndex = -1;
    let nextNeedle = '';

    lowerNeedles.forEach((needle, index) => {
      const found = lowerText.indexOf(needle, cursor);
      if (
        found >= 0 &&
        (nextIndex < 0 ||
          found < nextIndex ||
          (found === nextIndex && needle.length > nextNeedle.length))
      ) {
        nextIndex = found;
        nextNeedle = needles[index];
      }
    });

    if (nextIndex < 0) {
      parts.push({ highlight: false, value: text.slice(cursor) });
      break;
    }

    if (nextIndex > cursor) {
      parts.push({ highlight: false, value: text.slice(cursor, nextIndex) });
    }

    parts.push({
      highlight: true,
      value: text.slice(nextIndex, nextIndex + nextNeedle.length)
    });
    cursor = nextIndex + nextNeedle.length;
  }

  return (
    <>
      {parts.map((part, index) =>
        part.highlight ? (
          <mark
            className="rounded bg-primary/15 px-0.5 font-semibold text-primary"
            key={`${part.value}-${index}`}
          >
            {part.value}
          </mark>
        ) : (
          <span key={`${part.value}-${index}`}>{part.value}</span>
        )
      )}
    </>
  );
}

async function loadPreviewData(
  root: string | null,
  hit: SearchHit
): Promise<SearchPreviewData> {
  if (!root) {
    throw new Error('Workspace is not ready.');
  }

  const target = hit.target;

  if (target.kind === 'note') {
    const note = await cachedReadNote(root, target.entry_id, target.note_id);
    return { kind: 'note', note };
  }

  if (target.kind === 'page') {
    const reader = await cachedReadPdfReader(root, target.entry_id);
    return {
      kind: 'page',
      segments: reader.segments.filter(
        (segment) => segment.page_idx === target.page_idx
      )
    };
  }

  if (target.kind === 'segment') {
    const reader = await cachedReadPdfReader(root, target.entry_id);
    const segment = reader.segments.find(
      (item) =>
        item.uid === target.segment_uid ||
        item.continuation_group_id === target.segment_uid
    );
    if (!segment) {
      throw new Error('Segment no longer exists.');
    }

    return {
      kind: 'segment',
      segment,
      segmentNote:
        reader.segment_notes.find(
          (note) => note.segment_uid === target.segment_uid
        ) ?? null
    };
  }

  return { kind: 'entry' };
}

function cachedReadPdfReader(root: string, entryId: string) {
  const key = `${root}\u0000${entryId}`;
  const cached = pdfReaderCache.get(key);
  if (cached) {
    pdfReaderCache.delete(key);
    pdfReaderCache.set(key, cached);
    return cached;
  }

  const next = readPdfReader(root, entryId).catch((error) => {
    pdfReaderCache.delete(key);
    throw error;
  });
  pdfReaderCache.set(key, next);
  trimPromiseCache(pdfReaderCache, PDF_READER_CACHE_LIMIT);
  return next;
}

function cachedReadNote(root: string, entryId: string, noteId: string) {
  const key = `${root}\u0000${entryId}\u0000${noteId}`;
  const cached = noteCache.get(key);
  if (cached) {
    noteCache.delete(key);
    noteCache.set(key, cached);
    return cached;
  }

  const next = readNote(root, entryId, noteId).catch((error) => {
    noteCache.delete(key);
    throw error;
  });
  noteCache.set(key, next);
  trimPromiseCache(noteCache, NOTE_CACHE_LIMIT);
  return next;
}

function trimPromiseCache<T>(cache: Map<string, Promise<T>>, limit: number) {
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') return;
    cache.delete(oldest);
  }
}

function contextExcerpt(value: string, terms: string[], maxLength: number) {
  const text = value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxLength) {
    return text;
  }

  const lowerText = text.toLocaleLowerCase();
  const needle = terms
    .map((term) => term.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .find((term) => lowerText.includes(term.toLocaleLowerCase()));
  const hitIndex = needle ? lowerText.indexOf(needle.toLocaleLowerCase()) : 0;
  const start = Math.max(0, hitIndex - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';

  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}
