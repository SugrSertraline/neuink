import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { WorkspaceSurface } from '@/app/workspaceSurface';
import type { ReadingPosition } from './ReadingNavigation';

type Peer = { id: string; receive: (position: ReadingPosition) => void; capture?: () => ReadingPosition | null };
const groups = new Map<string, Set<Peer>>();
type Session = { mode: 'original' | 'replace'; setMode: (mode: 'original' | 'replace') => void; active: boolean; group: string; id: string };
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
export function ReadingViewSession({ surface, workspaceRoot, active, children }: { surface: WorkspaceSurface; workspaceRoot: string | null; active: boolean; children: ReactNode }) {
  const [mode, setMode] = useState<Session['mode']>('original');
  const id = useRef(crypto.randomUUID()).current;
  const group = JSON.stringify([workspaceRoot, 'entryId' in surface ? surface.entryId : null, surface.kind]);
  const value = useMemo(() => ({ mode, setMode, active, group, id }), [mode, active, group, id]);
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
