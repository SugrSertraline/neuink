import {
  AlertCircle,
  Brain,
  Check,
  CheckCircle2,
  Circle,
  FilePlus2,
  FileText,
  Loader2,
  Route,
  Search,
  X
} from 'lucide-react';
import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { Button } from '@/components/ui/button';
import type {
  AssistantMessagePart,
  AssistantToolTraceEvent,
  ConversationMessage,
  ConversationSourceLink
} from '@/shared/ipc/assistantApi';
import type {
  AssistantContextItem,
  AssistantContextPlan,
  AssistantEntryMetaProposal,
  AssistantNoteProposal,
  AssistantTagProposal,
  AssistantTaskPlan
} from '@/shared/types/assistant';
import { buildNoteProposalPreview } from './noteProposalPreview';
import { EntryMetaProposalCard } from './EntryMetaProposalCard';
import { TagProposalList } from './TagProposalList';

type ChatMessageProps = {
  message: ConversationMessage;
  noteProposals?: AssistantNoteProposal[];
  streaming: boolean;
  toolEvents?: AssistantToolTraceEvent[];
  onApplyNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onApplyEntryMetaProposal?: (proposal: AssistantEntryMetaProposal) => void;
  onApplyTagProposal?: (proposal: AssistantTagProposal) => void;
  onOpenSource: (source: ConversationSourceLink) => void;
  onRegenerateNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onRejectNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onRejectEntryMetaProposal?: (proposal: AssistantEntryMetaProposal) => void;
  onRejectTagProposal?: (proposal: AssistantTagProposal) => void;
  onRetryAgentRun?: (question: string) => void;
};

function ChatMessageComponent({
  message,
  noteProposals = [],
  streaming,
  toolEvents = [],
  onApplyNoteProposal,
  onApplyEntryMetaProposal,
  onApplyTagProposal,
  onOpenSource,
  onRegenerateNoteProposal,
  onRejectNoteProposal,
  onRejectEntryMetaProposal,
  onRejectTagProposal,
  onRetryAgentRun
}: ChatMessageProps) {
  const messageParts = message.parts ?? [];
  const content = message.content || textFromParts(messageParts);
  const resolvedToolEvents =
    toolEvents.length > 0 ? toolEvents : toolEventsFromParts(messageParts);
  const resolvedNoteProposals =
    noteProposals.length > 0 ? noteProposals : noteProposalsFromParts(messageParts);
  const resolvedPlan = planFromParts(messageParts);
  const tagProposals = tagProposalsFromParts(messageParts);
  const entryMetaProposals = entryMetaProposalsFromParts(messageParts);
  const resolvedAgentRun = agentRunFromParts(messageParts);
  const resolvedMemory = memoryFromParts(messageParts);
  const contextItems = contextItemsFromParts(messageParts);
  const contextPlan = contextPlanFromParts(messageParts);
  const sourceLinks =
    message.source_links.length > 0 ? message.source_links : sourceLinksFromParts(messageParts);

  return (
    <div
      className={`assistant-chat-message mb-2 rounded-md border p-2 text-xs leading-5 ${
        message.role === 'user' ? 'bg-muted/40' : 'bg-background'
      }`}
    >
      <div className="mb-1 font-medium">{message.role === 'user' ? 'You' : 'Neuink'}</div>
      {message.role === 'assistant' && resolvedAgentRun ? (
        <AgentRunSummary run={resolvedAgentRun} onRetry={onRetryAgentRun} />
      ) : null}
      {message.role === 'assistant' && resolvedPlan ? <PlanSummary plan={resolvedPlan} /> : null}
      {message.role === 'assistant' && resolvedMemory ? (
        <MemorySummary memory={resolvedMemory} />
      ) : null}
      {message.role === 'assistant' && resolvedToolEvents.length > 0 ? (
        <ToolTrace events={resolvedToolEvents} />
      ) : null}
      {contextItems.length > 0 ? <ContextSummary items={contextItems} plan={contextPlan} /> : null}
      <MarkdownMessageContent content={content} streaming={streaming} />
      {message.role === 'assistant' && resolvedNoteProposals.length > 0 ? (
        <NoteProposalList
          proposals={resolvedNoteProposals}
          onApply={onApplyNoteProposal}
          onOpenSource={onOpenSource}
          onRegenerate={onRegenerateNoteProposal}
          onReject={onRejectNoteProposal}
        />
      ) : null}
      {message.role === 'assistant' && tagProposals.length > 0 ? (
        <TagProposalList
          proposals={tagProposals}
          onApply={onApplyTagProposal}
          onReject={onRejectTagProposal}
        />
      ) : null}
      {message.role === 'assistant' && entryMetaProposals.length > 0 ? (
        <div className="mt-2 grid gap-1.5">
          {entryMetaProposals.map((proposal) => (
            <EntryMetaProposalCard
              key={proposal.id}
              proposal={proposal}
              onApply={onApplyEntryMetaProposal}
              onOpenSource={onOpenSource}
              onReject={onRejectEntryMetaProposal}
            />
          ))}
        </div>
      ) : null}
      {sourceLinks.length > 0 ? (
        <SourceLinkList onOpenSource={onOpenSource} sources={sourceLinks} />
      ) : null}
    </div>
  );
}

