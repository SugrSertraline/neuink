import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** Never dispatch a selection transaction or scroll ancestors/another split view. */
export function revealNoteOutlinePosition(
  editor: Editor,
  viewport: HTMLElement | null,
  position: number,
  document: ProseMirrorNode,
): boolean {
  if (editor.isDestroyed || !viewport || editor.state.doc !== document
    || !viewport.contains(editor.view.dom) || position < 0 || position >= document.content.size) return false;
  const node = editor.view.nodeDOM(position);
  const target = node instanceof HTMLElement ? node : node?.parentElement;
  if (!target || !editor.view.dom.contains(target)) return false;
  const bounds = viewport.getBoundingClientRect();
  if (bounds.height <= 0 || viewport.clientHeight <= 0) return false;
  const scale = viewport.offsetHeight > 0 ? bounds.height / viewport.offsetHeight : 1;
  if (!Number.isFinite(scale) || scale <= 0) return false;
  const top = viewport.scrollTop + (target.getBoundingClientRect().top - bounds.top) / scale
    - viewport.clientTop - 16;
  viewport.scrollTop = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight));
  return true;
}
