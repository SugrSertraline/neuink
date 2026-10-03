import {
  AlertCircle,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  FilePlus2,
  FileMinus2,
  FileDiff,
  FileText,
  Loader2,
  Library,
  Route,
  Search,
  Bot,
  UserRound,
  X
} from 'lucide-react';
import { memo, useId, useMemo, useState } from 'react';
import { useAssistantReading } from './AssistantReplyActionsContext';
import { PaperAnswerContent } from './PaperAnswerContent';
import { SciverseImportButton } from './SciverseImportButton';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { WorkspaceWebLink } from '@/shared/components/WorkspaceWebLink';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { Button } from '@/components/ui/button';
import type {
  AssistantMessagePart,
  AssistantToolTraceEvent,
  ConversationMessage,
  ConversationSourceLink,
  SciverseLibraryImportResult
} from '@/shared/ipc/assistantApi';
import {
  conversationSourceKey,
  isSciverseConversationSource
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
import { ExecutionDetails } from './ExecutionDetails';
import { noteProposalElementId, useNoteReview } from '../review/NoteReviewContext';
import { AssistantDiagramBlock } from './AssistantDiagramBlock';
import { NoteDiffLines, NoteRenderedContent } from '../review/NoteDiffLines';
import { buildRenderedNoteDiff } from '../review/renderedNoteDiff';
import { ASSISTANT_ACTION_INCOMPLETE, assistantToolErrorNotice, formatAssistantError, formatAssistantToolSummary, useAssistantDebug } from '@/shared/lib/assistantDebug';

type ChatMessageProps = {
  reading?: boolean;
  awaitingApproval?: boolean;
  proposalsDisabled?: boolean;
  decidingProposalId?: string | null;
  message: ConversationMessage;
  noteProposals?: AssistantNoteProposal[];
  streaming: boolean;
  toolEvents?: AssistantToolTraceEvent[];
  onApplyNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onApplyEntryMetaProposal?: (proposal: AssistantEntryMetaProposal) => void;
  onApplyTagProposal?: (proposal: AssistantTagProposal) => void;
  onOpenSource: (source: ConversationSourceLink) => void;
  onAddSciverseSource?: (
    source: Extract<ConversationSourceLink, { provider: 'sciverse' }>
  ) => Promise<SciverseLibraryImportResult>;
  onRegenerateNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onRejectNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onRejectEntryMetaProposal?: (proposal: AssistantEntryMetaProposal) => void;
  onRejectTagProposal?: (proposal: AssistantTagProposal) => void;
  onRetryAgentRun?: (question: string) => void;
};

function ChatMessageComponent({
  reading = false,
  awaitingApproval = false,
  proposalsDisabled = false,
  decidingProposalId,
  message,
  noteProposals = [],
  streaming,
  toolEvents = [],
  onApplyNoteProposal,
  onApplyEntryMetaProposal,
  onApplyTagProposal,
  onOpenSource,
  onAddSciverseSource,
  onRegenerateNoteProposal,
  onRejectNoteProposal,
  onRejectEntryMetaProposal,
  onRejectTagProposal,
  onRetryAgentRun
}: ChatMessageProps) {
  const readingActions = useAssistantReading();
  const messageParts = message.parts ?? [];
  const content = message.content || textFromParts(messageParts);
  const resolvedToolEvents =
    toolEvents.length > 0 ? toolEvents : toolEventsFromParts(messageParts);
  const diagrams = resolvedToolEvents.filter(event => event.status === 'done' && event.diagram);
  const resolvedNoteProposals =
    noteProposals.length > 0 ? noteProposals : noteProposalsFromParts(messageParts);
  const resolvedPlan = planFromParts(messageParts);
  const tagProposals = tagProposalsFromParts(messageParts);
  const entryMetaProposals = entryMetaProposalsFromParts(messageParts);
  const resolvedAgentRun = agentRunFromParts(messageParts);
  const toolErrorNotice = assistantToolErrorNotice({ streaming, hasAnswer: Boolean(content.trim()), runStatus: resolvedAgentRun?.status });
  const resolvedMemory = memoryFromParts(messageParts);
  const reasoning = reasoningFromParts(messageParts);
  const contextItems = contextItemsFromParts(messageParts);
  const contextPlan = contextPlanFromParts(messageParts);
  const isPlanningRequest = messageParts.some(part => part.type === 'context-snapshot' && part.composer?.executionMode === 'plan');
  const sourceLinks =
    message.source_links.length > 0 ? message.source_links : sourceLinksFromParts(messageParts);
  const discoveredSciverseSources = sciverseSourcesFromToolParts(messageParts);
  const answerContent = message.role === 'assistant'
    ? <PaperAnswerContent message={message} content={content} sources={sourceLinks} discovered={discoveredSciverseSources}
      streaming={streaming} onOpenSource={onOpenSource} onImport={onAddSciverseSource}
      renderMarkdown={text => <MarkdownMessageContent content={text} sources={sourceLinks} streaming={streaming} onOpenSource={onOpenSource} />} />
    : <MarkdownMessageContent content={content} sources={sourceLinks} streaming={streaming} onOpenSource={onOpenSource} />;
  if (reading) return <div className="min-w-0 text-base leading-7 [overflow-wrap:anywhere]">
    {answerContent}
    {diagrams.map(event => <ToolDiagram key={event.id} event={event} onOpenSource={onOpenSource} />)}
    {(sourceLinks.length > 0 || discoveredSciverseSources.length > 0) && <SourceLinkList discoveredSciverseSources={discoveredSciverseSources} sources={sourceLinks} onOpenSource={onOpenSource} />}
  </div>;

  return (
    <article aria-label={message.role === 'user' ? '你的消息' : 'Neuink 的回复'}
      className={`assistant-message-row mb-3 flex min-w-0 items-start gap-1.5 ${message.role === 'user' ? 'flex-row-reverse pl-5' : 'pr-3'}`}>
      <span aria-hidden="true" className={`assistant-message-avatar mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border ${message.role === 'user' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
        {message.role === 'user' ? <UserRound size={14} /> : <Bot size={14} />}
      </span>
      <div
        data-message-role={message.role}
        className={`assistant-chat-message min-w-0 max-w-full rounded-lg border px-2.5 py-2 text-sm leading-6 ${
          message.role === 'user' ? 'rounded-tr-none bg-accent text-accent-foreground' : 'flex-1 rounded-tl-none bg-card text-card-foreground'
        }`}
      >
      <div className={`mb-1 text-[11px] font-medium text-muted-foreground ${message.role === 'user' ? 'text-right' : ''}`}>{message.role === 'user' ? '你' : 'Neuink'}</div>
      {isPlanningRequest ? <div className="mb-1 text-[11px] text-muted-foreground">仅规划 · 只读</div> : null}
      {message.role === 'assistant' && (streaming || resolvedAgentRun || resolvedPlan || resolvedMemory || resolvedToolEvents.length > 0 || reasoning) ? (
        <ExecutionDetails key={message.message_id} awaitingApproval={awaitingApproval} streaming={streaming} hasAnswer={Boolean(content.trim())} run={resolvedAgentRun} events={resolvedToolEvents}>
      {resolvedAgentRun ? (
        <AgentRunSummary run={resolvedAgentRun} errorNotice={toolErrorNotice} onRetry={onRetryAgentRun} />
      ) : null}
      {resolvedPlan ? <PlanSummary plan={resolvedPlan} /> : null}
      {resolvedMemory ? (
        <MemorySummary memory={resolvedMemory} />
      ) : null}
      {resolvedToolEvents.length > 0 ? (
        <ToolTrace events={resolvedToolEvents} errorNotice={toolErrorNotice} />
      ) : null}
      {reasoning ? (
        <section className="text-[11px] leading-4 text-muted-foreground" aria-label="思考过程">
          <div className="mb-1 font-medium">思考过程</div>
          <div className="whitespace-pre-wrap break-words">{reasoning}</div>
        </section>
      ) : null}
        </ExecutionDetails>
      ) : null}
      {contextItems.length > 0 ? <ContextSummary items={contextItems} plan={contextPlan} /> : null}
      {message.role === 'assistant' && (content || diagrams.length > 0) && !streaming && readingActions ? <div className="mb-2">
        <Button size="xs" variant="ghost" onClick={() => readingActions.openReply({ ...message, content, source_links: sourceLinks })}>展开阅读</Button>
      </div> : null}
      {answerContent}
      {diagrams.map(event => <ToolDiagram key={event.id} event={event} onOpenSource={onOpenSource} />)}
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
          disabled={proposalsDisabled || streaming}
          decidingProposalId={decidingProposalId}
          proposals={tagProposals}
          onApply={onApplyTagProposal}
          onReject={onRejectTagProposal}
        />
      ) : null}
      {message.role === 'assistant' && entryMetaProposals.length > 0 ? (
        <div className="mt-2 grid gap-1.5">
          {entryMetaProposals.map((proposal) => (
            <EntryMetaProposalCard
              disabled={proposalsDisabled || streaming}
              deciding={decidingProposalId === proposal.id}
              key={proposal.id}
              proposal={proposal}
              onApply={onApplyEntryMetaProposal}
              onOpenSource={onOpenSource}
              onReject={onRejectEntryMetaProposal}
            />
          ))}
        </div>
      ) : null}
        {sourceLinks.length > 0 || discoveredSciverseSources.length > 0 ? (
          <SourceLinkList
            discoveredSciverseSources={discoveredSciverseSources}
            onAddSciverseSource={undefined}
            onOpenSource={onOpenSource}
            sources={sourceLinks}
          />
        ) : null}
      </div>
    </article>
  );
}

export const ChatMessage = memo(ChatMessageComponent);

function ToolDiagram({ event, onOpenSource }: {
  event: AssistantToolTraceEvent;
  onOpenSource: (source: ConversationSourceLink) => void;
}) {
  const diagram = event.diagram;
  if (!diagram) return null;
  return <section aria-label={diagram.kind === 'mindmap' ? '思维导图' : '流程图'} className="my-3 min-w-0 rounded-md border border-border bg-background p-2">
    <div className="mb-1 text-sm font-medium">{diagram.title}</div>
    <AssistantDiagramBlock code={diagram.code} streaming={false} />
    {diagram.sourceMarkers.length > 0 ? <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
      <span>依据</span>
      {diagram.sourceMarkers.map((marker, index) => {
        const source = event.sources?.[index];
        return source ? <Button key={marker} size="xs" variant="outline" onClick={() => onOpenSource(source)}>[S{marker}]</Button> : null;
      })}
    </div> : null}
  </section>;
}


const COLLAPSED_SOURCE_LIMIT = 10;

function SourceLinkList({
  discoveredSciverseSources,
  onAddSciverseSource,
  onOpenSource,
  sources
}: {
  discoveredSciverseSources: Array<Extract<ConversationSourceLink, { provider: 'sciverse' }>>;
  onAddSciverseSource?: (
    source: Extract<ConversationSourceLink, { provider: 'sciverse' }>
  ) => Promise<SciverseLibraryImportResult>;
  onOpenSource: (source: ConversationSourceLink) => void;
  sources: ConversationSourceLink[];
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const [paperExpanded, setPaperExpanded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  const sourcesId = useId();
  const numbered = sources.map((source, index) => ({ marker: index + 1, source }));
  const localSources = numbered.filter(({ source }) => !isSciverseConversationSource(source));
  const paperGroups = groupSciverseSources(numbered, discoveredSciverseSources);
  const localCollapsible = localSources.length > COLLAPSED_SOURCE_LIMIT;
  const visibleLocalSources = localExpanded
    ? localSources
    : localSources.slice(0, COLLAPSED_SOURCE_LIMIT);
  const visiblePaperGroups = paperExpanded ? paperGroups : paperGroups.slice(0, 5);

  return (
    <section aria-label="回答来源" className="mt-2 grid gap-2 border-t pt-2">
      <Button variant="ghost" size="xs" className="h-auto max-w-full justify-start whitespace-normal text-left text-muted-foreground"
        aria-expanded={expanded} aria-controls={sourcesId} onClick={() => { setOpened(true); setExpanded(value => !value); }}>
        <ChevronRight size={12} aria-hidden="true" className={expanded ? 'rotate-90 shrink-0' : 'shrink-0'} />
        查看来源{sources.length ? ` · ${sources.length} 处引用` : ''}
      </Button>
      {/* Keep import state after first opening, so collapsing cannot enable a duplicate import. */}
      {opened && <div id={sourcesId} hidden={!expanded} className={`${expanded ? 'grid' : 'hidden'} max-h-80 min-w-0 gap-2 overflow-y-auto overscroll-contain`}>
      {paperGroups.length > 0 && <p className="text-xs text-muted-foreground">Sciverse 检索记录 · {paperGroups.length} 组（含未引用候选及不同版本）</p>}
      {visiblePaperGroups.length > 0 ? (
        <div className="grid gap-1.5">
          {visiblePaperGroups.map((group) => (
            <SciversePaperSourceCard
              group={group}
              key={group.docId}
              onAddSciverseSource={onAddSciverseSource}
              onOpenSource={onOpenSource}
            />
          ))}
        </div>
      ) : null}
      {paperGroups.length > 5 ? (
        <Button
          aria-expanded={paperExpanded}
          className="h-6 w-fit px-1.5 text-[11px]"
          size="xs"
          type="button"
          variant="ghost"
          onClick={() => setPaperExpanded((current) => !current)}
        >
          {paperExpanded ? '收起论文来源' : `展开全部论文（+${paperGroups.length - 5}）`}
        </Button>
      ) : null}
      {visibleLocalSources.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {visibleLocalSources.map(({ marker, source }) => (
          <button
            className="rounded-md border px-1.5 py-0.5 text-[11px] text-primary hover:bg-muted"
            key={`${conversationSourceKey(source)}:${marker}`}
            title="查看引用证据"
            type="button"
            onClick={() => onOpenSource(source)}
          >
            {sourceButtonLabel(source, marker)}
          </button>
          ))}
        </div>
      ) : null}
      {localCollapsible ? (
        <Button
          aria-expanded={localExpanded}
          className="h-6 w-fit px-1.5 text-[11px]"
          size="xs"
          type="button"
          variant="ghost"
          onClick={() => setLocalExpanded((current) => !current)}
        >
          {localExpanded
            ? '收起来源'
            : `展开全部来源（+${localSources.length - COLLAPSED_SOURCE_LIMIT}）`}
        </Button>
      ) : null}
      </div>}
    </section>
  );
}

type NumberedSource = { marker: number; source: ConversationSourceLink };
type SciversePaperGroup = {
  docId: string;
  items: Array<{
    marker: number | null;
    source: Extract<ConversationSourceLink, { provider: 'sciverse' }>;
  }>;
};

function groupSciverseSources(
  sources: NumberedSource[],
  discoveredSources: Array<Extract<ConversationSourceLink, { provider: 'sciverse' }>>
) {
  const groups = new Map<string, SciversePaperGroup>();
  const seen = new Set<string>();
  for (const item of sources) {
    if (!isSciverseConversationSource(item.source)) continue;
    const group = groups.get(item.source.doc_id) ?? { docId: item.source.doc_id, items: [] };
    group.items.push({ marker: item.marker, source: item.source });
    groups.set(item.source.doc_id, group);
    seen.add(conversationSourceKey(item.source));
  }
  for (const source of discoveredSources) {
    const key = conversationSourceKey(source);
    if (seen.has(key)) continue;
    const group = groups.get(source.doc_id) ?? { docId: source.doc_id, items: [] };
    group.items.push({ marker: null, source });
    groups.set(source.doc_id, group);
    seen.add(key);
  }
  return [...groups.values()];
}

function SciversePaperSourceCard({
  group,
  onAddSciverseSource,
  onOpenSource
}: {
  group: SciversePaperGroup;
  onAddSciverseSource?: (
    source: Extract<ConversationSourceLink, { provider: 'sciverse' }>
  ) => Promise<SciverseLibraryImportResult>;
  onOpenSource: (source: ConversationSourceLink) => void;
}) {
  const representative = group.items.reduce((best, item) =>
    (item.source.score ?? -1) > (best.source.score ?? -1) ? item : best
  ).source;
  const metadata = [
    representative.publication_year,
    representative.venue,
    [...new Map((representative.authors ?? []).map(author => [author.trim().toLowerCase(), author.trim()])).values()].slice(0, 2).join(', '),
    representative.citation_count != null ? `被引 ${representative.citation_count}` : null
  ].filter(Boolean);

  return (
    <article className="min-w-0 rounded-md border bg-muted/15 p-2">
      <button
        className="block w-full min-w-0 text-left"
        title={representative.title}
        type="button"
        onClick={() => onOpenSource(representative)}
      >
        <span className="line-clamp-2 font-medium leading-4 text-foreground">
          {representative.title}
        </span>
        {metadata.length > 0 ? (
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {metadata.join(' · ')}
          </span>
        ) : null}
      </button>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {group.items.map(({ marker, source }) => marker != null ? (
          <button
            className="rounded border bg-background px-1.5 py-0.5 text-[10px] text-primary hover:bg-muted"
            key={`${conversationSourceKey(source)}:${marker}`}
            title={source.quote}
            type="button"
            onClick={() => onOpenSource(source)}
          >
            S{marker} · {sourceLocationLabel(source)}
          </button>
        ) : null)}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {onAddSciverseSource ? (
          <SciverseImportButton source={representative} onImport={onAddSciverseSource} />
        ) : null}
      </div>
    </article>
  );
}


function textFromParts(parts: AssistantMessagePart[]) {
  return parts
    .filter((part): part is Extract<AssistantMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.markdown)
    .filter((markdown) => markdown.trim().length > 0)
    .join('\n\n');
}

function reasoningFromParts(parts: AssistantMessagePart[]) {
  return parts
    .filter(
      (part): part is Extract<AssistantMessagePart, { type: 'reasoning' }> =>
        part.type === 'reasoning'
    )
    .map((part) => part.text)
    .join('');
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
        diagram: part.diagram,
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
  errorNotice,
  run
}: {
  onRetry?: (question: string) => void;
  errorNotice: string;
  run: Extract<AssistantMessagePart, { type: 'agent-run' }>['run'];
}) {
  const debug = useAssistantDebug();
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
            title={node.error || node.status === 'failed' ? formatAssistantError(node.error ?? node.outputSummary, { debug, fallback: errorNotice }) : [
              node.inputSummary,
              formatAssistantToolSummary(node.outputSummary, debug)
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
    const key = conversationSourceKey(source);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    links.push(source);
  }
  return links;
}

function sciverseSourcesFromToolParts(parts: AssistantMessagePart[]) {
  const sources: Array<Extract<ConversationSourceLink, { provider: 'sciverse' }>> = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.type !== 'tool-result' || !part.sourceLinks) continue;
    for (const source of part.sourceLinks) {
      if (!isSciverseConversationSource(source)) continue;
      const key = conversationSourceKey(source);
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(source);
    }
  }
  return sources;
}

function sourceButtonLabel(source: ConversationSourceLink, marker: number) {
  if (isSciverseConversationSource(source)) {
    return `S${marker} · ${sourceLocationLabel(source)}`;
  }
  return `S${marker} · p.${source.page_idx + 1}`;
}

function sourceLocationLabel(source: ConversationSourceLink) {
  if (!isSciverseConversationSource(source)) {
    return `p.${source.page_idx + 1}`;
  }
  if (source.page_no != null && Number.isInteger(source.page_no) && source.page_no > 0) {
    return `p.${source.page_no}`;
  }
  return 'Sciverse 来源';
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
  const review = useNoteReview();
  const debug = useAssistantDebug();
  const [decisionError, setDecisionError] = useState<Record<string, string>>({});
  const decide = async (proposal: AssistantNoteProposal, action: 'apply' | 'reject') => {
    setDecisionError(current => ({ ...current, [proposal.id]: '' }));
    try {
      if (review && proposal.targetKind !== 'segment_note') await review.decide(proposal.id, action);
      else if (action === 'apply') onApply?.(proposal);
      else onReject?.(proposal);
    } catch (caught) { setDecisionError(current => ({ ...current, [proposal.id]: caught instanceof Error ? caught.message : String(caught) })); }
  };
  const decisionDisabled = (proposal: AssistantNoteProposal) => !['pending', 'error'].includes(proposal.status) ||
    Boolean(review && proposal.targetKind !== 'segment_note' &&
      (review.deciding.length > 0 || !review.items[proposal.id] || review.actionConversationId !== review.items[proposal.id].conversationId));
  return (
    <div className="note-proposal-list mt-2 grid min-w-0 gap-2">
      {proposals.map((proposal) => (
        <div
          className="note-proposal-card min-w-0 rounded-md border bg-muted/20 p-2 text-xs leading-5 [overflow-wrap:anywhere]"
          key={proposal.id}
          id={noteProposalElementId(proposal.id)} tabIndex={-1}
        >
          <div className="note-proposal-header flex min-w-0 flex-wrap items-center gap-2">
            {proposal.action === 'delete' ? <FileMinus2 className="shrink-0 text-destructive" size={14} aria-hidden="true" />
              : ['create', 'append', 'prepend'].includes(proposal.action) ? <FilePlus2 className="shrink-0 text-success" size={14} aria-hidden="true" />
              : <FileDiff className="shrink-0 text-info" size={14} aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" title={proposal.title}>{proposal.title}</div>
              <div className="truncate text-[11px] text-muted-foreground" title={`${noteProposalActionLabel(proposal)} · ${proposal.entryTitle}`}>
                {noteProposalActionLabel(proposal)} · {proposal.entryTitle}
                {proposal.noteTitle ? ` · ${proposal.noteTitle}` : ''}
              </div>
            </div>
            <div className="note-proposal-status"><NoteProposalStatus proposal={proposal} /></div>
          </div>

          {proposal.rationale ? (
            <div className="mt-1 text-[11px] text-muted-foreground">{proposal.rationale}</div>
          ) : null}

          {proposal.error ? (
            <div className="mt-1 break-words text-[11px] text-destructive">
              {formatAssistantError(proposal.error, { debug, fallback: ASSISTANT_ACTION_INCOMPLETE })}
            </div>
          ) : null}

          {review && proposal.targetKind !== 'segment_note' ? (
            <Button className="mt-2 h-auto min-h-7 w-full min-w-0 whitespace-normal px-2 py-1" size="sm" variant="outline" disabled={!review.items[proposal.id]}
              onClick={() => review.open(proposal.id)}>在笔记中查看修改</Button>
          ) : <NoteProposalPreview proposal={proposal} />}

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

          {decisionError[proposal.id] ? <p role="alert" className="mt-1 text-destructive">{formatAssistantError(decisionError[proposal.id], { debug, fallback: ASSISTANT_ACTION_INCOMPLETE })}</p> : null}
          {proposal.status !== 'applied' && proposal.status !== 'rejected' ? <div className="note-proposal-actions mt-2 flex flex-wrap justify-end gap-1">
            {isProposalConflict(proposal) ? (
              <Button
                size="xs"
                type="button"
                variant="outline"
                onClick={() => onRegenerate?.(proposal)}
              >
                重新生成
              </Button>
            ) : null}
            <Button
              disabled={!onReject || decisionDisabled(proposal)}
              size="xs"
              type="button"
              variant="ghost"
              onClick={() => void decide(proposal, 'reject')}
            >
              <X size={12} aria-hidden="true" />
              忽略
            </Button>
            <Button
              disabled={!onApply || decisionDisabled(proposal)}
              size="xs"
              type="button"
              onClick={() => void decide(proposal, 'apply')}
            >
              {proposal.status === 'applying' ? (
                <Loader2 size={12} aria-hidden="true" />
              ) : (
                <Check size={12} aria-hidden="true" />
              )}
              确认
            </Button>
          </div> : null}
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
  const debug = useAssistantDebug();
  const result = useMemo(() => {
    try { return { preview: buildNoteProposalPreview(proposal), error: null }; }
    catch (error) { return { preview: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [proposal]);
  if (!result.preview) return <p role="alert" className="mt-2 text-sm text-destructive">{formatAssistantError(result.error, { debug, fallback: '无法预览修改，请重新生成提案。' })}</p>;
  const preview = result.preview;
  if (preview.kind === 'change') {
    return (
      <div className="mt-2 rounded-sm border bg-background p-1.5">
        <DiffPane label={preview.label} text={preview.text} tone={preview.tone} entryId={proposal.entryId} />
      </div>
    );
  }
  if (preview.kind === 'diff') {
    return (
      <NoteProposalDiff
        entryId={proposal.entryId}
        afterMarkdown={preview.after}
        beforeMarkdown={preview.before}
      />
    );
  }

  return (
    <div className="mt-2 min-w-0 rounded-sm border bg-background">
      <NoteRenderedContent text={preview.text} entryId={proposal.entryId} />
    </div>
  );
}

function NoteProposalDiff({
  entryId,
  afterMarkdown,
  beforeMarkdown
}: {
  entryId: string;
  afterMarkdown: string;
  beforeMarkdown: string;
}) {
  return (
    <div className="mt-2 grid gap-1.5 rounded-sm border bg-background p-1.5">
      {buildRenderedNoteDiff(beforeMarkdown, afterMarkdown).map((block, index) => block.kind === 'change'
        ? <NoteDiffLines key={index} block={block} entryId={entryId} /> : null)}
    </div>
  );
}

function DiffPane({
  entryId,
  label,
  text,
  tone
}: {
  entryId: string;
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
        {label === 'Added' ? '+ 新增内容' : label === 'Removed' ? '− 删除内容' : label}
      </div>
      <NoteRenderedContent text={text} entryId={entryId} />
    </div>
  );
}

function NoteProposalStatus({ proposal }: { proposal: AssistantNoteProposal }) {
  const debug = useAssistantDebug();
  if (proposal.status === 'applying') {
    return <Loader2 className="shrink-0 text-muted-foreground" size={13} />;
  }
  if (proposal.status === 'applied') {
    return <span className="shrink-0 text-[11px] text-success">已应用</span>;
  }
  if (proposal.status === 'rejected') {
    return <span className="shrink-0 text-[11px] text-muted-foreground">已忽略</span>;
  }
  if (proposal.status === 'error') {
    return (
      <span className="shrink-0 text-[11px] text-destructive" title={formatAssistantError(proposal.error, { debug, fallback: ASSISTANT_ACTION_INCOMPLETE })}>
        失败
      </span>
    );
  }
  return <span className="shrink-0 text-[11px] text-muted-foreground">待确认</span>;
}

function noteProposalActionLabel(proposal: AssistantNoteProposal) {
  if (proposal.targetKind === 'segment_note') {
    if (proposal.action === 'prepend') {
      return '前置追加到片段笔记';
    }
    return proposal.action === 'replace' ? '替换片段笔记' : '追加到片段笔记';
  }
  if (proposal.action === 'create') {
    return '+ 新建笔记';
  }
  if (proposal.action === 'append') {
    return '+ 末尾新增';
  }
  if (proposal.action === 'prepend') {
    return '+ 开头新增';
  }
  if (proposal.action === 'patch') {
    return '± 修改内容';
  }
  if (proposal.action === 'delete') return '− 删除内容';
  return '± 替换内容';
}

function ToolTrace({ events, errorNotice }: { events: AssistantToolTraceEvent[]; errorNotice: string }) {
  const debug = useAssistantDebug();
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
          {event.status === 'error' || event.error || event.summary ? (
            <div className="mt-0.5 min-w-0 break-words">
              {event.status === 'error' || event.error
                ? formatAssistantError(event.error ?? event.summary, { debug, fallback: errorNotice })
                : formatAssistantToolSummary(event.summary, debug)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ToolTraceIcon({ event }: { event: AssistantToolTraceEvent }) {
  if (event.status === 'running') {
    return <Loader2 className="shrink-0 animate-spin" size={12} aria-hidden="true" />;
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
  if (toolName === 'read_pdf_pages') return '读取 PDF 文字';
  if (toolName === 'search_pdf_text') return '搜索 PDF 文字';
  if (toolName === 'agent.route') {
    return '自动分流';
  }
  if (toolName === 'agent.observe') {
    return '读取当前界面';
  }
  if (toolName === 'agent.hydrate') {
    return '装载上下文';
  }
  if (toolName === 'agent.orchestrate') {
    return '理解并规划任务';
  }
  if (toolName === 'agent.loop') {
    return '执行 Agent 任务';
  }
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
    return '进行中';
  }
  if (status === 'error') {
    return '失败';
  }
  return '完成';
}

export const MarkdownMessageContent = memo(function MarkdownMessageContent({
  content,
  onOpenSource,
  sources,
  streaming
}: {
  content: string;
  onOpenSource: (source: ConversationSourceLink) => void;
  sources: ConversationSourceLink[];
  streaming: boolean;
}) {
  const markdown = normalizeMathDelimiters(content);
  const renderPre = useMemo<NonNullable<Components['pre']>>(() => ({ children, node }) => {
    const code = node?.children[0];
    if (code?.type === 'element' && code.tagName === 'code'
      && Array.isArray(code.properties.className)
      && code.properties.className.includes('language-mermaid')) {
      const text = code.children.map(child => child.type === 'text' ? child.value : '').join('').replace(/\n$/, '');
      return <AssistantDiagramBlock code={text} streaming={streaming} />;
    }
    return <pre>{children}</pre>;
  }, [streaming]);

  return (
    <div
      aria-busy={streaming || undefined}
      aria-live={streaming ? 'polite' : undefined}
      className="assistant-message-content assistant-markdown"
      data-streaming={streaming ? 'true' : undefined}
    >
      <ReactMarkdown
        components={{
          a: ({ children, href }) => {
            const citation = citationFromHref(href);
            const source = citation == null ? undefined : sources[citation.marker - 1];
            if (citation != null) {
              return source ? (
                <InlineSourceCitation
                  marker={citation.marker}
                  onOpenSource={onOpenSource}
                  source={source}
                />
              ) : (
                <span className="text-muted-foreground">[S{citation.marker}]</span>
              );
            }
            return (
              <WorkspaceWebLink href={href}>
                {children}
              </WorkspaceWebLink>
            );
          },
          code: ({ children, className }) => (
            <code className={className}>{children}</code>
          ),
          pre: renderPre
        }}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        remarkPlugins={[remarkGfm, remarkMath, remarkSourceCitations]}
      >
        {markdown || ' '}
      </ReactMarkdown>
    </div>
  );
});

function InlineSourceCitation({
  marker,
  onOpenSource,
  source
}: {
  marker: number;
  onOpenSource: (source: ConversationSourceLink) => void;
  source: ConversationSourceLink;
}) {
  const title = isSciverseConversationSource(source) ? source.title : source.entry_title;
  return (
    <InlineCitationButton
      marker={marker}
      source={source}
      title={title}
      onClick={() => onOpenSource(source)}
    />
  );
}

function InlineCitationButton({
  marker,
  onClick,
  source,
  title
}: {
  marker: number;
  onClick: () => void;
  source: ConversationSourceLink;
  title: string;
}) {
  return (
    <button
      aria-label={`来源 S${marker}：${title}，${sourceLocationLabel(source)}`}
      className="mx-0.5 inline-flex min-h-5 translate-y-[-1px] items-center rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[0.72em] font-medium leading-[1.35] text-primary hover:bg-primary/10"
      type="button"
      onClick={onClick}
    >
      S{marker}
    </button>
  );
}

type MarkdownAstNode = {
  children?: MarkdownAstNode[];
  type?: string;
  url?: string;
  value?: string;
};

function remarkSourceCitations() {
  return (tree: MarkdownAstNode) => transformCitationTextNodes(tree, { current: 0 });
}

function transformCitationTextNodes(
  node: MarkdownAstNode,
  occurrence: { current: number }
) {
  if (
    !node.children ||
    node.type === 'link' ||
    node.type === 'linkReference' ||
    node.type === 'code' ||
    node.type === 'inlineCode'
  ) {
    return;
  }

  const transformed: MarkdownAstNode[] = [];
  for (const child of node.children) {
    if (child.type !== 'text' || !child.value) {
      transformCitationTextNodes(child, occurrence);
      transformed.push(child);
      continue;
    }

    const expression = /\[S([1-9]\d*)\]/g;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(child.value)) !== null) {
      if (match.index > cursor) {
        transformed.push({ type: 'text', value: child.value.slice(cursor, match.index) });
      }
      const marker = Number(match[1]);
      occurrence.current += 1;
      transformed.push({
        children: [{ type: 'text', value: `S${marker}` }],
        type: 'link',
        url: `#neuink-source-S${marker}-O${occurrence.current}`
      });
      cursor = expression.lastIndex;
    }
    if (cursor < child.value.length) {
      transformed.push({ type: 'text', value: child.value.slice(cursor) });
    }
  }
  node.children = transformed;
}

function citationFromHref(href?: string) {
  const match = href?.match(/^#neuink-source-S(\d+)-O(\d+)$/);
  if (!match) return null;
  const marker = Number(match[1]);
  const occurrence = Number(match[2]);
  if (
    !Number.isSafeInteger(marker) ||
    marker <= 0 ||
    !Number.isSafeInteger(occurrence) ||
    occurrence <= 0
  ) {
    return null;
  }
  return {
    key: `S${marker}-O${occurrence}`,
    marker
  };
}

function normalizeMathDelimiters(markdown: string) {
  return markdown
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, latex: string) => `\n$$${latex.trim()}$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, latex: string) => `$${latex.trim()}$`);
}
