import { type Editor, type MarkdownParseHelpers, Node, mergeAttributes } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { createElement } from 'react';

import type { SegmentType, SourceLink } from '@/shared/types/domain';

import { SourceLinkNodeView } from './SourceLinkNodeView';

export type SourceLinkOpenTarget = {
  page: number | null;
  segmentUid: string | null;
  sourceEntryId: string | null;
};

type SourceLinkAttrs = {
  anchorId: string;
  displayText?: string | null;
  expanded?: boolean | null;
  previewAlignment?: 'left' | 'center' | 'right' | null;
  previewMode?: 'parsed' | 'original' | null;
  previewWidth?: number | null;
  page?: number | null;
  sourceBbox?: [number, number, number, number] | null;
  segmentUid?: string | null;
  sourceEntryId?: string | null;
  segmentType?: SegmentType | null;
  snapshotAssetPath?: string | null;
  snapshotText?: string | null;
  workspaceRoot?: string | null;
};

type MarkdownNode = {
  attrs?: SourceLinkAttrs;
};

type SourceLinkToken = {
  raw?: string;
  text?: string;
};

type HydratedSourceLink = SourceLinkAttrs & {
  anchorId: string;
};

export type SourceLinkSnapshotAssetContext = {
  entryId: string;
  noteId: string;
  workspaceRoot: string | null;
};

export const SourceLinkNode = Node.create({
  name: 'sourceLink',

  // Run before generic inline handling so our persisted reference marker is
  // always reconstructed as one sourceLink atom during Markdown parsing.
  priority: 1100,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      onOpenSourceLink: null as ((target: SourceLinkOpenTarget) => void) | null,
      getPdfDocument: null as (() => PDFDocumentProxy | null) | null,
      snapshotAssetContext: null as SourceLinkSnapshotAssetContext | null
    };
  },

  addAttributes() {
    return {
      anchorId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-anchor-id'),
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-anchor-id': attributes.anchorId
        })
      },
      displayText: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-display-text'),
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-display-text': attributes.displayText
        })
      },
      expanded: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-expanded') === 'true',
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-expanded': attributes.expanded
        })
      },
      previewAlignment: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-preview-alignment'),
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-preview-alignment': attributes.previewAlignment
        })
      },
      previewMode: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-preview-mode'),
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-preview-mode': attributes.previewMode
        })
      },
      previewWidth: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = Number(element.getAttribute('data-preview-width'));
          return Number.isFinite(value) ? value : null;
        },
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-preview-width': attributes.previewWidth
        })
      },
      page: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('data-page');
          return value ? Number(value) : null;
        },
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-page': attributes.page
        })
      },
      sourceBbox: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('data-source-bbox');
          if (!value) {
            return null;
          }
          const parts = value.split(',').map(Number);
          return parts.length === 4 && parts.every(Number.isFinite)
            ? parts as [number, number, number, number]
            : null;
        },
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-source-bbox': attributes.sourceBbox?.join(',')
        })
      },
      segmentUid: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-segment-uid'),
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-segment-uid': attributes.segmentUid
        })
      },
      sourceEntryId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-source-entry-id'),
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-source-entry-id': attributes.sourceEntryId
        })
      },
      segmentType: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-segment-type'),
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-segment-type': attributes.segmentType
        })
      },
      snapshotAssetPath: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-snapshot-asset-path'),
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-snapshot-asset-path': attributes.snapshotAssetPath
        })
      },
      snapshotText: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-snapshot-text'),
        renderHTML: (attributes: SourceLinkAttrs) => ({
          'data-snapshot-text': attributes.snapshotText
        })
      },
      workspaceRoot: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({})
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-source-link]'
      }
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    const anchorId = String(HTMLAttributes['data-anchor-id'] ?? '');
    const displayText = String(HTMLAttributes['data-display-text'] ?? '');

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class:
          'inline-flex items-center rounded-sm border border-primary/25 bg-primary/10 px-1.5 py-0.5 align-baseline text-[0.72em] font-semibold leading-none text-primary',
        'data-source-link': 'true',
        title: displayText || (anchorId ? `Source Link ${anchorId}` : 'Source Link')
      }),
      displayText || (anchorId ? `SL ${anchorId.replace(/^sl-/, '')}` : 'SL source')
    ];
  },

  addNodeView() {
    const options =
      (this as {
        options: {
          onOpenSourceLink: ((target: SourceLinkOpenTarget) => void) | null;
          getPdfDocument: (() => PDFDocumentProxy | null) | null;
          snapshotAssetContext: SourceLinkSnapshotAssetContext | null;
        };
      }).options;
    return ReactNodeViewRenderer((props: NodeViewProps) =>
      createElement(SourceLinkNodeView, {
        ...props,
        onOpenSourceLink: options.onOpenSourceLink,
        getPdfDocument: options.getPdfDocument,
        snapshotAssetContext: options.snapshotAssetContext
      })
    );
  },

  renderText({ node }: { node: { attrs: SourceLinkAttrs } }) {
    return sourceLinkMarkdown(node.attrs as SourceLinkAttrs);
  },

  renderMarkdown(node: MarkdownNode) {
    return sourceLinkMarkdown(node.attrs);
  },

  parseMarkdown: (token: SourceLinkToken, helpers: MarkdownParseHelpers) =>
    helpers.createNode('sourceLink', { anchorId: token.text ?? '' }),

  markdownTokenizer: {
    name: 'sourceLink',
    level: 'inline',
    start(src: string) {
      const match = /\[\^(sl-[A-Za-z0-9_-]+)\]/.exec(src);
      return match?.index ?? -1;
    },
    tokenize(src: string) {
      const match = /^\[\^(sl-[A-Za-z0-9_-]+)\]/.exec(src);
      if (!match?.[1]) {
        return undefined;
      }
      return {
        raw: match[0],
        text: match[1],
        type: 'sourceLink'
      };
    }
  }
} as Record<string, unknown>);

