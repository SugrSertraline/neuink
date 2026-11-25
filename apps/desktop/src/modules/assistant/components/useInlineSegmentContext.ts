import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { useEffect, useRef } from 'react';
import type { AssistantContextItem, AssistantSegmentContextItem } from '@/shared/types/assistant';

/** Menu and drag attachments use the same typed citation, identity, cursor and undo contract. */
export function insertSegmentMention(editor: Editor, item: Omit<AssistantSegmentContextItem, 'addedAt'>) {
  let existing: { pos: number; attrs: Record<string, unknown> } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'contextMention' && node.attrs.id === item.id) existing = { pos, attrs: node.attrs };
  });
  const attrs = { id: item.id, kind: 'segment', role: 'evidence', entryId: item.entryId, entryTitle: item.entryTitle,
    segmentUid: item.segmentUid, pageIdx: item.pageIdx, text: item.text,
    label: `${item.entryTitle} · 第 ${item.pageIdx + 1} 页 · ${item.text.slice(0, 24)}` };
  const found = existing as { pos: number; attrs: Record<string, unknown> } | null;
  if (found) {
    if (found.attrs.text === item.text && found.attrs.pageIdx === item.pageIdx) return;
    editor.commands.command(({ tr }) => { closeHistory(tr); tr.setNodeMarkup(found.pos, undefined, { ...found.attrs, ...attrs }); return true; });
  } else {
    // Inserting beside a selected phrase must not replace the user's unfinished question.
    editor.chain().command(({ tr }) => { closeHistory(tr); return true; })
      .insertContentAt(editor.state.selection.to, [{ type: 'contextMention', attrs }, { type: 'text', text: ' ' }]).run();
  }
}

export function useInlineSegmentContext(editor: Editor | null, items: AssistantContextItem[], disabled: boolean, scope: string | null, resetKey: number) {
  const seen = useRef(new Set<string>());
  const previous = useRef({ scope, resetKey });
  useEffect(() => {
    if (previous.current.scope !== scope || previous.current.resetKey !== resetKey) {
      seen.current.clear(); previous.current = { scope, resetKey };
    }
    if (!editor) return;
    const currentIds = new Set(items.map(item => item.id));
    for (const id of seen.current) if (!currentIds.has(id)) seen.current.delete(id);
    // Tiptap's React node views flush synchronously; don't create them in a React effect commit.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed || disabled) return;
      const attached = new Set<string>();
      editor.state.doc.descendants(node => { if (node.type.name === 'contextMention') attached.add(node.attrs.id); });
      let inserted = false;
      for (const item of items) {
        if (item.kind !== 'segment') continue;
        if (attached.has(item.id) || !seen.current.has(item.id)) {
          seen.current.add(item.id);
          insertSegmentMention(editor, item);
          inserted ||= !attached.has(item.id);
        }
      }
      if (inserted && editor.view.dom.getClientRects().length) editor.commands.focus(undefined, { scrollIntoView: false });
    });
    return () => { cancelled = true; };
  }, [editor, items, disabled, scope, resetKey]);
}
