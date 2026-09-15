import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { inspectNoteSources, type SourceAvailability } from '@/shared/ipc/noteCatalogApi';
import type { SourceLink } from '@/shared/types/domain';
import { useWorkspaceNotes } from './WorkspaceNotesContext';

type SourceState = Pick<SourceAvailability, 'message' | 'can_locate' | 'status'>;
const Context = createContext<Record<string, SourceState> | null>(null);
export const useNoteSourceStatus = (anchor: string) => useContext(Context)?.[anchor] ?? null;

export function NoteSourcesProvider({ root, links, children }: { root: string | null; links: SourceLink[]; children: ReactNode }) {
  const workspace = useWorkspaceNotes();
  const signature = JSON.stringify([root, links.map((link) => [link.anchor_id, link.sources])]);
  const key = `${signature}:${workspace?.version ?? ''}`;
  const [result, setResult] = useState<{ key: string; states: Record<string, SourceState> } | null>(null);
  useEffect(() => {
    if (!root || !links.length) return;
    let cancelled = false;
    const sources = links.flatMap((link) => link.sources);
    void inspectNoteSources(root, sources).then((states) => {
      if (cancelled) return;
      let offset = 0;
      const byAnchor: Record<string, SourceState> = {};
      for (const link of links) {
        const matches = states.slice(offset, offset += link.sources.length);
        byAnchor[link.anchor_id] = matches.find((state) => !state.can_locate) ?? matches[0] ?? { status: 'unavailable', can_locate: false, message: '来源记录缺失' };
      }
      setResult({ key, states: byAnchor });
    }).catch(() => { if (!cancelled) setResult({ key, states: Object.fromEntries(links.map((link) => [link.anchor_id,
      { status: 'unavailable', can_locate: false, message: '来源状态检查失败，可刷新后重试' }])) }); });
    return () => { cancelled = true; };
  }, [key]);
  const pending: SourceState = { status: 'unavailable', message: '正在检查来源…', can_locate: false };
  return <Context.Provider value={!root ? null : result?.key === key ? result.states : Object.fromEntries(links.map((link) => [link.anchor_id, pending]))}>{children}</Context.Provider>;
}