export const ChatMessage = memo(ChatMessageComponent);

const COLLAPSED_SOURCE_LIMIT = 10;

function SourceLinkList({
  onOpenSource,
  sources
}: {
  onOpenSource: (source: ConversationSourceLink) => void;
  sources: ConversationSourceLink[];
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = sources.length > COLLAPSED_SOURCE_LIMIT;
  const visibleSources = expanded ? sources : sources.slice(0, COLLAPSED_SOURCE_LIMIT);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1">
        {visibleSources.map((source, index) => (
          <button
            className="rounded-md border px-1.5 py-0.5 text-[11px] text-primary hover:bg-muted"
            key={`${source.entry_id}:${source.segment_uid}:${index}`}
            title={source.quote}
            type="button"
            onClick={() => onOpenSource(source)}
          >
            S{index + 1} · p.{source.page_idx + 1}
          </button>
        ))}
      </div>
      {collapsible ? (
        <Button
          aria-expanded={expanded}
          className="mt-1 h-6 px-1.5 text-[11px]"
          size="xs"
          type="button"
          variant="ghost"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '收起来源' : `展开全部来源（+${sources.length - COLLAPSED_SOURCE_LIMIT}）`}
        </Button>
      ) : null}
    </div>
  );
}

function textFromParts(parts: AssistantMessagePart[]) {
  return parts
    .filter((part): part is Extract<AssistantMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.markdown)
    .filter((markdown) => markdown.trim().length > 0)
    .join('\n\n');
}

function toolEventsFromParts(parts: AssistantMessagePart[]): AssistantToolTraceEvent[] {
  const eventsById = new Map<string, AssistantToolTraceEvent>();
  for (const part of parts) {
    if (part.type === 'tool-call') {
      eventsById.set(part.id, {
        id: part.id,
        input: part.args,
        status: part.status,
        toolName: part.toolName
      });
      continue;
    }

    if (part.type === 'tool-result') {
      const existing = eventsById.get(part.id);
      eventsById.set(part.id, {
        ...existing,
        id: part.id,
        sources: part.sourceLinks,
        status: 'done',
        summary: part.summary,
        toolName: part.toolName
      });
      continue;
    }

    if (part.type === 'error') {
      const id = part.id ?? `error:${part.toolName ?? 'assistant'}:${part.message}`;
      const existing = eventsById.get(id);
      eventsById.set(id, {
        ...existing,
        error: part.message,
        id,
        status: 'error',
        toolName: part.toolName ?? existing?.toolName ?? 'assistant'
      });
    }
  }

  return [...eventsById.values()];
}

function planFromParts(parts: AssistantMessagePart[]) {
  return parts.find(
    (part): part is Extract<AssistantMessagePart, { type: 'plan' }> => part.type === 'plan'
  )?.plan;
}

function tagProposalsFromParts(parts: AssistantMessagePart[]) {
  return parts
    .filter(
      (part): part is Extract<AssistantMessagePart, { type: 'tag-proposal' }> =>
        part.type === 'tag-proposal'
    )
    .map((part) => part.proposal);
}

function entryMetaProposalsFromParts(parts: AssistantMessagePart[]) {
  return parts
    .filter(
      (part): part is Extract<AssistantMessagePart, { type: 'entry-meta-proposal' }> =>
        part.type === 'entry-meta-proposal'
    )
    .map((part) => part.proposal);
}

function agentRunFromParts(parts: AssistantMessagePart[]) {
  return parts.find(
    (part): part is Extract<AssistantMessagePart, { type: 'agent-run' }> =>
      part.type === 'agent-run'
  )?.run;
}

function memoryFromParts(parts: AssistantMessagePart[]) {
  return parts.find(
    (part): part is Extract<AssistantMessagePart, { type: 'memory' }> =>
      part.type === 'memory'
  )?.memory;
}

