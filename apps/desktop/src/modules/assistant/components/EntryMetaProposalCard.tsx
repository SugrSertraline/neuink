import { Check, Loader2, PencilLine, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { AssistantEntryMetaProposal } from '@/shared/types/assistant';
import { ASSISTANT_ACTION_INCOMPLETE, formatAssistantError, useAssistantDebug } from '@/shared/lib/assistantDebug';

export function EntryMetaProposalCard({
  disabled = false,
  deciding = false,
  onApply,
  onOpenSource,
  onReject,
  proposal
}: {
  disabled?: boolean;
  deciding?: boolean;
  onApply?: (proposal: AssistantEntryMetaProposal) => void;
  onOpenSource: (source: ConversationSourceLink) => void;
  onReject?: (proposal: AssistantEntryMetaProposal) => void;
  proposal: AssistantEntryMetaProposal;
}) {
  const debug = useAssistantDebug();
  return (
    <article aria-label="条目元数据修改提案" className="entry-meta-proposal w-full min-w-0 max-w-full rounded-md border bg-muted/20 p-2 [overflow-wrap:anywhere]">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <PencilLine className="shrink-0 text-primary" size={13} aria-hidden="true" />
          编辑条目元数据
        </span>
        <ProposalStatus proposal={proposal} deciding={deciding} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">条目：{proposal.entryTitle}</p>

      {proposal.rationale ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{proposal.rationale}</p>
      ) : null}

      <div className="mt-2 grid min-w-0 grid-cols-1 gap-1.5">
        {proposal.fields.includes('title') ? (
          <MetadataDiff
            after={proposal.afterTitle}
            before={proposal.beforeTitle}
            label="标题"
          />
        ) : null}
        {proposal.fields.includes('description') ? (
          <MetadataDiff
            after={proposal.afterDescription}
            before={proposal.beforeDescription}
            label="描述"
          />
        ) : null}
      </div>

      {proposal.sources.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {proposal.sources.map((source) => (
            <button
              className="max-w-full rounded-md border px-1.5 py-0.5 text-[11px] text-primary hover:bg-muted"
              key={`${proposal.id}:${source.entryId}:${source.segmentUid}`}
              title={source.quote}
              type="button"
              onClick={() => onOpenSource({
                entry_id: source.entryId,
                entry_title: source.entryTitle,
                page_idx: source.pageIdx,
                quote: source.quote,
                segment_uid: source.segmentUid
              })}
            >
              {source.marker ?? 'S'} · p.{source.pageIdx + 1}
            </button>
          ))}
        </div>
      ) : null}

      {proposal.error ? (
        <p className="mt-1 text-[11px] text-destructive">{formatAssistantError(proposal.error, { debug, fallback: ASSISTANT_ACTION_INCOMPLETE })}</p>
      ) : null}

      {proposal.status === 'applying' && !deciding ? <p className="mt-1 text-[11px] text-warning">上次提交结果待核对，不会自动重试。请检查条目后再生成新提案。</p> : null}
      {proposal.status === 'pending' ? (
        <div className="entry-meta-proposal-actions mt-2 flex min-w-0 flex-wrap justify-end gap-1">
          <Button
            disabled={disabled || deciding || !onReject}
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => onReject?.(proposal)}
          >
            <X size={12} aria-hidden="true" />
            拒绝
          </Button>
          <Button
            disabled={disabled || deciding || !onApply}
            size="xs"
            type="button"
            onClick={() => onApply?.(proposal)}
          >
            {deciding ? (
              <Loader2 className="animate-spin" size={12} aria-hidden="true" />
            ) : (
              <Check size={12} aria-hidden="true" />
            )}
            确认应用
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function MetadataDiff({ after, before, label }: {
  after: string;
  before: string;
  label: string;
}) {
  return (
    <section aria-label={`${label}修改对比`} className="grid min-w-0 grid-cols-1 gap-1 rounded-sm border bg-background p-1.5">
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="entry-meta-proposal-diff grid min-w-0 grid-cols-1 gap-1">
        <DiffValue label="− 修改前" text={before} />
        <DiffValue after label="+ 修改后" text={after} />
      </div>
    </section>
  );
}

function DiffValue({ after = false, label, text }: {
  after?: boolean;
  label: string;
  text: string;
}) {
  return (
    <div className="min-w-0 rounded-sm border bg-muted/20 px-1.5 py-1">
      <div className={after ? 'text-[10px] text-primary' : 'text-[10px] text-muted-foreground'}>
        {label}
      </div>
      <div className="whitespace-pre-wrap text-[11px]">{text || '（空）'}</div>
    </div>
  );
}

function ProposalStatus({ proposal, deciding }: { proposal: AssistantEntryMetaProposal; deciding: boolean }) {
  if (deciding) {
    return <span className="flex max-w-full shrink-0 items-center gap-1 text-[10px] text-muted-foreground"><Loader2 className="shrink-0 animate-spin" size={13} aria-hidden="true" />正在提交</span>;
  }
  return <span className="max-w-full shrink-0 text-[10px] text-muted-foreground">{{ pending: '待确认', applying: '待核对结果', applied: '已应用', rejected: '已拒绝', error: '未完成，请核对' }[proposal.status]}</span>;
}
