import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/shared/hooks/useToast';
import type { SegmentBlockNote, SourceSegment } from '@/shared/types/domain';
import { logicalSegmentUid } from './pdf-reader/readerUtils';
import { SegmentMenuButton } from './SegmentMenuButton';

export type SetSegmentBookmark = (uid: string, bookmarked: boolean) => Promise<SegmentBlockNote[]>;
const BookmarkContext = createContext<{
  notes: SegmentBlockNote[]; pending: Set<string>;
  set: (uid: string, value: boolean) => Promise<void>;
  replace: (notes: SegmentBlockNote[]) => void;
} | null>(null);

export function SegmentBookmarksProvider({ save, children }: { save?: SetSegmentBookmark; children: ReactNode }) {
  return save ? <BookmarkState save={save}>{children}</BookmarkState> : <>{children}</>;
}

function BookmarkState({ save, children }: { save: SetSegmentBookmark; children: ReactNode }) {
  const [current, setCurrent] = useState<SegmentBlockNote[]>([]);
  const [pending, setPending] = useState(new Set<string>());
  const inflight = useRef(new Set<string>());
  const mounted = useRef(true);
  const { notify } = useToast();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const value = useMemo(() => save ? {
    notes: current, pending, replace: setCurrent,
    set: async (uid: string, bookmarked: boolean) => {
      if (inflight.current.has(uid)) return;
      inflight.current.add(uid); setPending(new Set(inflight.current));
      try {
        const saved = await save(uid, bookmarked);
        if (mounted.current) setCurrent(saved);
      } catch (error) {
        notify({ tone: 'danger', title: '保存位置失败', description: `${String(error)}，请重试。` });
      } finally {
        inflight.current.delete(uid);
        if (mounted.current) setPending(new Set(inflight.current));
      }
    }
  } : null, [current, pending, save, notify]);
  return <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>;
}

export function useSegmentBookmarks() { return useContext(BookmarkContext); }

export function usePublishSegmentNotes(notes: SegmentBlockNote[]) {
  const replace = useContext(BookmarkContext)?.replace;
  useEffect(() => { replace?.(notes); }, [notes, replace]);
}

export function SegmentBookmarkButton({ segment, menu = false, disabled = false, onDone }: {
  segment: SourceSegment; menu?: boolean; disabled?: boolean; onDone?: () => void;
}) {
  const bookmarks = useSegmentBookmarks();
  if (!bookmarks) return null;
  const uid = logicalSegmentUid(segment);
  const marked = bookmarks.notes.some(note => (note.segment_uid === uid || note.segment_uid === segment.uid) && note.bookmarked);
  const busy = bookmarks.pending.has(uid);
  const label = marked ? '取消收藏位置' : '记住此处';
  const icon = busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
    : marked ? <BookmarkCheck size={14} aria-hidden="true" /> : <Bookmark size={14} aria-hidden="true" />;
  const toggle = () => { void bookmarks.set(uid, !marked); onDone?.(); };
  if (menu) return <SegmentMenuButton icon={icon} label={label} disabled={disabled || busy} onClick={toggle} />;
  return <Button size="xs" variant="ghost"
    aria-label={label} aria-pressed={marked} disabled={disabled || busy}
    onClick={event => { event.stopPropagation(); toggle(); }}>
    {icon}
    {label}
  </Button>;
}