function sourceLinkMarkdown(attrs?: Partial<SourceLinkAttrs>) {
  return attrs?.anchorId ? `[^${attrs.anchorId}]` : '';
}

export function hydrateSourceLinkNodes(
  editor: Editor,
  links: SourceLink[] = [],
  workspaceRoot?: string | null
) {
  const sourceLink = editor.state.schema.nodes.sourceLink;
  if (!sourceLink) {
    return;
  }

  const linksByAnchorId = new Map(
    links.map((link) => [link.anchor_id, attrsFromSourceLink(link, workspaceRoot)])
  );
  hydrateSourceLinkText(editor, linksByAnchorId);
}

export function insertSourceLinkNode(
  editor: Editor,
  link: SourceLink,
  workspaceRoot?: string | null
) {
  // Insert the atom as structured ProseMirror content. Inserting `[^sl-…]` as
  // Markdown first can be escaped to `\[\^sl-…\]`, which the block-math
  // tokenizer interprets as a `\[` formula delimiter before hydration runs.
  editor.chain().focus().insertContent([
    { type: 'text', text: ' ' },
    {
      type: 'sourceLink',
      attrs: attrsFromSourceLink(link, workspaceRoot)
    }
  ]).run();
}

export function getMarkdownWithSourceLinks(editor: Editor) {
  return editor.getMarkdown();
}

export function materializeMarkdownSourceLinks(
  markdown: string,
  links: SourceLink[] = []
) {
  const referencedLinks = pruneUnusedSourceLinks(markdown, links);
  if (referencedLinks.length === 0) {
    return markdown;
  }

  const refs: string[] = [];
  const footnotes: string[] = [];
  const linkByAnchorId = new Map(
    referencedLinks
      .filter((link) => link.anchor_id.trim().length > 0)
      .map((link) => [link.anchor_id, link])
  );

  const body = markdown.replace(/\[\^(sl-[A-Za-z0-9_-]+)\]/g, (full, anchorId: string) => {
    const link = linkByAnchorId.get(anchorId);
    if (!link) {
      return full;
    }

    refs.push(full);
    return full;
  });

  for (const anchorId of uniquePreservingOrder(refs.map((ref) => ref.slice(2, -1)))) {
    const link = linkByAnchorId.get(anchorId);
    if (!link) {
      continue;
    }
    footnotes.push(`[^${anchorId}]: ${sourceLinkFootnoteText(link)}`);
  }

  if (footnotes.length === 0) {
    return markdown;
  }

  return `${body.trimEnd()}\n\n## Sources\n\n${footnotes.join('\n')}\n`;
}

