import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIdeation } from './useIdeation';
import { useIdeationBackground } from './useIdeationBackground';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { CardKind, IdeationBoard, IdeationState } from '@/shared/ipc/ideationApi';
import { copyBoard, projectBoard, updateBoardGraph } from './ideationBoards';
import type { BranchSlot } from './ideationBranches';
import { useIdeationLayout } from './useIdeationLayout';

type IdeationContextValue = ReturnType<typeof useIdeation> & ReturnType<typeof useIdeationLayout> & {
  workspaceRoot: string;
  collection: IdeationState | null;
  activeBoard: IdeationBoard | null;
  selectBoard: (id: string) => void;
  createBoard: (title: string, description?: string) => void;
  editBoard: (id: string, change: Partial<Omit<IdeationBoard, 'id'>>) => void;
  duplicateBoard: (id: string) => void;
  sidebarTab: 'boards' | 'cards'; setSidebarTab: (tab: 'boards' | 'cards') => void;
  showSidebar: () => void;
  entryId: string; setEntryId: (id: string) => void;
  selectedCardId: string | null; setSelectedCardId: (id: string | null) => void;
  selectionSource: 'library' | 'canvas'; selectCanvasCard: (id: string) => void;
  selectedSlot: CardKind | null; selectSlot: (kind: CardKind | null) => void;
  branchSourceId: string | null; selectBranchSource: (id: string | null) => void;
  candidateRequest: number;
  branchTarget: BranchSlot | null; selectBranchTarget: (slot: BranchSlot | null) => void;
  completeBranchTarget: (slot?: BranchSlot | null) => void;
  requestBranch: (id: string) => void;
  cardRequest: { id: number; kind: CardKind } | null; requestCard: (kind: CardKind) => void;
  background: ReturnType<typeof useIdeationBackground>;
};
const Context = createContext<IdeationContextValue | null>(null);
const emptyEntries: LibraryEntry[] = [];
type Props = { root: string; children: ReactNode; entries?: LibraryEntry[]; libraryReady?: boolean; onShowSidebar?: () => void };

function ActiveProvider({ root, children, entries, libraryReady, onShowSidebar }: Props) {
  const store = useIdeation(root);
  const background = useIdeationBackground(root, entries ?? emptyEntries, store.state, Boolean(libraryReady), Boolean(entries));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'boards' | 'cards'>('boards');
  const [entryId, setEntryId] = useState('');
  const [selectedCardId, setCardId] = useState<string | null>(null);
  const [selectionSource, setSelectionSource] = useState<'library' | 'canvas'>('library');
  const setSelectedCardId = (id: string | null) => { setCardId(id); setSelectionSource('library'); };
  const selectCanvasCard = (id: string) => { setCardId(id); setSelectionSource('canvas'); };
  const [selectedSlot, setSelectedSlot] = useState<CardKind | null>(null);
  const [branchSourceId, setBranchSourceId] = useState<string | null>(null);
  const [candidateRequest, setCandidateRequest] = useState(0);
  const [branchTarget, setBranchTarget] = useState<Pick<BranchSlot, 'sourceId' | 'id'> | null>(null);
  const [cardRequest, setCardRequest] = useState<{ id: number; kind: CardKind } | null>(null);
  const activeBoard = store.state?.boards?.find(board => board.id === activeId && !board.deleted_at) ?? null;
  useEffect(() => {
    if (!activeBoard && store.state) {
      setActiveId(store.state.boards?.find(board => !board.deleted_at)?.id ?? null);
      setCardId(null); setSelectedSlot(null); setBranchSourceId(null); setBranchTarget(null);
    }
  }, [activeBoard, store.state]);
  const selectBoard = (id: string) => { setActiveId(id); setSelectedCardId(null); setSelectedSlot(null); setBranchSourceId(null); setBranchTarget(null); };
  const state = useMemo(() => store.state ? projectBoard(store.state, activeBoard?.id ?? null) : null, [store.state, activeBoard?.id]);
  // Capture board ownership before asynchronous draft reads, including while switching canvases.
  const update = useCallback((change: (current: IdeationState) => IdeationState) => {
    store.update(current => updateBoardGraph(current, activeBoard?.id ?? null, change));
  }, [store.update, activeBoard?.id]);
  const layout = useIdeationLayout(state, activeBoard?.id, branchSourceId, update);
  const currentBranchTarget = branchTarget ? layout.branchSlots.find(slot => slot.id === branchTarget.id && slot.sourceId === branchTarget.sourceId) ?? null : null;
  const createBoard = (title: string, description = '') => {
    const id = crypto.randomUUID(), now = new Date().toISOString();
    store.update(current => ({ ...current, boards: [...(current.boards ?? []), { id, title: title.trim(), description, created_at: now, updated_at: now }] }));
    selectBoard(id); setSidebarTab('cards'); onShowSidebar?.();
  };
  const editBoard = (id: string, change: Partial<Omit<IdeationBoard, 'id'>>) => store.update(current => ({ ...current,
    boards: current.boards?.map(board => board.id === id ? { ...board, ...change, updated_at: new Date().toISOString() } : board),
  }));
  const duplicateBoard = (sourceId: string) => { const id = crypto.randomUUID(); store.update(current => copyBoard(current, sourceId, id)); selectBoard(id); };
  const selectSlot = (kind: CardKind | null) => { setSelectedSlot(kind); setBranchTarget(null); setBranchSourceId(null); setSidebarTab('cards'); onShowSidebar?.(); };
  const selectBranchSource = (id: string | null) => { setBranchSourceId(id); setBranchTarget(null); setSelectedSlot(null); if (id) { setSidebarTab('cards'); onShowSidebar?.(); } };
  const selectBranchTarget = (slot: BranchSlot | null) => { setCandidateRequest(value => value + 1); setBranchTarget(slot); setSelectedSlot(null); if (slot) { setBranchSourceId(slot.sourceId); setSidebarTab('cards'); onShowSidebar?.(); } };
  const completeBranchTarget = (slot?: BranchSlot | null) => { if (slot) layout.consumeSlot(slot); setBranchTarget(current => slot && current?.id === slot.id && current.sourceId === slot.sourceId ? null : current); };
  const requestBranch = (id: string) => { if (!branchSourceId) return; layout.revealSlot(id); setCandidateRequest(value => value + 1); setBranchTarget({ id, sourceId: branchSourceId }); setSidebarTab('cards'); onShowSidebar?.(); };
  const requestCard = (kind: CardKind) => { setCardRequest(current => ({ id: (current?.id ?? 0) + 1, kind })); setSidebarTab('cards'); onShowSidebar?.(); };
  return <Context.Provider value={{ ...store, ...layout, workspaceRoot: root, collection: store.state, state, update, activeBoard, selectBoard, createBoard, editBoard, duplicateBoard,
    sidebarTab, setSidebarTab, showSidebar: () => onShowSidebar?.(), entryId, setEntryId, selectedCardId, setSelectedCardId, selectionSource, selectCanvasCard, selectedSlot, selectSlot,
    branchSourceId, selectBranchSource, candidateRequest, branchTarget: currentBranchTarget, selectBranchTarget, completeBranchTarget, requestBranch, cardRequest, requestCard, background }}>{children}</Context.Provider>;
}
export function IdeationProvider({ root, children, ...props }: Omit<Props, 'root'> & { root: string | null }) {
  return root ? <ActiveProvider key={root} root={root} {...props}>{children}</ActiveProvider> : <Context.Provider value={null}>{children}</Context.Provider>;
}
export function useIdeationContext() { return useContext(Context); }
