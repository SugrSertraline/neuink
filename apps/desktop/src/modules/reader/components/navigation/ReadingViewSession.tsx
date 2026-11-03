import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { surfaceKey, type WorkspaceSurface } from '@/app/workspaceSurface';
import type { ReadingPosition, ReadingTarget } from './ReadingNavigation';
import type { ReadingLinkMode } from '@/shared/lib/readerPreferences';
import { readingViewStorageKey, readReadingViewState, saveReadingViewState } from './readingViewStorage';

type Peer = { id: string; receive: (position: ReadingPosition) => void; receiveTarget?: (target: ReadingTarget) => void; capture?: () => ReadingPosition | null };
const groups = new Map<string, Set<Peer>>();
type Session = { mode: 'original' | 'replace'; setMode: (mode: 'original' | 'replace') => void; active: boolean; group: string; id: string; kind: WorkspaceSurface['kind']; linkMode: ReadingLinkMode };
const Context = createContext<Session | null>(null);
export const useReadingViewSession = () => useContext(Context);
export function subscribeReadingView(group: string, peer: Peer) {
  const peers = groups.get(group) ?? new Set<Peer>();
  const existing = [...peers].map(p => p.capture?.()).find(Boolean);
  peers.add(peer); groups.set(group, peers);
  if (existing) peer.receive(existing);
  return () => { peers.delete(peer); if (!peers.size) groups.delete(group); };
}
export function publishReadingView(group: string, id: string, position: ReadingPosition) {
  for (const peer of groups.get(group) ?? []) if (peer.id !== id) peer.receive(position);
}
export function publishReadingTarget(group: string, id: string, target: ReadingTarget) {
  for (const peer of groups.get(group) ?? []) if (peer.id !== id) peer.receiveTarget?.(target);
}
export function ReadingViewSession({ surface, workspaceRoot, active, children, linkMode = 'scroll' }: { surface: WorkspaceSurface; workspaceRoot: string | null; active: boolean; children: ReactNode; linkMode?: ReadingLinkMode }) {
  const storageKey = readingViewStorageKey(workspaceRoot, surfaceKey(surface));
  const [mode, updateMode] = useState<Session['mode']>(() => readReadingViewState(storageKey).mode);
  const id = useRef(crypto.randomUUID()).current;
  const group = JSON.stringify([workspaceRoot, 'entryId' in surface ? surface.entryId : null, 'reader']);
  const value = useMemo(() => ({ mode, setMode: (next: Session['mode']) => {
    updateMode(next); saveReadingViewState(storageKey, { mode: next });
  }, active, group, id, kind: surface.kind, linkMode }), [mode, active, group, id, storageKey, surface.kind, linkMode]);
  // The provider is retained with the tab; neither the document nor other views own its mode.
  if (surface.kind !== 'pdf' && surface.kind !== 'reflow') return <>{children}</>;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The tab owns state; the PDF toolbar owns placement. */
export function PdfViewControls() {
  const session = useReadingViewSession();
  if (!session) return null;
  return <>
    <div role="group" aria-label="PDF 显示内容" className="flex shrink-0 items-center rounded-md border bg-background">
      {(['original', 'replace'] as const).map(mode => <Button data-guide={mode === 'replace' ? 'translated-mode' : undefined} key={mode} size="sm" variant={session.mode === mode ? 'secondary' : 'ghost'} aria-pressed={session.mode === mode} onClick={() => session.setMode(mode)}>{({ original: '原文', replace: '译文' })[mode]}</Button>)}
    </div>
  </>;
}
