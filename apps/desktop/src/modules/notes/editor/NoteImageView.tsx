import type { NodeViewProps } from '@tiptap/core';
import { NodeViewWrapper } from '@tiptap/react';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ViewportOverlay } from '@/components/ui/viewport-overlay';
import { useNoteImageToolbar } from './useNoteImageToolbar';

import { resolveNoteImageSrc, type NoteImageOptions } from './NoteImage';

export function NoteImageView({ editor, extension, node, selected, updateAttributes }: NodeViewProps) {
  const options = extension.options as NoteImageOptions;
  const alignment = node.attrs.alignment === 'left' || node.attrs.alignment === 'right' ? node.attrs.alignment : 'center';
  const width = Math.min(100, Math.max(10, Number(node.attrs.width ?? 100)));
  const figureRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const subscribe = useCallback((changed: () => void) => {
    editor.on('update', changed);
    return () => { editor.off('update', changed); };
  }, [editor]);
  const editable = useSyncExternalStore(subscribe, () => editor.isEditable);
  const visible = selected && editable;
  useNoteImageToolbar({ visible, editorRoot: editor.view.dom, figureRef, viewportRef, toolbarRef });
  const setWidth = (value: string) => {
    if (editor.isEditable) updateAttributes({ width: Math.min(100, Math.max(10, Number(value) || 10)) });
  };

  return (
    <NodeViewWrapper className="my-3" contentEditable={false} data-note-image="true">
      <figure ref={figureRef} className={alignment === 'left' ? 'mr-auto' : alignment === 'right' ? 'ml-auto' : 'mx-auto'} style={{ width: `${width}%` }}>
        <img
          alt={node.attrs.alt || 'image'}
          className="block h-auto w-full rounded-lg border bg-muted/20 object-contain shadow-sm"
          src={resolveNoteImageSrc(node.attrs.src, options)}
        />
      </figure>
        {visible ? createPortal(<ViewportOverlay enabled ref={viewportRef}>

          <div ref={toolbarRef} role="group" aria-label="图片设置" contentEditable={false}
            className="editor-toolbar absolute flex flex-wrap items-center justify-center gap-1 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-md" style={{ visibility: 'hidden' }}>
            <div className="flex shrink-0 items-center">
            <Button type="button" size="xs" variant="ghost" aria-pressed={alignment === 'left'} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.isEditable && updateAttributes({ alignment: 'left' })}>左对齐</Button>
            <Button type="button" size="xs" variant="ghost" aria-pressed={alignment === 'center'} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.isEditable && updateAttributes({ alignment: 'center' })}>居中</Button>
            <Button type="button" size="xs" variant="ghost" aria-pressed={alignment === 'right'} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.isEditable && updateAttributes({ alignment: 'right' })}>右对齐</Button>
            </div>
            <div className="flex min-w-0 flex-1 basis-40 items-center gap-1">
            <input
              aria-label="图片缩放"
              className="min-w-12 flex-1 accent-primary"
              max="100"
              min="10"
              step="1"
              type="range"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
            />
            <Input aria-label="图片宽度百分比" className="h-6 w-14 shrink-0 px-1 text-xs" max="100" min="10" step="1" type="number" value={width} onChange={(event) => setWidth(event.target.value)} />
            <span>%</span>
            </div>
          </div>
        </ViewportOverlay>, document.body) : null}
    </NodeViewWrapper>
  );
}
