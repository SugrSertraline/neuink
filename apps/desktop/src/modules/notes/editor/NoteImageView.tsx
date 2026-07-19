import type { NodeViewProps } from '@tiptap/core';
import { NodeViewWrapper } from '@tiptap/react';
import { useEffect, useRef } from 'react';

import { resolveNoteImageSrc, type NoteImageOptions } from './NoteImage';

export function NoteImageView({ editor, extension, node, selected, updateAttributes }: NodeViewProps) {
  const options = extension.options as NoteImageOptions;
  const alignment = node.attrs.alignment === 'left' || node.attrs.alignment === 'right' ? node.attrs.alignment : 'center';
  const width = Math.min(100, Math.max(10, Number(node.attrs.width ?? 100)));
  const resizeInputRef = useRef<HTMLInputElement | null>(null);
  const resizeAnchorTopRef = useRef<number | null>(null);
  const resizeScrollContainerRef = useRef<HTMLElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
  }, []);

  const beginResize = () => {
    const input = resizeInputRef.current;
    if (!input) return;
    resizeAnchorTopRef.current = input.getBoundingClientRect().top;
    resizeScrollContainerRef.current = findScrollContainer(input, editor.view.dom);
  };

  const keepResizeAxisFixed = () => {
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const anchorTop = resizeAnchorTopRef.current;
      const input = resizeInputRef.current;
      if (anchorTop === null || !input) return;

      const delta = input.getBoundingClientRect().top - anchorTop;
      if (delta) {
        // The image height changes above this slider. Offset the editor scroll by the
        // same amount so the thumb remains under the pointer throughout the drag.
        resizeScrollContainerRef.current?.scrollBy({ top: delta });
      }
    });
  };

  const setWidth = (value: string) => {
    updateAttributes({ width: Math.min(100, Math.max(10, Number(value) || 10)) });
    keepResizeAxisFixed();
  };

  return (
    <NodeViewWrapper className="my-3" contentEditable={false} data-note-image="true">
      <figure className={alignment === 'left' ? 'mr-auto' : alignment === 'right' ? 'ml-auto' : 'mx-auto'} style={{ width: `${width}%` }}>
        <img
          alt={node.attrs.alt || 'image'}
          className="block h-auto w-full rounded-lg border bg-muted/20 object-contain shadow-sm"
          src={resolveNoteImageSrc(node.attrs.src, options)}
        />
        {selected ? (
          <figcaption className="mt-1 flex flex-wrap items-center justify-center gap-1 rounded-md border bg-background/95 p-1 text-xs shadow-sm">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => updateAttributes({ alignment: 'left' })}>左对齐</button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => updateAttributes({ alignment: 'center' })}>居中</button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => updateAttributes({ alignment: 'right' })}>右对齐</button>
            <input
              ref={resizeInputRef}
              aria-label="图片缩放"
              className="w-24"
              max="100"
              min="10"
              step="1"
              type="range"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
              onPointerDown={beginResize}
              onPointerUp={() => { resizeAnchorTopRef.current = null; }}
              onPointerCancel={() => { resizeAnchorTopRef.current = null; }}
            />
            <input aria-label="图片宽度百分比" className="h-6 w-14 rounded border px-1" max="100" min="10" step="1" type="number" value={width} onChange={(event) => setWidth(event.target.value)} />
            <span>%</span>
          </figcaption>
        ) : null}
      </figure>
    </NodeViewWrapper>
  );
}

function findScrollContainer(element: HTMLElement, editorRoot: HTMLElement) {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current;
    }
    if (current === editorRoot) break;
    current = current.parentElement;
  }
  return editorRoot.parentElement;
}
