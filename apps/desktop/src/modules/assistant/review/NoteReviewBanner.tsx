import { Button } from '@/components/ui/button';
import { useNoteReview } from './NoteReviewContext';

export function NoteReviewBanner({ entryId, noteId }: { entryId: string; noteId: string }) {
  const review = useNoteReview();
  const items = Object.values(review?.items ?? {}).filter(({ proposal }) =>
    proposal.entryId === entryId && proposal.noteId === noteId &&
    (proposal.status === 'pending' || proposal.status === 'error' || proposal.status === 'applying'));
  if (!items.length) return null;
  return <div className="flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-1.5 text-xs" role="region" aria-label="AI 待审阅修改">
    <span>AI 有 {items.length} 项修改待审阅 · 尚未写入正文</span>
    {items.map(({ proposal }, index) => <Button key={proposal.id} size="xs" variant="outline"
      onClick={() => review?.open(proposal.id)}>查看修改{items.length > 1 ? ` ${index + 1}` : ''}</Button>)}
  </div>;
}