export function sourceLinkAnchorIdsInMarkdown(markdown: string) {
  return new Set(
    Array.from(markdown.matchAll(/\[\^(sl-[A-Za-z0-9_-]+)\]/g), (match) => match[1])
  );
}

export function sourceLinkAnchorIdsInEditor(editor: Editor) {
  const sourceLink = editor.state.schema.nodes.sourceLink;
  const anchorIds = new Set<string>();
  if (!sourceLink) {
    return anchorIds;
  }

  editor.state.doc.descendants((node) => {
    if (node.type !== sourceLink) {
      return;
    }

    const attrs = node.attrs as SourceLinkAttrs;
    if (attrs.anchorId) {
      anchorIds.add(attrs.anchorId);
    }
  });

  return anchorIds;
}

export function pruneUnusedSourceLinks(markdown: string, links: SourceLink[] = []) {
  const anchorIds = sourceLinkAnchorIdsInMarkdown(markdown);
  if (anchorIds.size === 0) {
    return [];
  }

  return links.filter((link) => anchorIds.has(link.anchor_id));
}

export function findSourceLinkForSegment(
  links: SourceLink[] = [],
  sourceEntryId: string,
  segmentUid: string
) {
  return links.find((link) =>
    link.sources.some(
      (source) =>
        source.entry_id === sourceEntryId &&
        source.segment_uid === segmentUid
    )
  ) ?? null;
}

export function dematerializeMarkdownSourceLinks(
  markdown: string,
  links: SourceLink[] = []
) {
  if (links.length === 0 || !markdown.trim()) {
    return markdown;
  }
  const repairedMarkdown = repairKnownSourceLinkMarkers(markdown, links);

  const knownAnchorIds = new Set(
    links
      .map((link) => link.anchor_id.trim())
      .filter((anchorId) => anchorId.length > 0)
  );
  if (knownAnchorIds.size === 0) {
    return markdown;
  }

  const lines = repairedMarkdown.split(/\r?\n/);
  const normalizedLines = [...lines];

  for (let index = 0; index < normalizedLines.length; index += 1) {
    const match = normalizedLines[index]?.match(/^\[\^(sl-[A-Za-z0-9_-]+)\]:\s*/);
    if (!match || !knownAnchorIds.has(match[1])) {
      continue;
    }
    normalizedLines[index] = '';
  }

  const compacted = trimTrailingWhitespaceLines(normalizedLines);
  const sourcesHeadingIndex = findTrailingSourcesHeading(compacted);
  if (sourcesHeadingIndex >= 0) {
    const trailingLines = compacted.slice(sourcesHeadingIndex + 1);
    const hasNonEmptyTrailingContent = trailingLines.some((line) => line.trim().length > 0);
    if (!hasNonEmptyTrailingContent) {
      compacted.splice(sourcesHeadingIndex);
    }
  }

  return ensureTrailingNewline(collapseBlankLines(compacted).join('\n'));
}

