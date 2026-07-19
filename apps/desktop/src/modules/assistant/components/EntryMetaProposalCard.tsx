import { Check, Loader2, PencilLine, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { AssistantEntryMetaProposal } from '@/shared/types/assistant';

export function EntryMetaProposalCard({
  onApply,
  onOpenSource,
  onReject,
  proposal
}: {
  onApply?: (proposal: AssistantEntryMetaProposal) => void;
  onOpenSource: (source: ConversationSourceLink) => void;
  onReject?: (proposal: AssistantEntryMetaProposal) => void;
  proposal: AssistantEntryMetaProposal;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="flex items-center gap-1.5">
        <PencilLine className="text-primary" size={13} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">
          Edit Entry metadata: {proposal.entryTitle}
        </span>
        <ProposalStatus proposal={proposal} />
      </div>

      {proposal.rationale ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{proposal.rationale}</p>
      ) : null}

      <div className="mt-2 grid gap-1.5">
        {proposal.fields.includes('title') ? (
          <MetadataDiff
            after={proposal.afterTitle}
            before={proposal.beforeTitle}
            label="Title"
          />
        ) : null}
        {proposal.fields.includes('description') ? (
          <MetadataDiff
            after={proposal.afterDescription}
            before={proposal.beforeDescription}
            label="Description"
          />
        ) : null}
      </div>

      {proposal.sources.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {proposal.sources.map((source) => (
            <button
              className="rounded-md border px-1.5 py-0.5 text-[11px] text-primary hover:bg-muted"
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
        <p className="mt-1 break-words text-[11px] text-destructive">{proposal.error}</p>
      ) : null}

      {proposal.status === 'pending' || proposal.status === 'applying' ? (
        <div className="mt-2 flex justify-end gap-1">
          <Button
            disabled={proposal.status !== 'pending'}
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => onReject?.(proposal)}
          >
            <X size={12} aria-hidden="true" />
            Ignore
          </Button>
          <Button
            disabled={proposal.status !== 'pending'}
            size="xs"
            type="button"
            onClick={() => onApply?.(proposal)}
          >
            {proposal.status === 'applying' ? (
              <Loader2 className="animate-spin" size={12} aria-hidden="true" />
            ) : (
              <Check size={12} aria-hidden="true" />
            )}
            Apply
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MetadataDiff({ after, before, label }: {
  after: string;
  before: string;
  label: string;
}) {
  return (
    <div className="grid gap-1 rounded-sm border bg-background p-1.5">
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="grid gap-1 sm:grid-cols-2">
        <DiffValue label="Before" text={before} />
        <DiffValue after label="After" text={after} />
      </div>
    </div>
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
      <div className="whitespace-pre-wrap break-words text-[11px]">{text || '(empty)'}</div>
    </div>
  );
}

function ProposalStatus({ proposal }: { proposal: AssistantEntryMetaProposal }) {
  if (proposal.status === 'applying') {
    return <Loader2 className="animate-spin text-muted-foreground" size={13} />;
  }
  return <span className="text-[10px] text-muted-foreground">{proposal.status}</span>;
}
