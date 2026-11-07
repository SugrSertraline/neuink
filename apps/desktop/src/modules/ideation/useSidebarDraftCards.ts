import { useEffect, useState } from 'react';
import { readIdeationDraft, type IdeationDraftSummary, type PaperCard } from '@/shared/ipc/ideationApi';

/** Read bounded batches of full cards rather than treating the catalog's 280 characters as content. */
export function useSidebarDraftCards(root: string, summaries: IdeationDraftSummary[], limit: number) {
  const [cards, setCards] = useState<Map<string, PaperCard>>(new Map());
  const key = JSON.stringify(summaries.filter(item => item.status === 'ready').slice(0, limit).map(item => [item.entry_id, item.revision]));
  useEffect(() => {
    let live = true;
    setCards(new Map());
    const entries = JSON.parse(key) as [string, string][];
    void (async () => {
      for (let i = 0; i < entries.length && live; i += 3) {
        const batch = await Promise.allSettled(entries.slice(i, i + 3).map(([id]) => readIdeationDraft(root, id)));
        if (!live) return;
        setCards(current => {
          const next = new Map(current);
          batch.forEach(result => {
            // A failed read retains the catalog preview; clicking the title uses the existing retry/error flow.
            if (result.status === 'fulfilled') result.value?.draft?.cards.forEach(card => next.set(card.id, card));
          });
          return next;
        });
      }
    })();
    return () => { live = false; };
  }, [root, key]);
  return cards;
}
