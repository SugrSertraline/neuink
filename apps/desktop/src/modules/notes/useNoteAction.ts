import { useEffect, useRef, useState } from 'react';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';

// A surface cannot disappear while an asset/note mutation is in flight.
export function useNoteAction(scope: string, root: string | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<Promise<boolean> | null>(null);
  const context = useRef({ root, live: true });
  context.current.root = root;
  useEffect(() => {
    context.current.live = true;
    const off = registerSegmentEditorCloseHandler(scope, 'note-action', { save: () => operation.current ?? Promise.resolve(true),
      isDirty: () => Boolean(operation.current), discard: () => undefined });
    return () => { context.current.live = false; off(); setSegmentEditorDirty(scope, 'note-action', false); };
  }, [scope]);
  const run = (action: (isCurrent: () => boolean) => Promise<void>) => {
    if (!root || operation.current) return;
    const current = () => context.current.live && context.current.root === root;
    setBusy(true); setError(null); setSegmentEditorDirty(scope, 'note-action', true);
    operation.current = action(current).then(() => true).catch((caught) => { if (current()) setError(String(caught)); return false; })
      .finally(() => { operation.current = null; setSegmentEditorDirty(scope, 'note-action', false); if (current()) setBusy(false); });
  };
  return { busy, error, run };
}
