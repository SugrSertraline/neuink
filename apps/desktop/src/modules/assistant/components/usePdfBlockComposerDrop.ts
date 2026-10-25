import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState } from 'react';
import { pdfBlockDrag } from '@/shared/lib/pdfBlockDrag';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

/** The composer document owns the attachment and its undo history, just like @ mentions. */
export function usePdfBlockComposerDrop(editor: Editor | null, entries: LibraryEntry[], workspaceRoot: string | null, disabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || !editor || disabled) { setActive(false); return; }
    const unregister = pdfBlockDrag.register({
      element,
      accepts: item => item.workspaceRoot === workspaceRoot && entries.some(entry => entry.id === item.entryId)
        && Boolean((item.segment.markdown || item.segment.text)?.trim()) && editor.isEditable,
      onDrop: item => {
        const entry = entries.find(entry => entry.id === item.entryId);
        if (!entry || !editor.isEditable) return;
        const id = `segment:${entry.id}:${item.segment.uid}`;
        let attached = false;
        editor.state.doc.descendants(node => { if (node.type.name === 'contextMention' && node.attrs.id === id) attached = true; });
        if (attached) { editor.commands.focus(); return; }
        const text = item.segment.markdown || item.segment.text;
        editor.chain().focus().insertContent([
          { type: 'contextMention', attrs: {
            id, kind: 'segment', role: 'evidence', entryId: entry.id, entryTitle: entry.title,
            segmentUid: item.segment.uid, pageIdx: item.segment.page_idx, text,
            label: `${entry.title} · 第 ${item.segment.page_idx + 1} 页 · ${item.segment.text.slice(0,24)}`,
          } },
          { type: 'text', text: ' ' },
        ]).run();
      },
    });
    const update = () => setActive(pdfBlockDrag.isTargetActive(element));
    const unsubscribe = pdfBlockDrag.subscribe(update);
    update();
    return () => { unregister(); unsubscribe(); };
  }, [disabled, editor, entries, workspaceRoot]);
  return { ref, active };
}
