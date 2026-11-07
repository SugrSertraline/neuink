import type { WorksheetSection } from './researchWorksheet';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIdeation } from './useIdeation';
import { useIdeationBackground } from './useIdeationBackground';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { CardKind, IdeationBoard, IdeationState } from '@/shared/ipc/ideationApi';
import { copyBoard, projectBoard, updateBoardGraph } from './ideationBoards';
import type { BranchSlot } from './ideationBranches';
import { useIdeationLayout } from './useIdeationLayout';

type IdeationContextValue = ReturnType<typeof useIdeation> & ReturnType<typeof useIdeationLayout> & {
  updateCollection: (change: (current: IdeationState) => IdeationState) => void;
  workspaceRoot: string;
  collection: IdeationState | null;
  activeBoard: IdeationBoard | null;
  selectBoard: (id: string) => void;
  createBoard: (title: string, description?: string) => void;
  editBoard: (id: string, change: Partial<Omit<IdeationBoard, 'id'>>) => void;
  duplicateBoard: (id: string) => void;
  sidebarTab: 'boards' | 'cards'; setSidebarTab: (tab: 'boards' | 'cards') => void;
  showSidebar: () => void;
  retainedSlots: BranchSlot[]; deleteSlot: (slot: BranchSlot) => void;
  entryId: string; setEntryId: (id: string) => void;
  selectedCardId: string | null; setSelectedCardId: (id: string | null) => void;
  selectionSource: 'library' | 'canvas'; selectCanvasCard: (id: string) => void;
  selectedSlot: CardKind | null; selectSlot: (kind: CardKind | null) => void;
  branchSourceId: string | null; selectBranchSource: (id: string | null) => void;
  worksheetSection: WorksheetSection | null; requestWorksheetCards: (section: WorksheetSection) => void;
  candidateRequest: number;
  branchTarget: BranchSlot | null; selectBranchTarget: (slot: BranchSlot | null) => void;
  completeBranchTarget: (slot?: BranchSlot | null) => void;
  requestBranch: (id: string) => void;
  cardRequest: { id: number; kind: CardKind } | null; requestCard: (kind: CardKind) => void;
  background: ReturnType<typeof useIdeationBackground>;
};
const Context = createContext<IdeationContextValue | null>(null);
const emptyEntries: LibraryEntry[] = [];
type Props = { root: string; children: ReactNode; entries?: LibraryEntry[]; libraryReady?: boolean; onShowSidebar?: () => void; onOpenWorkspace?: () => boolean };

