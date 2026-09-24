import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '@/shared/hooks/useToast';
import type { JobEvent } from '@/shared/ipc/workspaceApi';
import { readParagraphTranslations, setParagraphTranslationView, translateParagraph, type ParagraphLiveProgress, type ParagraphTranslation, type ParagraphView } from '@/shared/ipc/paragraphTranslationApi';
import type { SourceSegment } from '@/shared/types/domain';
import { hasSentenceTranslation, paragraphTranslationRunning } from './paragraphTranslationState';

type Context = {
  records: Record<string, ParagraphTranslation>; pending: Set<string>; ready: boolean;
  live: Record<string, ParagraphLiveProgress>;
  translate: (uid: string, retry?: boolean) => void;
  setView: (uid: string, view: ParagraphView) => void;
};
const ParagraphContext = createContext<Context | null>(null);

export function ParagraphTranslationProvider({ root, entryId, children }: { root: string | null; entryId: string; children: ReactNode }) {
  // Key the session so a late request from another entry cannot update this reader.
  return <ParagraphTranslationSession key={`${root}\0${entryId}`} root={root} entryId={entryId}>{children}</ParagraphTranslationSession>;
}

function ParagraphTranslationSession({ root, entryId, children }: { root: string | null; entryId: string; children: ReactNode }) {
  const [records, setRecords] = useState<Record<string, ParagraphTranslation>>({});
  const [live, setLive] = useState<Record<string, ParagraphLiveProgress>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [ready, setReady] = useState(false);
  const alive = useRef(true);
  const revision = useRef(0);
  const { notify } = useToast();
  useEffect(() => {
    alive.current = true;
    if (!root) return () => { alive.current = false; };
    let stopped = false;
    let unlisten: (() => void) | undefined;
    let stopProgress: (() => void) | undefined;
    let readPending = false;
    let readErrorReported = false;
    const refresh = async () => {
      if (readPending || stopped) return;
      readPending = true;
      const version = revision.current;
      try {
        const next = await readParagraphTranslations(root, entryId);
        readErrorReported = false;
        if (!stopped && version === revision.current) { setRecords(next); setReady(true); }
      } catch (error) {
        if (!stopped) {
          setReady(false);
          if (!readErrorReported) notify({ tone: 'danger', title: '无法读取段落翻译', description: String(error) });
          readErrorReported = true;
        }
      } finally { readPending = false; }
    };
    void refresh();
    void listen<JobEvent>('neuink://job-event', ({ payload }) => {
      const scope = payload.job.scope;
      if (payload.job.kind === 'paragraph_translation' && scope?.kind === 'entry' && scope.root === root && scope.entry_id === entryId) void refresh();
    }).then(stop => { if (stopped) stop(); else unlisten = stop; }).catch(() => { /* Polling also recovers missed events. */ });
    void listen<ParagraphLiveProgress>('neuink://paragraph-translation-progress', ({ payload }) => {
      if (stopped || payload.root !== root || payload.entry_id !== entryId) return;
      const record = recordsRef.current[payload.segment_uid];
      if (record && !pendingRef.current.has(payload.segment_uid) &&
        (record.job_id !== payload.job_id || record[payload.part].status !== 'running')) return;
      const key = `${payload.job_id}:${payload.part}`;
      setLive(current => current[key]?.sequence >= payload.sequence ? current : { ...current, [key]: { ...payload, receivedAt: Date.now() } });
    }).then(stop => { if (stopped) stop(); else stopProgress = stop; }).catch(() => { /* Completed results still arrive through the job event and polling. */ });
    const timer = window.setInterval(() => {
      // Read while a request runs, or retry an initial read failure. No idle polling.
      if (pendingRef.current.size || !readyRef.current || Object.values(recordsRef.current).some(r => r.paragraph.status === 'running' || r.sentences.status === 'running')) void refresh();
    }, 1200);
    return () => { stopped = true; alive.current = false; unlisten?.(); stopProgress?.(); window.clearInterval(timer); };
  }, [root, entryId, notify]);
  const recordsRef = useRef(records); recordsRef.current = records;
  const readyRef = useRef(ready); readyRef.current = ready;
  useEffect(() => {
    setLive(current => Object.fromEntries(Object.entries(current).filter(([, event]) => {
      const record = records[event.segment_uid];
      return pendingRef.current.has(event.segment_uid) || !record || (record.job_id === event.job_id && record[event.part].status === 'running');
    })));
  }, [records]);
  const mutate = async (uid: string, action: () => Promise<ParagraphTranslation>) => {
    if (pendingRef.current.has(uid)) return;
    pendingRef.current.add(uid); setPending(new Set(pendingRef.current)); revision.current++;
    try {
      const record = await action();
      if (alive.current) { revision.current++; setRecords(current => ({ ...current, [uid]: record })); }
    } catch (error) {
      if (alive.current) notify({ tone: 'danger', title: '段落翻译操作失败', description: String(error) });
    } finally {
      pendingRef.current.delete(uid);
      if (alive.current) setPending(new Set(pendingRef.current));
    }
  };
  return <ParagraphContext.Provider value={{ records, live, pending, ready: Boolean(root) && ready,
    translate: (uid, retry = false) => { if (root) void mutate(uid, () => translateParagraph(root, entryId, uid, retry)); },
    setView: (uid, view) => {
      if (root && ready) void mutate(uid, async () => {
        const record = recordsRef.current[uid];
        if (view === 'sentences' && !hasSentenceTranslation(record) && !paragraphTranslationRunning(record)) {
          await translateParagraph(root, entryId, uid, true);
        }
        return setParagraphTranslationView(root, entryId, uid, view);
      });
    },
  }}>{children}</ParagraphContext.Provider>;
}

export function useParagraphProgress(record: ParagraphTranslation) {
  const context = useContext(ParagraphContext);
  const pick = (part: ParagraphView) => {
    const event = context?.live[`${record.job_id}:${part}`];
    return record[part].status === 'running' && event?.source_hash === record.source_hash && event.segment_uid === record.segment_uid ? event : undefined;
  };
  return { paragraph: pick('paragraph'), sentences: pick('sentences') };
}

export function useParagraphTranslation(segment: SourceSegment) {
  const context = useContext(ParagraphContext);
  const record = context?.records[segment.uid];
  return {
    context: segment.segment_type === 'paragraph' ? context : null,
    record: segment.segment_type === 'paragraph' && record?.source_text === (segment.markdown ?? segment.text) ? record : undefined,
  };
}
