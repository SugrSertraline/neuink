import { useEffect, useRef } from 'react';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import { useNoteReview } from './NoteReviewContext';

/** Delegate review decisions to the loaded conversation's existing verified write path. */
export function useNoteReviewActions(options: {
  conversationId: string | null; disabled: boolean;
  apply: (proposal: AssistantNoteProposal) => Promise<void>;
  reject: (proposal: AssistantNoteProposal) => Promise<void>;
}) {
  const register = useNoteReview()?.registerActions;
  const latest = useRef(options); latest.current = options;
  useEffect(() => {
    if (!register || !options.conversationId || options.disabled) return;
    return register({ conversationId: options.conversationId, decide: async (item, decision) => {
      const current = latest.current;
      if (current.disabled || current.conversationId !== item.conversationId) throw new Error('对话已切换或正在执行，请返回对应对话再确认。');
      await current[decision](item.proposal);
    } });
  }, [register, options.conversationId, options.disabled]);
}
