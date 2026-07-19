import { Tags } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { AssistantTagProposal } from '@/shared/types/assistant';

export function TagProposalList({
  onApply,
  onReject,
  proposals
}: {
  onApply?: (proposal: AssistantTagProposal) => void;
  onReject?: (proposal: AssistantTagProposal) => void;
  proposals: AssistantTagProposal[];
}) {
  return (
    <div className="tag-proposal-list mt-2 grid min-w-0 gap-1.5">
      {proposals.map((proposal) => (
        <article
          className="tag-proposal-card w-full min-w-0 max-w-full rounded-md border bg-muted/20 p-2"
          key={proposal.id}
        >
          <header className="tag-proposal-header flex min-w-0 items-start gap-1.5">
            <Tags className="mt-0.5 shrink-0 text-primary" size={13} aria-hidden="true" />
            <span className="tag-proposal-title min-w-0 flex-1 break-words font-medium">
              {tagProposalLabel(proposal)}
            </span>
            <span className="tag-proposal-status shrink-0 text-[10px] text-muted-foreground">
              {proposal.status}
            </span>
          </header>
          {proposal.rationale ? (
            <p className="mt-1 min-w-0 break-words text-[11px] text-muted-foreground">
              {proposal.rationale}
              {proposal.confidence != null
                ? ` · ${Math.round(proposal.confidence * 100)}%`
                : ''}
            </p>
          ) : null}
          {proposal.error ? (
            <p className="mt-1 break-words text-destructive">{proposal.error}</p>
          ) : null}
          {proposal.status === 'pending' ? (
            <div className="tag-proposal-actions mt-1.5 flex flex-wrap justify-end gap-1">
              <Button size="xs" type="button" variant="ghost" onClick={() => onReject?.(proposal)}>
                Ignore
              </Button>
              <Button size="xs" type="button" onClick={() => onApply?.(proposal)}>
                Apply
              </Button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function tagProposalLabel(proposal: AssistantTagProposal) {
  if (proposal.action === 'create') return `创建 Tag：${proposal.name ?? ''}`;
  if (proposal.action === 'rename') {
    return `重命名 Tag：${proposal.name ?? proposal.tagId ?? ''} → ${proposal.newName ?? ''}`;
  }
  const action = proposal.action === 'attach' ? '添加' : '移除';
  return `${action} Tag：${proposal.name ?? proposal.tagId ?? ''} · ${proposal.entryIds.length} 个 Entry`;
}