function hydrateSourceLinkText(
  editor: Editor,
  linksByAnchorId: Map<string, HydratedSourceLink>
) {
  const sourceLink = editor.state.schema.nodes.sourceLink;
  if (!sourceLink) {
    return;
  }

  const blockMath = editor.state.schema.nodes.blockMath;
  const inlineMath = editor.state.schema.nodes.inlineMath;
  const paragraph = editor.state.schema.nodes.paragraph;
  const operations: Array<{
    anchorId: string;
    block: boolean;
    from: number;
    kind: 'hydrate-node' | 'replace-text';
    to?: number;
  }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type === sourceLink) {
      const attrs = node.attrs as SourceLinkAttrs;
      if (attrs.anchorId && linksByAnchorId.has(attrs.anchorId) && !sourceLinkAttrsMatch(attrs, linksByAnchorId.get(attrs.anchorId)!)) {
        operations.push({
          anchorId: attrs.anchorId,
          block: false,
          from: pos,
          kind: 'hydrate-node'
        });
      }
      return;
    }

    if (node.type === blockMath || node.type === inlineMath) {
      const anchorId = sourceLinkAnchorIdFromMathLatex(String(node.attrs.latex ?? ''));
      if (anchorId && linksByAnchorId.has(anchorId)) {
        operations.push({
          anchorId,
          block: node.type === blockMath,
          from: pos,
          to: pos + node.nodeSize,
          kind: 'replace-text'
        });
      }
      return;
    }

    if (!node.isText || !node.text) {
      return;
    }

    for (const match of node.text.matchAll(/\[\^(sl-[A-Za-z0-9_-]+)\]/g)) {
      if (match.index === undefined) {
        continue;
      }
      operations.push({
        anchorId: match[1],
        block: false,
        from: pos + match.index,
        to: pos + match.index + match[0].length,
        kind: 'replace-text'
      });
    }
  });

  if (operations.length === 0) {
    return;
  }

  const tr = editor.state.tr;
  for (const operation of operations.sort((left, right) => right.from - left.from)) {
    const attrs = linksByAnchorId.get(operation.anchorId);
    if (!attrs) {
      continue;
    }
    if (operation.kind === 'hydrate-node') {
      tr.setNodeMarkup(operation.from, sourceLink, attrs);
      continue;
    }
    const hydratedNode = sourceLink.create({
      anchorId: operation.anchorId,
      displayText: attrs?.displayText ?? null,
      page: attrs?.page ?? null,
      previewAlignment: attrs?.previewAlignment ?? null,
      previewMode: attrs?.previewMode ?? null,
      previewWidth: attrs?.previewWidth ?? null,
      sourceBbox: attrs?.sourceBbox ?? null,
      segmentUid: attrs?.segmentUid ?? null,
      sourceEntryId: attrs?.sourceEntryId ?? null,
      segmentType: attrs?.segmentType ?? null,
      snapshotAssetPath: attrs?.snapshotAssetPath ?? null,
      snapshotText: attrs?.snapshotText ?? null,
      workspaceRoot: attrs?.workspaceRoot ?? null
    });
    tr.replaceWith(
      operation.from,
      operation.to!,
      operation.block && paragraph ? paragraph.create(null, hydratedNode) : hydratedNode
    );
  }
  editor.view.dispatch(tr);
}

function sourceLinkAttrsMatch(left: SourceLinkAttrs, right: HydratedSourceLink) {
  return (
    left.anchorId === right.anchorId &&
    (left.displayText ?? null) === (right.displayText ?? null) &&
    (left.page ?? null) === (right.page ?? null) &&
    bboxAttrsMatch(left.sourceBbox ?? null, right.sourceBbox ?? null) &&
    (left.segmentUid ?? null) === (right.segmentUid ?? null) &&
    (left.sourceEntryId ?? null) === (right.sourceEntryId ?? null) &&
    (left.segmentType ?? null) === (right.segmentType ?? null) &&
    (left.snapshotAssetPath ?? null) === (right.snapshotAssetPath ?? null) &&
    (left.snapshotText ?? null) === (right.snapshotText ?? null) &&
    (left.workspaceRoot ?? null) === (right.workspaceRoot ?? null)
  );
}

function attrsFromSourceLink(
  link: SourceLink,
  workspaceRoot?: string | null
): HydratedSourceLink {
  const firstSource = link.sources[0];

  return {
    anchorId: link.anchor_id,
    displayText: link.display_text,
    page: firstSource?.page ?? null,
    sourceBbox: firstSource?.bbox ?? null,
    segmentUid: firstSource?.segment_uid ?? null,
    sourceEntryId: firstSource?.entry_id ?? null,
    segmentType: firstSource?.segment_type ?? null,
    snapshotAssetPath: firstSource?.snapshot_asset_path ?? null,
    snapshotText: firstSource?.snapshot_text ?? null,
    workspaceRoot: workspaceRoot ?? null
  };
}