function contextItemsFromParts(parts: AssistantMessagePart[]) {
  const snapshot = parts.find(
    (part): part is Extract<AssistantMessagePart, { type: 'context-snapshot' }> =>
      part.type === 'context-snapshot'
  );
  if (snapshot) {
    return snapshot.items;
  }
  return parts.find(
    (part): part is Extract<AssistantMessagePart, { type: 'context' }> =>
      part.type === 'context'
  )?.items ?? [];
}

function contextPlanFromParts(parts: AssistantMessagePart[]) {
  return parts.find(
    (part): part is Extract<AssistantMessagePart, { type: 'context-snapshot' }> =>
      part.type === 'context-snapshot'
  )?.plan;
}

function ContextSummary({
  items,
  plan
}: {
  items: AssistantContextItem[];
  plan?: AssistantContextPlan | null;
}) {
  return (
    <div className="mb-2 flex min-w-0 flex-wrap gap-1 rounded-md border bg-muted/20 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
      <span className="mr-0.5 font-medium text-foreground/80">Context</span>
      {items.map((item) => (
        <span
          className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-1.5 py-0.5"
          key={item.id}
          title={contextItemFullLabel(item)}
        >
          <FileText className="shrink-0 text-primary" size={11} aria-hidden="true" />
          <span className="max-w-40 truncate">{contextItemShortLabel(item)}</span>
        </span>
      ))}
      {plan?.summary ? (
        <span className="min-w-0 basis-full truncate pt-0.5 text-[10px] text-muted-foreground">
          {plan.summary}
        </span>
      ) : null}
    </div>
  );
}

function contextItemShortLabel(item: AssistantContextItem) {
  if (item.kind === 'segment') {
    return `${item.entryTitle} · p.${item.pageIdx + 1}`;
  }
  const kind =
    item.contentKind && item.contentKind !== 'entry'
      ? item.contentTitle ?? contextKindLabel(item.contentKind)
      : 'Overall';
  return `${item.entryTitle} · ${kind}`;
}

function contextItemFullLabel(item: AssistantContextItem) {
  if (item.kind === 'segment') {
    return `${item.entryTitle} · Segment · p.${item.pageIdx + 1}`;
  }
  const kind =
    item.contentKind && item.contentKind !== 'entry'
      ? item.contentTitle ?? contextKindLabel(item.contentKind)
      : 'Overall';
  return `${item.entryTitle} · ${kind}`;
}

function contextKindLabel(kind: NonNullable<Extract<AssistantContextItem, { kind: 'entry' }>['contentKind']>) {
  if (kind === 'pdf') {
    return 'PDF';
  }
  if (kind === 'reflow') {
    return 'Reflow';
  }
  if (kind === 'note') {
    return 'Note';
  }
  if (kind === 'overview') {
    return 'Overview';
  }
  return 'Overall';
}

