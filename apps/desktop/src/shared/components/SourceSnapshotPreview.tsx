import { convertFileSrc } from '@tauri-apps/api/core';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Children, Component, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { cn } from '@/lib/utils';
import type { SegmentType } from '@/shared/types/domain';

import { MermaidDiagramPreview } from './MermaidDiagramPreview';

import {
  isMineruImagePath,
  normalizeMathMarkdown
} from './sourceSnapshotMath';

export { isMineruImagePath } from './sourceSnapshotMath';

type SourceSnapshotPreviewProps = {
  allowScroll?: boolean;
  compact?: boolean;
  flush?: boolean;
  imageFillWidth?: boolean;
  markdown: string;
  previewMode?: 'parsed' | 'original';
  relatedImagePath?: string | null;
  segmentType?: SegmentType;
  sourceEntryId?: string | null;
  workspaceRoot?: string | null;
};

type TableCell = {
  colSpan?: number;
  rowSpan?: number;
  text: string;
};

type MarkdownPreviewErrorBoundaryProps = {
  children: ReactNode;
  fallback: string;
};

class MarkdownPreviewErrorBoundary extends Component<
  MarkdownPreviewErrorBoundaryProps,
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(previousProps: MarkdownPreviewErrorBoundaryProps) {
    if (previousProps.fallback !== this.props.fallback && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <span className="whitespace-pre-wrap break-words font-mono text-[0.92em]">
          {this.props.fallback}
        </span>
      );
    }

    return this.props.children;
  }
}

const PREVIEW_HTML_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'br',
    'em',
    'i',
    'strong',
    'b'
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': ['title'],
    a: ['href', 'title'],
    img: ['src', 'alt', 'title']
  }
};

export function SourceSnapshotPreview({
  allowScroll = true,
  compact = false,
  flush = false,
  imageFillWidth = false,
  markdown,
  previewMode = 'parsed',
  relatedImagePath,
  segmentType,
  sourceEntryId,
  workspaceRoot
}: SourceSnapshotPreviewProps) {
  const raw = normalizeLooseMarkdownBlocks(
    normalizeInlineHtml(decodeHtmlEntities(markdown.trim()))
  );
  const displayMarkdown = normalizeSegmentMarkdown(raw, segmentType);
  const htmlCandidate = displayMarkdown;
  const normalized = normalizeMathMarkdown(displayMarkdown, segmentType);
  const tableRows = parseHtmlTable(htmlCandidate);
  const directImageUrl = resolveSourceSnapshotAssetUrl(raw, workspaceRoot, sourceEntryId);
  const relatedImageUrl = relatedImagePath
    ? resolveSourceSnapshotAssetUrl(relatedImagePath, workspaceRoot, sourceEntryId)
    : null;

  if (previewMode === 'original') {
    if (relatedImageUrl) {
      return <PreviewImage alt="Source snapshot" fillWidth={imageFillWidth} src={relatedImageUrl} />;
    }
    if (directImageUrl) {
      return <PreviewImage alt="Source snapshot" fillWidth={imageFillWidth} src={directImageUrl} />;
    }
  }

  if (tableRows.length > 0) {
    return (
      <div
        className={cn(
          'source-snapshot-preview min-w-0 max-w-full overflow-hidden break-words [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden',
          compact && 'text-[0.95em] leading-normal',
          flush && 'source-snapshot-preview--flush'
        )}
      >
        {relatedImageUrl && previewMode !== 'original' ? (
          <PreviewImage alt="Source table" src={relatedImageUrl} />
        ) : null}
        <HtmlTablePreview
          allowScroll={allowScroll}
          compact={compact}
          flush={flush}
          rows={tableRows}
        />
      </div>
    );
  }

  if (directImageUrl && !hasReadableCaption(raw)) {
    return <PreviewImage alt="Source snapshot" src={directImageUrl} />;
  }

  return (
    <div
      className={cn(
        'source-snapshot-preview min-w-0 max-w-full overflow-hidden break-words [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden',
        compact && 'text-[0.95em] leading-normal',
        flush && 'source-snapshot-preview--flush'
      )}
    >
      {relatedImageUrl && previewMode !== 'original' ? (
        <PreviewImage
          alt="Source figure"
          className="mb-2"
          src={relatedImageUrl}
        />
      ) : null}
      <MarkdownPreviewErrorBoundary fallback={raw}>
        <ReactMarkdown
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
          code: ({ children, className }) => (
            <code
              className={cn(
                'break-words rounded bg-muted px-1 py-0.5 font-mono',
                flush ? 'text-[0.92em]' : 'text-[11px]',
                className
              )}
            >
              {children}
            </code>
          ),
          img: ({ alt, src }) => {
            const resolved = resolveSourceSnapshotAssetUrl(String(src ?? ''), workspaceRoot, sourceEntryId);
            return resolved ? (
              <PreviewImage
                alt={alt ?? 'Source snapshot'}
                className="my-1"
                src={resolved}
              />
            ) : (
              <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                {src}
              </code>
            );
          },
          pre: ({ children }) => {
            const mermaidCode = mermaidCodeFromPre(children);
            if (mermaidCode !== null) {
              return <MermaidDiagramPreview code={mermaidCode} compact={compact || flush} />;
            }
            return (
              <pre
                className={cn(
                  'min-w-0 max-w-full whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 font-mono',
                  flush ? 'my-0' : 'my-1',
                  flush ? 'text-[0.92em]' : 'text-[11px]',
                  allowScroll ? 'overflow-auto' : 'overflow-visible'
                )}
              >
                {children}
              </pre>
            );
          },
          table: ({ children }) => (
            <div
              className={cn(
                'min-w-0 max-w-full rounded-sm border',
                flush ? 'my-0' : 'my-1',
                allowScroll ? 'overflow-x-auto' : 'overflow-visible'
              )}
            >
              <table
                className={cn(
                  'min-w-0 w-full border-collapse text-left',
                  flush ? 'table-fixed text-inherit' : compact ? 'table-fixed text-[11px]' : 'text-xs'
                )}
              >
                {children}
              </table>
            </div>
          ),
          td: ({ children }) => (
            <td className="min-w-0 break-words whitespace-normal border px-1.5 py-1 align-top">
              {children}
            </td>
          ),
          th: ({ children }) => (
            <th className="min-w-0 break-words whitespace-normal border bg-muted/60 px-1.5 py-1 text-left font-semibold align-top">
              {children}
            </th>
          ),
          br: () => <br />
        }}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, PREVIEW_HTML_SCHEMA],
          [rehypeKatex, { strict: false, throwOnError: false }]
        ]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {normalized}
        </ReactMarkdown>
      </MarkdownPreviewErrorBoundary>
    </div>
  );
}