function bboxAttrsMatch(
  left?: [number, number, number, number] | null,
  right?: [number, number, number, number] | null
) {
  if (!left || !right) {
    return !left && !right;
  }
  return left.every((value, index) => value === right[index]);
}

export function normalizeSourceLinkMarkers(markdown: string) {
  return markdown.replace(
    /\\\[\s*\\?\^(sl-(?:\\?[_A-Za-z0-9-])+)\s*\\\]/g,
    (_full, encodedAnchorId: string) => `[^${decodeEscapedAnchorId(encodedAnchorId)}]`
  );
}

function sourceLinkFootnoteText(link: SourceLink) {
  const source = link.sources[0];
  if (!source) {
    return link.display_text || 'Source link';
  }

  const quote = source.snapshot_text.trim()
    ? ` "${escapeSourceMarkdown(source.snapshot_text.trim().replace(/\s+/g, ' '))}"`
    : '';
  return `${escapeSourceMarkdown(link.display_text || `p.${source.page}`)}, entry ${source.entry_id}, page ${source.page}, segment ${source.segment_uid}.${quote}`;
}

export function repairKnownSourceLinkMarkers(
  markdown: string,
  links: SourceLink[]
) {
  const knownAnchorIds = new Set(
    links
      .map((link) => link.anchor_id.trim())
      .filter((anchorId) => /^sl-[A-Za-z0-9_-]+$/.test(anchorId))
  );
  if (knownAnchorIds.size === 0) return markdown;

  const replaceKnownAnchor = (full: string, encodedAnchorId: string) => {
    const anchorId = decodeEscapedAnchorId(encodedAnchorId);
    return knownAnchorIds.has(anchorId) ? `[^${anchorId}]` : full;
  };

  return markdown
    .replace(
      /\\\[\s*\\?\^(sl-(?:\\?[_A-Za-z0-9-])+)\s*\\\]/g,
      replaceKnownAnchor
    )
    .replace(
      /\$\$\s*\\?\^(sl-(?:\\?[_A-Za-z0-9-])+)\s*\$\$/g,
      replaceKnownAnchor
    )
    .replace(
      /\$\s*\\?\^(sl-(?:\\?[_A-Za-z0-9-])+)\s*\$/g,
      replaceKnownAnchor
    );
}

export function sourceLinkAnchorIdFromMathLatex(latex: string) {
  const normalized = decodeEscapedAnchorId(latex.trim());
  return normalized.match(/^\\?\^(sl-[A-Za-z0-9_-]+)$/)?.[1] ?? null;
}

function decodeEscapedAnchorId(value: string) {
  return value.replace(/\\(?=[_A-Za-z0-9-])/g, '');
}

function escapeSourceMarkdown(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*$\[\]{}_<>])/g, '\\$1');
}

function uniquePreservingOrder(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function findTrailingSourcesHeading(lines: string[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim().length === 0) {
      continue;
    }
    return lines[index].trim() === '## Sources' ? index : -1;
  }
  return -1;
}

function trimTrailingWhitespaceLines(lines: string[]) {
  const normalized = [...lines];
  while (normalized.length > 0 && normalized[normalized.length - 1].trim().length === 0) {
    normalized.pop();
  }
  return normalized;
}

function collapseBlankLines(lines: string[]) {
  const collapsed: string[] = [];
  let previousBlank = false;
  for (const line of lines) {
    const isBlank = line.trim().length === 0;
    if (isBlank && previousBlank) {
      continue;
    }
    collapsed.push(line);
    previousBlank = isBlank;
  }
  return collapsed;
}

function ensureTrailingNewline(markdown: string) {
  const trimmed = markdown.trim();
  return trimmed ? `${trimmed}\n` : '';
}
