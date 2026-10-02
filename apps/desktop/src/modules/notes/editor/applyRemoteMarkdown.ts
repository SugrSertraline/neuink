import type { Editor } from '@tiptap/core';

/** Patch a shared segment draft without resetting selection or local undo. */
export function applyRemoteMarkdown(editor: Editor, markdown: string) {
  const json = editor.markdown?.parse(markdown);
  if (!json) return;
  const next = editor.schema.nodeFromJSON(json), current = editor.state.doc;
  const start = current.content.findDiffStart(next.content);
  if (start === null) return;
  const end = current.content.findDiffEnd(next.content)!;
  const overlap = start - Math.min(end.a, end.b);
  const endA = end.a + Math.max(0, overlap), endB = end.b + Math.max(0, overlap);
  editor.view.dispatch(editor.state.tr.replace(start, endA, next.slice(start, endB))
    .setMeta('addToHistory', false).setMeta('preventUpdate', true));
}