function AgentRunSummary({
  onRetry,
  run
}: {
  onRetry?: (question: string) => void;
  run: Extract<AssistantMessagePart, { type: 'agent-run' }>['run'];
}) {
  const completed = run.nodes.filter((node) => node.status === 'succeeded').length;
  const failed = run.nodes.filter((node) => node.status === 'failed').length;
  const skipped = run.nodes.filter((node) => node.status === 'skipped').length;
  const visibleNodes = run.nodes.slice(0, 8);

  return (
    <div className="mb-2 rounded-md border bg-muted/20 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1.5">
        <Route className="shrink-0 text-primary" size={12} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/80">
          Agent run
        </span>
        <span>{agentRunStatusLabel(run.status)}</span>
        {run.durationMs !== undefined ? <span>{formatDuration(run.durationMs)}</span> : null}
        {(run.status === 'failed' || run.status === 'canceled') && onRetry ? (
          <Button
            className="h-5 px-1.5 text-[11px]"
            size="xs"
            type="button"
            variant="outline"
            onClick={() => onRetry(questionFromRun(run))}
          >
            Retry
          </Button>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {visibleNodes.map((node) => (
          <span
            className="inline-flex max-w-full items-center gap-1 rounded-sm border bg-background px-1.5 py-0.5"
            key={node.id}
            title={[
              node.inputSummary,
              node.outputSummary,
              node.error ? `Error: ${node.error}` : null
            ]
              .filter(Boolean)
              .join('\n')}
          >
            {node.status === 'succeeded' ? (
              <CheckCircle2 className="shrink-0 text-success" size={11} aria-hidden="true" />
            ) : node.status === 'failed' ? (
              <AlertCircle className="shrink-0 text-destructive" size={11} aria-hidden="true" />
            ) : node.status === 'canceled' ? (
              <Circle className="shrink-0 text-warning" size={11} aria-hidden="true" />
            ) : node.status === 'skipped' ? (
              <Circle className="shrink-0 text-muted-foreground" size={11} aria-hidden="true" />
            ) : (
              <Loader2 className="shrink-0 text-primary" size={11} aria-hidden="true" />
            )}
            <span className="truncate">{node.title}</span>
          </span>
        ))}
        {run.nodes.length > visibleNodes.length ? (
          <span className="rounded-sm border bg-background px-1.5 py-0.5">
            +{run.nodes.length - visibleNodes.length}
          </span>
        ) : null}
      </div>
      <div className="mt-1 truncate">
        {completed} done
        {failed > 0 ? ` · ${failed} failed` : ''}
        {skipped > 0 ? ` · ${skipped} skipped` : ''}
        {run.subagentTaskCount > 0 ? ` · ${run.subagentTaskCount} subagent task(s)` : ''}
        {run.verifierWarnings > 0 ? ` · ${run.verifierWarnings} verifier warning(s)` : ''}
      </div>
    </div>
  );
}

function questionFromRun(run: Extract<AssistantMessagePart, { type: 'agent-run' }>['run']) {
  const planner = run.nodes.find((node) => node.kind === 'planner' && node.inputSummary);
  const input = planner?.inputSummary ?? '';
  return input.startsWith('question=') ? input.slice('question='.length) : '';
}

function agentRunStatusLabel(status: Extract<AssistantMessagePart, { type: 'agent-run' }>['run']['status']) {
  if (status === 'succeeded') {
    return 'done';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'canceled') {
    return 'canceled';
  }
  return 'running';
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function PlanSummary({ plan }: { plan: AssistantTaskPlan }) {
  return (
    <div className="mb-2 rounded-md border bg-muted/25 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
      <span className="font-semibold text-foreground/80">Plan</span>
      <span> · {plan.intent}</span>
      <span> · {Math.round(plan.confidence * 100)}%</span>
      {plan.needsNoteProposal ? <span> · note proposal required</span> : null}
      {plan.target.kind !== 'chat_only' ? <span> · {plan.target.kind}</span> : null}
    </div>
  );
}

function MemorySummary({
  memory
}: {
  memory: Extract<AssistantMessagePart, { type: 'memory' }>['memory'];
}) {
  return (
    <div className="mb-2 rounded-md border bg-muted/20 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1.5">
        <Brain className="shrink-0 text-primary" size={12} aria-hidden="true" />
        <span className="min-w-0 truncate font-medium text-foreground/80">Memory updated</span>
      </div>
      <div className="mt-0.5 line-clamp-2 min-w-0 break-words">{memory.summary}</div>
      {memory.open_items.length > 0 ? (
        <div className="mt-0.5 truncate">{memory.open_items.join(' · ')}</div>
      ) : null}
    </div>
  );
}

function noteProposalsFromParts(parts: AssistantMessagePart[]) {
  return parts
    .filter(
      (part): part is Extract<AssistantMessagePart, { type: 'note-proposal' }> =>
        part.type === 'note-proposal'
    )
    .map((part) => part.proposal);
}

function sourceLinksFromParts(parts: AssistantMessagePart[]) {
  const links: ConversationSourceLink[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const source = part.type === 'source' ? part.source : null;
    if (!source) {
      continue;
    }
    const key = `${source.entry_id}:${source.segment_uid}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    links.push(source);
  }
  return links;
}

function NoteProposalList({
  proposals,
  onApply,
  onOpenSource,
  onRegenerate,
  onReject
}: {
  proposals: AssistantNoteProposal[];
  onApply?: (proposal: AssistantNoteProposal) => void;
  onOpenSource: (source: ConversationSourceLink) => void;
  onRegenerate?: (proposal: AssistantNoteProposal) => void;
  onReject?: (proposal: AssistantNoteProposal) => void;
}) {
  return (
    <div className="mt-2 grid gap-2">
      {proposals.map((proposal) => (
        <div
          className="min-w-0 rounded-md border bg-muted/20 p-2 text-xs leading-5"
          key={proposal.id}
        >
          <div className="flex min-w-0 items-center gap-2">
            <FilePlus2 className="shrink-0 text-primary" size={14} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{proposal.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {noteProposalActionLabel(proposal)} · {proposal.entryTitle}
                {proposal.noteTitle ? ` · ${proposal.noteTitle}` : ''}
              </div>
            </div>
            <NoteProposalStatus proposal={proposal} />
          </div>

          {proposal.rationale ? (
            <div className="mt-1 text-[11px] text-muted-foreground">{proposal.rationale}</div>
          ) : null}

          {proposal.error ? (
            <div className="mt-1 break-words text-[11px] text-destructive">
              {proposal.error}
            </div>
          ) : null}

          <NoteProposalPreview proposal={proposal} />

          {proposal.sources.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {proposal.sources.map((source) => (
                <button
                  className="rounded-md border px-1.5 py-0.5 text-[11px] text-primary hover:bg-muted"
                  key={`${proposal.id}:${source.entryId}:${source.segmentUid}`}
                  title={source.quote}
                  type="button"
                  onClick={() =>
                    onOpenSource({
                      entry_id: source.entryId,
                      entry_title: source.entryTitle,
                      page_idx: source.pageIdx,
                      quote: source.quote,
                      segment_uid: source.segmentUid
                    })
                  }
                >
                  {source.marker ?? 'S'} · p.{source.pageIdx + 1}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-2 flex justify-end gap-1">
            {isProposalConflict(proposal) ? (
              <Button
                size="xs"
                type="button"
                variant="outline"
                onClick={() => onRegenerate?.(proposal)}
              >
                Regenerate Diff
              </Button>
            ) : null}
            <Button
              disabled={proposal.status !== 'pending' && proposal.status !== 'error'}
              size="xs"
              type="button"
              variant="ghost"
              onClick={() => onReject?.(proposal)}
            >
              <X size={12} aria-hidden="true" />
              Ignore
            </Button>
            <Button
              disabled={proposal.status !== 'pending' && proposal.status !== 'error'}
              size="xs"
              type="button"
              onClick={() => onApply?.(proposal)}
            >
              {proposal.status === 'applying' ? (
                <Loader2 size={12} aria-hidden="true" />
              ) : (
                <Check size={12} aria-hidden="true" />
              )}
              Apply
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function isProposalConflict(proposal: AssistantNoteProposal) {
  return proposal.status === 'error' &&
    /target note changed|new Diff|conflict/i.test(proposal.error ?? '');
}

function NoteProposalPreview({ proposal }: { proposal: AssistantNoteProposal }) {
  const preview = buildNoteProposalPreview(proposal);
  if (preview.kind === 'change') {
    return (
      <div className="mt-2 rounded-sm border bg-background p-1.5">
        <DiffPane label={preview.label} text={preview.text} tone={preview.tone} />
      </div>
    );
  }
  if (preview.kind === 'diff') {
    return (
      <NoteProposalDiff
        afterMarkdown={preview.after}
        beforeMarkdown={preview.before}
      />
    );
  }

  return (
    <div className="assistant-markdown mt-2 max-h-40 overflow-auto rounded-sm border bg-background px-2 py-1.5">
      <ReactMarkdown
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {normalizeMathDelimiters(preview.text)}
      </ReactMarkdown>
    </div>
  );
}

function NoteProposalDiff({
  afterMarkdown,
  beforeMarkdown
}: {
  afterMarkdown: string;
  beforeMarkdown: string;
}) {
  return (
    <div className="mt-2 grid gap-1.5 rounded-sm border bg-background p-1.5">
      <DiffPane label="Before" text={beforeMarkdown} tone="before" />
      <DiffPane label="After" text={afterMarkdown} tone="after" />
    </div>
  );
}

function DiffPane({
  label,
  text,
  tone
}: {
  label: string;
  text: string;
  tone: 'after' | 'before';
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-sm border bg-muted/20">
      <div
        className={`border-b px-2 py-0.5 text-[10px] font-medium ${
          tone === 'after' ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        {label}
      </div>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 font-mono text-[11px] leading-4">
        {text || '(empty)'}
      </pre>
    </div>
  );
}

function NoteProposalStatus({ proposal }: { proposal: AssistantNoteProposal }) {
  if (proposal.status === 'applying') {
    return <Loader2 className="shrink-0 text-muted-foreground" size={13} />;
  }
  if (proposal.status === 'applied') {
    return <span className="shrink-0 text-[11px] text-primary">applied</span>;
  }
  if (proposal.status === 'rejected') {
    return <span className="shrink-0 text-[11px] text-muted-foreground">ignored</span>;
  }
  if (proposal.status === 'error') {
    return (
      <span className="shrink-0 text-[11px] text-destructive" title={proposal.error}>
        error
      </span>
    );
  }
  return <span className="shrink-0 text-[11px] text-muted-foreground">proposal</span>;
}

function noteProposalActionLabel(proposal: AssistantNoteProposal) {
  if (proposal.targetKind === 'segment_note') {
    if (proposal.action === 'prepend') {
      return '前置追加到片段笔记';
    }
    return proposal.action === 'replace' ? '替换片段笔记' : '追加到片段笔记';
  }
  if (proposal.action === 'create') {
    return 'Create note';
  }
  if (proposal.action === 'append') {
    return 'Append to note';
  }
  if (proposal.action === 'prepend') {
    return 'Prepend to note';
  }
  if (proposal.action === 'patch') {
    return 'Patch note';
  }
  return 'Replace note';
}

function ToolTrace({ events }: { events: AssistantToolTraceEvent[] }) {
  return (
    <div className="mb-2 grid gap-1">
      {events.map((event) => (
        <div
          className="min-w-0 rounded-sm border bg-muted/25 px-2 py-1 text-[11px] leading-4 text-muted-foreground"
          key={event.id}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <ToolTraceIcon event={event} />
            <span className="min-w-0 truncate font-medium text-foreground">
              {toolLabel(event.toolName)}
            </span>
            <span className="shrink-0">{statusLabel(event.status)}</span>
          </div>
          {event.error || event.summary ? (
            <div className="mt-0.5 min-w-0 break-words">
              {event.error ?? event.summary}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ToolTraceIcon({ event }: { event: AssistantToolTraceEvent }) {
  if (event.status === 'running') {
    return <Loader2 className="shrink-0" size={12} aria-hidden="true" />;
  }

  if (event.status === 'error') {
    return <AlertCircle className="shrink-0 text-destructive" size={12} aria-hidden="true" />;
  }

  if (event.toolName === 'search_segments') {
    return <Search className="shrink-0 text-primary" size={12} aria-hidden="true" />;
  }

  if (event.toolName.includes('.propose_')) {
    return <FilePlus2 className="shrink-0 text-primary" size={12} aria-hidden="true" />;
  }

  if (
    event.toolName === 'read_segment_content' ||
    event.toolName === 'read_entry_assistant_context'
  ) {
    return <FileText className="shrink-0 text-primary" size={12} aria-hidden="true" />;
  }

  return <CheckCircle2 className="shrink-0 text-primary" size={12} aria-hidden="true" />;
}

function toolLabel(toolName: string) {
  if (toolName === 'search_segments') {
    return 'Search segments';
  }
  if (toolName === 'read_segment_content') {
    return 'Read segment';
  }
  if (toolName === 'read_entry_assistant_context') {
    return 'Read entry markdown';
  }
  if (toolName === 'note.propose_create' || toolName === 'note_propose_create') {
    return 'Propose new note';
  }
  if (toolName === 'note.propose_patch' || toolName === 'note_propose_patch') {
    return 'Propose note patch';
  }
  if (
    toolName === 'segment_note.propose_patch' ||
    toolName === 'segment_note_propose_patch'
  ) {
    return 'Propose segment note patch';
  }
  if (toolName === 'entry.propose_meta_patch' || toolName === 'entry_propose_meta_patch') {
    return 'Propose Entry metadata';
  }
  return toolName;
}

function statusLabel(status: AssistantToolTraceEvent['status']) {
  if (status === 'running') {
    return 'running';
  }
  if (status === 'error') {
    return 'error';
  }
  return 'done';
}

const MarkdownMessageContent = memo(function MarkdownMessageContent({
  content,
  streaming
}: {
  content: string;
  streaming: boolean;
}) {
  const markdown = normalizeMathDelimiters(content);

  return (
    <div
      aria-busy={streaming || undefined}
      aria-live={streaming ? 'polite' : undefined}
      className="assistant-message-content assistant-markdown"
      data-streaming={streaming ? 'true' : undefined}
    >
      <ReactMarkdown
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
          code: ({ children, className }) => (
            <code className={className}>{children}</code>
          ),
          pre: ({ children }) => <pre>{children}</pre>
        }}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {markdown || ' '}
      </ReactMarkdown>
    </div>
  );
});

function normalizeMathDelimiters(markdown: string) {
  return markdown
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, latex: string) => `\n$$${latex.trim()}$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, latex: string) => `$${latex.trim()}$`);
}
