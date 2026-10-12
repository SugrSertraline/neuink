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

type SegmentBookmarkButtonProps = {
  segment: SourceSegment; menu?: boolean; disabled?: boolean; onDone?: () => void;
  beforeRemember?: () => Promise<boolean | void> | boolean | void;
};
export function SegmentBookmarkButton(props: SegmentBookmarkButtonProps) {
  const bookmarks = useSegmentBookmarks();
  return bookmarks ? <SegmentBookmarkControl {...props} bookmarks={bookmarks} /> : null;
}
function SegmentBookmarkControl({ segment, menu = false, disabled = false, onDone, beforeRemember, bookmarks }:
  SegmentBookmarkButtonProps & { bookmarks: NonNullable<ReturnType<typeof useSegmentBookmarks>> }) {
  const [savingDraft, setSavingDraft] = useState(false);
  const pendingDraft = useRef(false);
  const { notify } = useToast();
  const uid = logicalSegmentUid(segment);
  const marked = bookmarks.notes.some(note => (note.segment_uid === uid || note.segment_uid === segment.uid) && note.bookmarked);
  const busy = bookmarks.pending.has(uid) || savingDraft;
  const label = marked ? '取消收藏位置' : '记住此处';
  const icon = busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
    : marked ? <BookmarkCheck size={14} aria-hidden="true" /> : <Bookmark size={14} aria-hidden="true" />;
  const toggle = async () => {
    if (busy || pendingDraft.current) return;
    pendingDraft.current = true; setSavingDraft(true);
    try {
      if (!marked && beforeRemember && await beforeRemember() === false) return;
      const saved = bookmarks.set(uid, !marked); onDone?.(); await saved;
    } catch (error) { notify({ tone: 'danger', title: '保存位置失败', description: String(error) }); }
    finally { pendingDraft.current = false; setSavingDraft(false); }
  };
  if (menu) return <SegmentMenuButton icon={icon} label={label}
    description={busy ? '正在保存…' : marked ? '取消收藏位置，保留原笔记' : '收藏原文位置，方便继续阅读'}
    disabled={disabled || busy} onClick={() => void toggle()} />;
  return <Button size="xs" variant="ghost"
    aria-label={label} aria-pressed={marked} disabled={disabled || busy}
    onClick={event => { event.stopPropagation(); void toggle(); }}>
    {icon}
    {label}
  </Button>;
}
