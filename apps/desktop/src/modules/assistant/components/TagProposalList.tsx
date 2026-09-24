import { Tags, Plus, Minus, PencilLine, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { AssistantTagProposal } from '@/shared/types/assistant';

export function TagProposalList({
  disabled = false,
  decidingProposalId,
  onApply,
  onReject,
  proposals
}: {
  disabled?: boolean;
  decidingProposalId?: string | null;
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
              {decidingProposalId === proposal.id ? '正在提交' : ({ pending: '待确认', applying: '待核对结果', applied: '已应用', rejected: '已拒绝', error: '未完成，请核对' }[proposal.status])}
            </span>
          </header>
          <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px]">
            {proposal.action === 'detach' ? <Minus size={12} aria-hidden="true" /> : proposal.action === 'rename' ? <PencilLine size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
            <span>{proposal.action === 'detach' ? '移除关联（不删除标签）' : proposal.action === 'rename' ? '修改标签名称' : '新增标签或关联'}</span>
          </div>
          {proposal.entryIds.length > 0 ? <details className="mt-1 text-[11px]"><summary className="cursor-pointer">查看受影响的 {proposal.entryIds.length} 个条目</summary>
            <ul className="max-h-32 overflow-y-auto pl-3">{proposal.entryIds.map(id => <li key={id} className="break-words [overflow-wrap:anywhere]">{proposal.entryTitles?.[id] ?? id}</li>)}</ul>
          </details> : null}
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
          {proposal.status === 'applying' && decidingProposalId !== proposal.id ? <p className="mt-1 text-[11px] text-warning">上次提交结果待核对，不会自动重试。请检查标签后再生成新提案。</p> : null}
          {proposal.status === 'pending' ? (
            <div className="tag-proposal-actions mt-1.5 flex flex-wrap justify-end gap-1">
              <Button disabled={disabled || !onReject} size="xs" type="button" variant="ghost" onClick={() => onReject?.(proposal)}>
                拒绝
              </Button>
              <Button disabled={disabled || !onApply} size="xs" type="button" onClick={() => onApply?.(proposal)}>
                {decidingProposalId === proposal.id ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}确认应用
              </Button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function tagProposalLabel(proposal: AssistantTagProposal) {
  if (proposal.action === 'create') return `创建标签：${proposal.name ?? ''}`;
  if (proposal.action === 'rename') {
    return `重命名标签：${proposal.name ?? proposal.tagId ?? ''} → ${proposal.newName ?? ''}`;
  }
  const action = proposal.action === 'attach' ? '添加' : '移除';
  return `${action}标签：${proposal.name ?? proposal.tagId ?? ''} · ${proposal.entryIds.length} 个条目`;
}
