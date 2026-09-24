import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNoteReview } from './NoteReviewContext';

export function NoteReviewDecisionBar({ proposalId, invalid }: { proposalId: string; invalid: boolean }) {
  const review = useNoteReview();
  const item = review?.items[proposalId];
  const [error, setError] = useState<string | null>(null);
  if (!review || !item || ['applied', 'rejected'].includes(item.proposal.status)) return null;
  const busy = review.deciding.length > 0 || item.proposal.status === 'applying';
  const connected = review.actionConversationId === item.conversationId;
  const decide = async (decision: 'apply' | 'reject') => {
    setError(null);
    try { await review.decide(proposalId, decision); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  return <footer className="shrink-0 border-t bg-card px-3 py-2 text-xs" aria-label="确认笔记修改">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 text-muted-foreground">{busy ? '正在处理，请稍候…' : connected ? '确认将应用整条提案的所有修改。' : '请返回对应对话，等待任务结束后确认。'}</span>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !connected} onClick={() => void decide('reject')}><X aria-hidden="true" />忽略修改</Button>
        <Button size="sm" disabled={busy || !connected || invalid} onClick={() => void decide('apply')}>
          {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}确认应用
        </Button>
      </div>
    </div>
    {error ? <p role="alert" className="mt-1 break-words text-destructive">{error}</p> : null}
  </footer>;
}