function mermaidCodeFromPre(children: ReactNode) {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) {
    return null;
  }
  if (!child.props.className?.split(' ').includes('language-mermaid')) {
    return null;
  }
  return String(child.props.children ?? '').replace(/\n$/, '');
}

function normalizeInlineHtml(value: string) {
  return value
    .replace(/<\/(?:sup|sub)>\s*<(?:sup|sub)\b[^>]*>/gi, ' ')
    .replace(/([^\s>])\s*<(?:sup|sub)\b[^>]*>/gi, '$1 ')
    .replace(/<\/(?:sup|sub)>\s*([^\s<])/gi, ' $1')
    .replace(/<\s*\/?(?:sup|sub)\b[^>]*>/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeLooseMarkdownBlocks(value: string) {
  return value
    .replace(/(^|\s)[鈥⑩棌]\s+/g, (_match, prefix: string) =>
      prefix.includes('\n') || prefix === '' ? '\n- ' : '\n- '
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function PreviewImage({
  alt,
  className,
  fillWidth = false,
  src
}: {
  alt: string;
  className?: string;
  fillWidth?: boolean;
  src: string;
}) {
  return (
    <img
      alt={alt}
      className={cn(
        'mx-auto block rounded-sm border object-contain',
        fillWidth ? 'h-auto w-full max-w-full' : 'max-h-64 max-w-full',
        className
      )}
      src={src}
    />
  );
}

function HtmlTablePreview({
  allowScroll,
  compact,
  flush,
  rows
}: {
  allowScroll: boolean;
  compact: boolean;
  flush: boolean;
  rows: TableCell[][];
}) {
  return (
    <div
      className={cn(
        'min-w-0 max-w-full rounded-sm border',
        allowScroll ? 'overflow-x-auto' : 'overflow-visible'
      )}
    >
      <table
        className={cn(
          'min-w-0 w-full border-collapse text-left',
          flush ? 'table-fixed text-inherit' : compact ? 'table-fixed text-[11px]' : 'text-xs'
        )}
      >
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  className="min-w-0 break-words whitespace-normal border px-1.5 py-1 align-top"
                  colSpan={cell.colSpan}
                  key={`${rowIndex}:${cellIndex}`}
                  rowSpan={cell.rowSpan}
                >
                  <TableCellMarkdown markdown={cell.text} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function normalizeSegmentMarkdown(value: string, segmentType?: SegmentType) {
  if (segmentType !== 'list') {
    return value;
  }
  if (/^(?:[-*+] |\d+[.)] )/m.test(value.trim())) {
    return value;
  }
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n');
}

function TableCellMarkdown({ markdown }: { markdown: string }) {
  const normalized = normalizeMathMarkdown(normalizeInlineHtml(decodeHtmlEntities(markdown)));

  return (
    <MarkdownPreviewErrorBoundary fallback={markdown}>
      <ReactMarkdown
        components={{
          p: ({ children }) => <>{children}</>,
          code: ({ children }) => <code className="font-mono">{children}</code>
        }}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        remarkPlugins={[remarkMath]}
      >
        {normalized}
      </ReactMarkdown>
    </MarkdownPreviewErrorBoundary>
  );
}

function decodeHtmlEntities(value: string) {
  if (!/&(?:lt|gt|amp|quot|#39);/i.test(value) || typeof document === 'undefined') {
    return value;
  }
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}


function parseHtmlTable(value: string): TableCell[][] {
  if (!/<table[\s>]/i.test(value)) {
    return [];
  }

  try {
    const parser = new DOMParser();
    const document = parser.parseFromString(value, 'text/html');
    return [...document.querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll('th,td')].map((cell) => ({
        colSpan: numberAttr(cell, 'colspan'),
        rowSpan: numberAttr(cell, 'rowspan'),
        text: (cell.textContent ?? '').trim()
      }))
    );
  } catch {
    return [];
  }
}

function numberAttr(element: Element, name: string) {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) && value > 1 ? value : undefined;
}

export function resolveSourceSnapshotAssetUrl(
  value: string,
  workspaceRoot?: string | null,
  sourceEntryId?: string | null
) {
  const normalized = value.trim().replace(/^<|>$/g, '');
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  if (/^(?:data:|blob:|file:)/i.test(normalized)) {
    return normalized;
  }
  if (isAbsoluteLocalPath(normalized)) {
    try {
      return convertFileSrc(normalized);
    } catch {
      return null;
    }
  }
  if (!workspaceRoot || !sourceEntryId) {
    return null;
  }

  if (!isMineruImagePath(normalized) && !looksLikeLocalRelativePath(normalized)) {
    return null;
  }

  const relative = normalized
    .replace(/^[./\\]+/, '')
    .replace(/\//g, '\\');
  const root = `${workspaceRoot}\\entries\\${sourceEntryId}`;

  if (isNoteAssetPath(relative)) {
    try {
      return convertFileSrc(`${root}\\notes\\${relative}`);
    } catch {
      return null;
    }
  }

  const mineruRelative = relative.replace(/^mineru-output[\\/]/i, '');
  try {
    return convertFileSrc(`${root}\\mineru-output\\${mineruRelative}`);
  } catch {
    return null;
  }
}

export function resolveMineruAssetUrl(
  value: string,
  workspaceRoot?: string | null,
  sourceEntryId?: string | null
) {
  return resolveSourceSnapshotAssetUrl(value, workspaceRoot, sourceEntryId);
}


function hasReadableCaption(value: string) {
  return !isMineruImagePath(value);
}

function looksLikeLocalRelativePath(value: string) {
  return /^(?:\.{1,2}[\\/]|[A-Za-z0-9._-]+[\\/])/.test(value.trim());
}

function isNoteAssetPath(value: string) {
  return /^[^\\/]+\.assets[\\/]/i.test(value.trim());
}

function isAbsoluteLocalPath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value.trim()) || value.trim().startsWith('\\\\') || value.trim().startsWith('/');
}
