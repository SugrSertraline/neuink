import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssistantNoteProposal } from '@/shared/types/assistant';

export type NoteReviewItem = { conversationId: string; messageId: string; proposal: AssistantNoteProposal };
type ReturnRequest = NoteReviewItem & { nonce: number };
export type ReviewDecision = 'apply' | 'reject';
export type ReviewActions = { conversationId: string; decide: (item: NoteReviewItem, decision: ReviewDecision) => Promise<void> };
type ReviewContext = {
  items: Record<string, NoteReviewItem>;
  publish: (items: NoteReviewItem[]) => void;
  open: (proposalId: string) => void;
  returnToConversation: (proposalId: string) => void;
  returnRequest: ReturnRequest | null;
  consumeReturn: (nonce: number) => void;
  registerActions: (actions: ReviewActions) => () => void;
  actionConversationId: string | null;
  deciding: string[];
  decide: (proposalId: string, decision: ReviewDecision) => Promise<void>;
};
const Context = createContext<ReviewContext | null>(null);

/** Window-local navigation projection only; Conversation/Verified Proposal remain authoritative. */
export function NoteReviewProvider({ children, onOpen, onShowAssistant }: {
  children: ReactNode;
  onOpen: (item: NoteReviewItem) => void;
  onShowAssistant: () => void;
}) {
  const [items, setItems] = useState<Record<string, NoteReviewItem>>({});
  const [returnRequest, setReturnRequest] = useState<ReturnRequest | null>(null);
  const [actions, setActions] = useState<ReviewActions | null>(null);
  const actionsRef = useRef<ReviewActions | null>(null);
  const locks = useRef(new Set<string>());
  const [deciding, setDeciding] = useState<string[]>([]);
  const itemsRef = useRef(items); itemsRef.current = items;
  const registerActions = useCallback((value: ReviewActions) => {
    actionsRef.current = value; setActions(value);
    return () => { if (actionsRef.current === value) { actionsRef.current = null; setActions(null); } };
  }, []);
  const decide = useCallback(async (id: string, decision: ReviewDecision) => {
    const item = itemsRef.current[id];
    const handler = actionsRef.current;
    if (locks.current.has(id)) return;
    if (locks.current.size) throw new Error('另一条修改正在处理，请完成后再确认。');
    if (!item || !handler || handler.conversationId !== item.conversationId) throw new Error('请先返回对应对话，加载修改后再确认。');
    if (!['pending', 'error'].includes(item.proposal.status)) return;
    locks.current.add(id); setDeciding([...locks.current]);
    try { await handler.decide(item, decision); }
    finally { locks.current.delete(id); setDeciding([...locks.current]); }
  }, []);
  const publish = useCallback((incoming: NoteReviewItem[]) => setItems(current => {
    const changed = incoming.filter(item => item.proposal.targetKind !== 'segment_note' &&
      (current[item.proposal.id]?.proposal !== item.proposal || current[item.proposal.id]?.conversationId !== item.conversationId));
    if (!changed.length) return current;
    const next = { ...current };
    changed.forEach(item => { next[item.proposal.id] = item; });
    return next;
  }), []);
  const consumeReturn = useCallback((nonce: number) => setReturnRequest(current => current?.nonce === nonce ? null : current), []);
  const value = useMemo<ReviewContext>(() => ({ items, publish, returnRequest, consumeReturn, registerActions, decide,
    actionConversationId: actions?.conversationId ?? null, deciding,
    open: id => { if (items[id]) onOpen(items[id]); },
    returnToConversation: id => {
      if (!items[id]) return;
      onShowAssistant();
      setReturnRequest(current => ({ ...items[id], nonce: Math.max(Date.now(), (current?.nonce ?? 0) + 1) }));
    }
  }), [items, publish, returnRequest, consumeReturn, onOpen, onShowAssistant, registerActions, decide, actions, deciding]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useNoteReview = () => useContext(Context);
export const noteProposalElementId = (id: string) => `note-proposal-${id}`;
