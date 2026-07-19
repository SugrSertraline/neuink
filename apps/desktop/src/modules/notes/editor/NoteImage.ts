import { convertFileSrc } from '@tauri-apps/api/core';
import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { NoteImageView } from './NoteImageView';

export type NoteImageOptions = {
  entryId: string;
  noteId: string;
  workspaceRoot?: string | null;
};

type ImageAttrs = {
  alt?: string | null;
  src?: string | null;
  title?: string | null;
};

export const NoteImage = Image.extend<NoteImageOptions>({
  name: 'image',

  addOptions() {
    return {
      ...this.parent?.(),
      allowBase64: false,
      entryId: '',
      noteId: '',
      workspaceRoot: null,
      HTMLAttributes: {
        class:
          'my-3 max-h-[520px] max-w-full rounded-lg border bg-muted/20 object-contain shadow-sm'
      }
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      alignment: {
        default: 'center',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-note-image-align') ?? 'center',
        renderHTML: (attributes: { alignment?: string }) => ({ 'data-note-image-align': attributes.alignment ?? 'center' })
      },
      width: {
        default: 100,
        parseHTML: (element: HTMLElement) => Number(element.getAttribute('data-note-image-width') ?? 100),
        renderHTML: (attributes: { width?: number }) => ({ 'data-note-image-width': String(attributes.width ?? 100) })
      }
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteImageView);
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as ImageAttrs;
    return [
      'img',
      {
        ...HTMLAttributes,
        src: resolveNoteImageSrc(attrs.src, this.options)
      }
    ];
  },

  renderMarkdown(node) {
    const attrs = node.attrs as ImageAttrs;
    const alt = escapeMarkdownImageText(attrs.alt || 'image');
    const title = attrs.title ? ` "${escapeMarkdownImageText(attrs.title)}"` : '';
    const alignment = node.attrs?.alignment ?? 'center';
    const width = Math.min(100, Math.max(10, Number(node.attrs?.width ?? 100)));
    return attrs.src
      ? `<img src="${attrs.src}" alt="${alt}"${title ? ` title=${title}` : ''} data-note-image-align="${alignment}" data-note-image-width="${width}" />`
      : '';
  }
});

export function resolveNoteImageSrc(src: string | null | undefined, options: NoteImageOptions) {
  if (!src || !options.workspaceRoot || !options.entryId) {
    return src || '';
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src) || src.startsWith('data:')) {
    return src;
  }

  const normalized = src.replace(/\\/g, '/').replace(/^\.\//, '');
  const absolutePath = [
    options.workspaceRoot,
    'entries',
    options.entryId,
    'notes',
    ...normalized.split('/').filter(Boolean)
  ].join('\\');

  return convertFileSrc(absolutePath);
}

function escapeMarkdownImageText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/]/g, '\\]').replace(/"/g, '\\"');
}