function ActiveProvider({ root, children, entries, libraryReady, onShowSidebar, onOpenWorkspace }: Props) {
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
  const [worksheetSection,setWorksheetSection] = useState<WorksheetSection | null>(null);
  const [candidateRequest, setCandidateRequest] = useState(0);
  const [branchTarget, setBranchTarget] = useState<Pick<BranchSlot, 'sourceId' | 'id'> | null>(null);
  const slotStorageKey = `neuink:ideation-slots:${root}`;
  const [savedSlots, setSavedSlots] = useState<Record<string, BranchSlot[]>>(() => { try { return JSON.parse(localStorage.getItem(slotStorageKey) || '{}'); } catch { return {}; } });
  const retainSlots = (change: (current: Record<string, BranchSlot[]>) => Record<string, BranchSlot[]>) => setSavedSlots(current => { const next = change(current); localStorage.setItem(slotStorageKey, JSON.stringify(next)); return next; });
  const [cardRequest, setCardRequest] = useState<{ id: number; kind: CardKind } | null>(null);
  const activeBoard = store.state?.boards?.find(board => board.id === activeId && !board.deleted_at) ?? null;
  useEffect(() => {
    if (!activeBoard && store.state) {
      setActiveId(store.state.boards?.find(board => !board.deleted_at)?.id ?? null);
      setWorksheetSection(null); setCardId(null); setSelectedSlot(null); setBranchSourceId(null); setBranchTarget(null);
    }
  }, [activeBoard, store.state]);
  const selectBoard = (id: string) => { if (onOpenWorkspace?.() === false) return; setActiveId(id); setWorksheetSection(null); setSelectedCardId(null); setSelectedSlot(null); setBranchSourceId(null); setBranchTarget(null); };
  const state = useMemo(() => store.state ? projectBoard(store.state, activeBoard?.id ?? null) : null, [store.state, activeBoard?.id]);
  // Capture board ownership before asynchronous draft reads, including while switching canvases.
  const update = useCallback((change: (current: IdeationState) => IdeationState) => {
    store.update(current => updateBoardGraph(current, activeBoard?.id ?? null, change));
  }, [store.update, activeBoard?.id]);
  const layout = useIdeationLayout(state, activeBoard?.id, branchSourceId, update);
  const retainedSlots = (savedSlots[activeBoard?.id ?? ''] ?? []).filter(slot => state?.placements.some(node => node.id === slot.sourceId));
  const deleteSlot = (slot: BranchSlot) => { if (!activeBoard) return; retainSlots(current => ({ ...current, [activeBoard.id]: (current[activeBoard.id] ?? []).filter(item => item.id !== slot.id || item.sourceId !== slot.sourceId) })); setBranchTarget(current => current?.id === slot.id && current.sourceId === slot.sourceId ? null : current); };
  const currentBranchTarget = branchTarget ? [...retainedSlots, ...layout.branchSlots].find(slot => slot.id === branchTarget.id && slot.sourceId === branchTarget.sourceId) ?? null : null;
  const createBoard = (title: string, description = '') => {
    const id = crypto.randomUUID(), now = new Date().toISOString();
    store.update(current => ({ ...current, boards: [...(current.boards ?? []), { id, title: title.trim(), description, created_at: now, updated_at: now }] }));
    selectBoard(id); setSidebarTab('cards'); onShowSidebar?.();
  };
  const editBoard = (id: string, change: Partial<Omit<IdeationBoard, 'id'>>) => store.update(current => ({ ...current,
    boards: current.boards?.map(board => board.id === id ? { ...board, ...change, updated_at: new Date().toISOString() } : board),
  }));
  const duplicateBoard = (sourceId: string) => { const id = crypto.randomUUID(); store.update(current => copyBoard(current, sourceId, id)); selectBoard(id); };
  const selectSlot = (kind: CardKind | null) => { setWorksheetSection(null); setCandidateRequest(value => value + 1); setSelectedSlot(kind); setBranchTarget(null); setBranchSourceId(null); setSidebarTab('cards'); onShowSidebar?.(); };
  const selectBranchSource = (id: string | null) => { setBranchSourceId(id); setBranchTarget(null); setSelectedSlot(null); if (id) { setSidebarTab('cards'); onShowSidebar?.(); } };
  const selectBranchTarget = (slot: BranchSlot | null) => { setCandidateRequest(value => value + 1); setBranchTarget(slot); setSelectedSlot(null); if (slot) { setBranchSourceId(slot.sourceId); setSidebarTab('cards'); onShowSidebar?.(); } };
  const completeBranchTarget = (slot?: BranchSlot | null) => { if (slot) { layout.consumeSlot(slot); deleteSlot(slot); } setBranchTarget(current => slot && current?.id === slot.id && current.sourceId === slot.sourceId ? null : current); };
  const requestBranch = (id: string) => { if (!branchSourceId || !activeBoard) return; const slot = layout.branchSlots.find(item => item.id === id); if (slot) { const used = retainedSlots.filter(item => item.sourceId !== slot.sourceId || item.id !== slot.id); let y = slot.y; while (used.some(item => Math.abs(item.x - slot.x) < 320 && Math.abs(item.y - y) < 280) && y < 9700) y += 300; retainSlots(current => ({ ...current, [activeBoard.id]: [...used, { ...slot, y }] })); } setCandidateRequest(value => value + 1); setBranchTarget({ id, sourceId: branchSourceId }); setSidebarTab('cards'); onShowSidebar?.(); };
  const requestWorksheetCards = (section: WorksheetSection) => { setWorksheetSection(section); setSelectedSlot(null); setBranchTarget(null); setBranchSourceId(null); setCandidateRequest(value => value+1); setSidebarTab('cards'); onShowSidebar?.(); };
  const requestCard = (kind: CardKind) => { setCardRequest(current => ({ id: (current?.id ?? 0) + 1, kind })); setSidebarTab('cards'); onShowSidebar?.(); };
  return <Context.Provider value={{ ...store, ...layout, workspaceRoot: root, updateCollection: store.update, collection: store.state, state, update, activeBoard, selectBoard, createBoard, editBoard, duplicateBoard,
    retainedSlots, deleteSlot, sidebarTab, setSidebarTab, showSidebar: () => onShowSidebar?.(), entryId, setEntryId, selectedCardId, setSelectedCardId, selectionSource, selectCanvasCard, selectedSlot, selectSlot,
    worksheetSection, requestWorksheetCards, branchSourceId, selectBranchSource, candidateRequest, branchTarget: currentBranchTarget, selectBranchTarget, completeBranchTarget, requestBranch, cardRequest, requestCard, background }}>{children}</Context.Provider>;
}
export function IdeationProvider({ root, children, ...props }: Omit<Props, 'root'> & { root: string | null }) {
  return root ? <ActiveProvider key={root} root={root} {...props}>{children}</ActiveProvider> : <Context.Provider value={null}>{children}</Context.Provider>;
}
export function useIdeationContext() { return useContext(Context); }
