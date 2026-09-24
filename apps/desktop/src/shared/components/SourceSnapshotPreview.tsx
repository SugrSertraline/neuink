import { resolveSourceSnapshotAssetUrl } from './sourceSnapshotAssets';
export { resolveSourceSnapshotAssetUrl, resolveMineruAssetUrl } from './sourceSnapshotAssets';
import 'katex/dist/katex.min.css';
import { Children, Component, isValidElement, memo, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { cn } from '@/lib/utils';
import type { SegmentType } from '@/shared/types/domain';
import { SourceSnapshotImage as PreviewImage } from './SourceSnapshotImage';
import { SourceSnapshotTable } from './SourceSnapshotTable';

import { MermaidDiagramPreview } from './MermaidDiagramPreview';

import {
  isMineruImagePath,
  normalizeMathMarkdown
} from './sourceSnapshotMath';

export { isMineruImagePath } from './sourceSnapshotMath';

export type SourceSnapshotImageSize = 'compact' | 'standard' | 'large' | 'full';

type SourceSnapshotPreviewProps = {
  renderInlineText?: (children: ReactNode) => ReactNode;
  allowScroll?: boolean;
  /** When provided, resolve images only from these verified assets, never from the document's URLs. */
  assetUrls?: Readonly<Record<string, string>>;
  compact?: boolean;
  flush?: boolean;
  imageDetailEnabled?: boolean;
  imageFillWidth?: boolean;
  imageSize?: SourceSnapshotImageSize;
  tableDetailEnabled?: boolean;
  onImageError?: () => void;
  markdown: string;
  previewMode?: 'parsed' | 'original';
  relatedImagePath?: string | null;
  segmentType?: SegmentType;
  sourceEntryId?: string | null;
  showMermaidDiagrams?: boolean;
  mermaidAsCode?: boolean;
  workspaceRoot?: string | null;
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
    'b',
    'caption',
    'colgroup',
    'col'
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': ['title'],
    a: ['href', 'title'],
    img: ['src', 'alt', 'title'],
    td: ['colSpan', 'rowSpan', 'align'],
    th: ['colSpan', 'rowSpan', 'align', 'scope']
  }
};

// Previews mount and unmount constantly while hovering. The normalization
// pipeline (regex passes, HTML entity decoding, DOMParser table extraction,
// asset URL resolution) is pure, so cache the derived values per input set
// and let repeated hovers skip straight to rendering.
type SnapshotDerivations = {
  directImageUrl: string | null;
  displayMarkdown: string;
  normalized: string;
  raw: string;
  relatedImageUrl: string | null;
};

const derivationCache = new Map<string, SnapshotDerivations>();
const DERIVATION_CACHE_LIMIT = 256;

function deriveSnapshotValues(
  markdown: string,
  segmentType: SegmentType | undefined,
  workspaceRoot: string | null | undefined,
  sourceEntryId: string | null | undefined,
  relatedImagePath: string | null | undefined
): SnapshotDerivations {
  const cacheKey = `${markdown}\u0000${segmentType ?? ''}\u0000${workspaceRoot ?? ''}\u0000${sourceEntryId ?? ''}\u0000${relatedImagePath ?? ''}`;
  const cached = derivationCache.get(cacheKey);
  if (cached) {
    derivationCache.delete(cacheKey);
    derivationCache.set(cacheKey, cached);
    return cached;
  }

  const raw = normalizeLooseMarkdownBlocks(
    normalizeInlineHtml(decodeHtmlEntities(markdown.trim()))
  );
  const displayMarkdown = normalizeSegmentMarkdown(raw, segmentType);
  const values: SnapshotDerivations = {
    directImageUrl: resolveSourceSnapshotAssetUrl(raw, workspaceRoot, sourceEntryId),
    displayMarkdown,
    // Repair prose separately: HTML tags must not participate in the math
    // heuristics, otherwise valid cell delimiters can be discarded.
    normalized: displayMarkdown.split(/(<table\b[\s\S]*?<\/table>)/gi)
      .map((part) => /^<table\b/i.test(part) ? part : normalizeMathMarkdown(part, segmentType)).join(''),
    raw,
    relatedImageUrl: relatedImagePath
      ? resolveSourceSnapshotAssetUrl(relatedImagePath, workspaceRoot, sourceEntryId)
      : null
  };
  derivationCache.set(cacheKey, values);
  while (derivationCache.size > DERIVATION_CACHE_LIMIT) {
    const oldest = derivationCache.keys().next().value;
    if (typeof oldest !== 'string') break;
    derivationCache.delete(oldest);
  }
  return values;
}

