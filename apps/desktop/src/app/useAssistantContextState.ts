import { useCallback, useState } from 'react';
import type { AssistantContext, AssistantContextInput } from '@/shared/types/assistant';

/** Context synchronization owns data only; revealing the assistant is an explicit App action. */
export function useAssistantContextState() {
  const [assistantContext, setAssistantContext] = useState<AssistantContext>({ items: [] });
  const replaceAssistantContext = useCallback((items: AssistantContextInput[]) => {
    setAssistantContext({
      items: items.map(item => ({
        ...item,
        id: item.id ?? (item.kind === 'segment'
          ? item.kind + ':' + item.entryId + ':' + item.segmentUid
          : item.kind + ':' + item.entryId + (item.contentKind && item.contentKind !== 'entry'
            ? ':' + item.contentKind + ':' + (item.contentId ?? item.contentKind) : '')),
        addedAt: new Date().toISOString(),
      })),
    });
  }, []);
  return { assistantContext, setAssistantContext, replaceAssistantContext };
}