function SourceSnapshotPreviewImpl({
  renderInlineText,
  allowScroll = true,
  assetUrls,
  compact = false,
  flush = false,
  imageDetailEnabled = false,
  imageFillWidth = false,
  imageSize = 'standard',
  tableDetailEnabled = false,
  onImageError,
  markdown,
  previewMode = 'parsed',
  relatedImagePath,
  segmentType,
  sourceEntryId,
  showMermaidDiagrams = true,
  mermaidAsCode = false,
  workspaceRoot
}: SourceSnapshotPreviewProps) {
  const inlineComponents = useMemo(() => renderInlineText ? {
    p: ({ children }: { children?: ReactNode }) => <p>{renderInlineText(children)}</p>,
    li: ({ children }: { children?: ReactNode }) => <li>{renderInlineText(children)}</li>
  } : {}, [renderInlineText]);
  const {
    directImageUrl: derivedDirectImageUrl,
    displayMarkdown,
    normalized,
    raw,
    relatedImageUrl: derivedRelatedImageUrl
  } = deriveSnapshotValues(
    markdown,
    segmentType,
    workspaceRoot,
    sourceEntryId,
    relatedImagePath
  );
  const verifiedAsset = (path: string) => assetUrls && Object.prototype.hasOwnProperty.call(assetUrls, path) ? assetUrls[path] : null;
  const directImageUrl = assetUrls ? verifiedAsset(raw) : derivedDirectImageUrl;
  const relatedImageUrl = assetUrls ? verifiedAsset(relatedImagePath ?? '') : derivedRelatedImageUrl;

  if (previewMode === 'original') {
    if (relatedImageUrl) {
      return <PreviewImage alt="Source snapshot" detailEnabled={imageDetailEnabled} onError={onImageError} fillWidth={imageFillWidth} size={imageSize} src={relatedImageUrl} />;
    }
    if (directImageUrl) {
      return <PreviewImage alt="Source snapshot" detailEnabled={imageDetailEnabled} onError={onImageError} fillWidth={imageFillWidth} size={imageSize} src={directImageUrl} />;
    }
  }

  if (directImageUrl && !hasReadableCaption(raw)) {
    return <PreviewImage alt="Source snapshot" detailEnabled={imageDetailEnabled} onError={onImageError} fillWidth={imageFillWidth} size={imageSize} src={directImageUrl} />;
  }

  // Most hovered segments are plain paragraphs. Running them through the full
  // remark/rehype/KaTeX pipeline made every preview mount noticeably slow, so
  // render syntax-free text directly and keep the pipeline for content that
  // actually needs it.
  if (isPlainMarkdownText(normalized)) {
    return (
      <div
        className={cn(
          'source-snapshot-preview min-w-0 max-w-full break-words',
          compact && 'text-[0.95em] leading-normal',
          flush && 'source-snapshot-preview--flush'
        )}
      >
        {relatedImageUrl && previewMode !== 'original' && (segmentType !== 'table' || !displayMarkdown) ? (
          <PreviewImage
            alt="Source figure"
            className="mb-2"
            detailEnabled={imageDetailEnabled} onError={onImageError}
            fillWidth={imageFillWidth} size={imageSize}
            src={relatedImageUrl}
          />
        ) : null}
        <p className="whitespace-pre-wrap break-words">{renderInlineText ? renderInlineText(normalized) : normalized}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'source-snapshot-preview min-w-0 max-w-full overflow-hidden break-words [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden',
        compact && 'text-[0.95em] leading-normal',
        flush && 'source-snapshot-preview--flush'
      )}
      data-material="source-paper"
    >
      {relatedImageUrl && previewMode !== 'original' && (segmentType !== 'table' || !displayMarkdown) ? (
        <PreviewImage
          alt="Source figure"
          className="mb-2"
          detailEnabled={imageDetailEnabled} onError={onImageError}
          fillWidth={imageFillWidth} size={imageSize}
          src={relatedImageUrl}
        />
      ) : null}
      <MarkdownPreviewErrorBoundary fallback={raw}>
        <ReactMarkdown
        components={{
          ...inlineComponents,
          a: ({ children, href }) => (
            <a href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
          code: ({ children, className }) => (
            <code
              className={cn(
                'break-words rounded bg-muted px-1 py-0.5 font-mono',
                flush || compact ? 'text-[0.92em]' : 'text-[0.8em]',
                className
              )}
            >
              {children}
            </code>
          ),
          img: ({ alt, src }) => {
            const resolved = assetUrls ? verifiedAsset(String(src ?? ''))
              : resolveSourceSnapshotAssetUrl(String(src ?? ''), workspaceRoot, sourceEntryId);
            return resolved ? (
              <PreviewImage
                alt={alt ?? 'Source snapshot'}
                className="my-1"
                detailEnabled={imageDetailEnabled} onError={onImageError}
                fillWidth={imageFillWidth} size={imageSize}
                src={resolved}
              />
            ) : assetUrls ? (
              <span role="note" className="my-2 block rounded-sm border border-dashed p-2 text-xs">图片缺失或不可用，无法预览。</span>
            ) : (
              <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                {src}
              </code>
            );
          },
          pre: ({ children }) => {
            const mermaidCode = mermaidCodeFromPre(children);
            if (mermaidCode !== null && !mermaidAsCode) {
              return showMermaidDiagrams
                ? <MermaidDiagramPreview code={mermaidCode} compact={compact || flush} />
                : null;
            }
            return (
              <pre
                className={cn(
                  'min-w-0 max-w-full whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 font-mono',
                  flush ? 'my-0' : 'my-1',
                  flush || compact || segmentType === 'code' ? 'text-[0.92em]' : 'text-[0.8em]',
                  allowScroll ? 'overflow-auto' : 'overflow-visible'
                )}
              >
                {children}
              </pre>
            );
          },
          table: ({ children, node }) => (
            <SourceSnapshotTable node={node} allowScroll={allowScroll} detailEnabled={tableDetailEnabled} compact={compact} flush={flush}>{children}</SourceSnapshotTable>
          ),
          td: ({ children, colSpan, rowSpan }) => (
            <td colSpan={colSpan} rowSpan={rowSpan} className="min-w-0 whitespace-normal border-b border-r px-2 py-1 align-top">{tableCellContent(children)}</td>
          ),
          th: ({ children, colSpan, rowSpan }) => (
            <th colSpan={colSpan} rowSpan={rowSpan} className="min-w-0 whitespace-normal border-b border-r bg-muted px-2 py-1 text-left font-semibold align-top">{tableCellContent(children)}</th>
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

export const SourceSnapshotPreview = memo(SourceSnapshotPreviewImpl);

// Raw HTML cells bypass remark-math. Render only their raw math strings;
// already-rendered Markdown, links and merged-cell structure remain untouched.
function tableCellContent(children: ReactNode) {
  return Children.map(children, (child) => typeof child === 'string' && /\$|\\[[(]/.test(child)
    ? <MarkdownPreviewErrorBoundary fallback={child}>
        <ReactMarkdown components={{ p: ({ children: content }) => <>{content}</> }}
          remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>
          {child.includes('$') ? child : normalizeMathMarkdown(child)}
        </ReactMarkdown>
      </MarkdownPreviewErrorBoundary>
    : child);
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

// Detects text that contains no markdown-relevant syntax, so it can skip the
// remark/rehype pipeline entirely. Deliberately conservative: any doubtful
// input falls back to the full markdown render.
const MARKDOWN_SYNTAX_PATTERN =
  /(?:^|\n)\s{0,3}(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|)|[*_`~]{1,2}\S|\$\$?|\[[^\]]*]\([^)]*\)|<\/?[a-z][^>]*>|\bhttps?:\/\/\S+|\\[[(]|\r/;

function isPlainMarkdownText(value: string) {
  return !MARKDOWN_SYNTAX_PATTERN.test(value);
}

function normalizeLooseMarkdownBlocks(value: string) {
  return value
    .replace(/(^|\s)[•‣▪]\s+/g, (_match, prefix: string) =>
      prefix.includes('\n') || prefix === '' ? '\n- ' : '\n- '
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

function decodeHtmlEntities(value: string) {
  if (!/&(?:lt|gt|amp|quot|#39);/i.test(value) || typeof document === 'undefined') {
    return value;
  }
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}


function hasReadableCaption(value: string) {
  return !isMineruImagePath(value);
}
