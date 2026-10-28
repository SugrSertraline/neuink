import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import { getAssistantContextSnapshot, loadAgentRuntimeSettings } from '@/shared/ipc/assistantApi';
import { runLocalAgent } from '@/shared/ipc/localAgentApi';
import { RESEARCH_READ_TOOLS } from '@/shared/ipc/researchApi';
import { normalizeAgentRuntimeSettings, readAgentRuntimeSettings } from '@/shared/lib/agentRuntimeSettings';
import { describeAssistantReadFailure } from '@/shared/lib/assistantReadFailure';
import { readLocalAgentEnabled } from '@/shared/lib/localAgentSettings';
import type {
  AssistantEntryMetaProposal,
  AssistantNoteProposal,
  AssistantTagProposal
} from '@/shared/types/assistant';
import { asSchema } from 'ai';
import {
  AgentPersistenceError,
  AgentStoppedError,
  AgentToolNotExecutedError,
  RunBudget
} from '../agent-core/agent';
import { createAgentToolFailure, isAgentToolFailure } from '../agent-core/toolFailure';
import { observeAssistantContext } from '../harness/context';
import { runDurableHarness } from '../harness/durableHarness';
import type { RunAssistantHarnessOptions } from '../harness/engine';
import { modelDrivenBrief, verifyGroundedProposals } from '../harness/engine';
import { createAgentRun, finishAgentRun } from '../harness/runState';
import { AssistantVerificationError, verifyHarnessResult } from '../harness/verification';
import {
  PAPER_PRESENTATION_INSTRUCTIONS,
  paperRecords,
  presentedPaperRecords
} from '../research/paperPresentation';
import { bindExecutionIdentity } from '../runtime/durableExecution';
import { buildDirectExecution, executionModeInstructions } from '../runtime/executionPolicy';
import { SourceLedger } from '../runtime/sourceLedger';
import { createCompiledTaskState, transitionTaskState } from '../runtime/taskState';
import { finalizeVerifiedProposals } from '../runtime/verifiedProposal';
import { agentExecutors } from '../sdk/agentDriver';
import { answerVerification } from '../sdk/answerVerification';
import {
  matchedExternalCitationUrls,
  normalizeReturnedExternalCitationLinks,
  returnedExternalCitationUrls
} from '../sdk/citationContract';
import { parsedEntryReadingNotice } from '../sdk/entryContext';
import type { GroundedAnswer } from '../sdk/qna';
import {
  buildPinnedContext,
  buildSelectedMarkdownContext,
  buildToolNotes,
  normalizeCitedSources,
  uniqueConversationSources
} from '../sdk/qna';
import { researchFailureMessage } from '../sdk/researchRecovery';
import { TOOL_FAILURE_INSTRUCTIONS } from '../sdk/toolFailurePolicy';
import { createAssistantTools, type ToolRuntimeState } from '../sdk/tools';
import { noteSnapshotKey } from '../sdk/toolValues';
import { createUserInputTool, USER_INPUT_INSTRUCTIONS } from '../sdk/userInputTool';
import { approveClaudeTool } from './approvals';
import { LocalAgentCheckpoint } from './checkpoint';
import { ClaudeStream, protocolObject } from './protocol';
import { RpcAgentStream, type AgentStreamCallbacks } from './rpcProtocol';
import type { LocalAgentSession } from './session';
import { localAgentWebContext } from './webContext';

export async function runLocalAgentHarness(inputOptions: RunAssistantHarnessOptions, session: LocalAgentSession,
  onSession: (session: LocalAgentSession) => void): Promise<GroundedAnswer> {
  if (!readLocalAgentEnabled()) throw new Error('本地 Agent 已关闭，请在设置 → 检索与工具中启用。');
  inputOptions.abortSignal?.throwIfAborted();
  const result = await runDurableHarness(inputOptions, options => executeLocalAgent(options, session, onSession));
  if (result.localAgentSession) onSession(result.localAgentSession);
  return result;
}

async function executeLocalAgent(inputOptions: RunAssistantHarnessOptions, session: LocalAgentSession,
  onSession: (session: LocalAgentSession) => void): Promise<GroundedAnswer> {
  const lifetime = new AbortController();
  const options = {...inputOptions,abortSignal:AbortSignal.any([lifetime.signal,...(inputOptions.abortSignal ? [inputOptions.abortSignal] : [])])};
  try {
    if (!readLocalAgentEnabled()) throw new Error('本地 Agent 已关闭，请在设置 → 检索与工具中启用。');
    options.abortSignal?.throwIfAborted();
    if (!options.conversationId) throw new Error('请先创建对话。');
    const runId = crypto.randomUUID();
    const execution = options.execution;
    const budget = options.budget ?? new RunBudget();
    const savedSession = execution?.get<LocalAgentSession>('local:session');
    if (savedSession && savedSession.provider !== session.provider) throw new Error('请切换回原任务使用的本地 Agent 后继续。');
    session = savedSession ?? session;
    onSession(session);
    const proposals = execution?.get<AssistantNoteProposal[]>('noteProposals') ?? [];
    const entryMetaProposals = execution?.get<AssistantEntryMetaProposal[]>('entryMetaProposals') ?? [];
    const tagProposals = execution?.get<AssistantTagProposal[]>('tagProposals') ?? [];
    const events = execution?.get<AssistantToolTraceEvent[]>('local:events') ?? [];
    const emit = (event: AssistantToolTraceEvent) => {
      if (options.abortSignal?.aborted) return;
      const index = events.findIndex(current => current.id === event.id);
      if (index < 0) events.push(event); else events[index] = {...events[index], ...event};
      options.onToolEvent?.(event);
    };
    const observed = observeAssistantContext({ assistantContext:options.assistantContext, contextPlan:options.contextPlan,
      activeSegment:options.currentSegment, activeSurface:options.currentSurface,
      fallbackEntryId:options.currentEntry?.id, fallbackNote:options.currentNote });
    const snapshot = execution?.get<Awaited<ReturnType<typeof getAssistantContextSnapshot>>>('contextSnapshot') ?? await getAssistantContextSnapshot({ root:options.root, activeEntryId:observed.activeEntryId,
      activeNote:observed.activeNote, pinnedSegments:observed.pinnedSegments, documentCharBudget:32_000, noteCharBudget:36_000 });
    options.abortSignal?.throwIfAborted();
    const runtimeSettings = await (async () => {
      try { return normalizeAgentRuntimeSettings(await loadAgentRuntimeSettings(options.root) ?? readAgentRuntimeSettings()); }
      catch { throw new Error('无法读取资料库的 Agent 权限配置，任务已停止。请检查资料库后重试，系统不会改用默认权限执行。'); }
    })();
    execution?.set('contextSnapshot', snapshot);
    const { plan, invocationPlan } = buildDirectExecution(runtimeSettings, options.question, options.composerSnapshot?.executionMode ?? 'act');
    invocationPlan.enabledToolIds = invocationPlan.enabledToolIds.filter(id => id !== 'task.run_subagent');
    const main = { ...runtimeSettings.mainAssistant, enabledToolIds:runtimeSettings.mainAssistant.enabledToolIds.filter(id => id !== 'task.run_subagent') };
    const pinned = buildPinnedContext(options.assistantContext?.items ?? [], 1);
    const frozenSelected = execution?.get<string>('local:selectedNotes');
    const selected = frozenSelected !== undefined ? {text:frozenSelected, sourceByMarker:new Map()} :
      await buildSelectedMarkdownContext({ root:options.root, assistantContext:options.assistantContext, markerStart:pinned.nextMarker });
    execution?.set('local:selectedNotes', selected.text);
    const ledger = new SourceLedger(new Map(execution?.get<Array<[number, import('@/shared/ipc/assistantApi').ConversationSourceLink]>>('sources') ?? [...pinned.sourceByMarker, ...selected.sourceByMarker]));
    const pinnedSnapshot = snapshot.pinned_segments.map(segment => {
      const marker = ledger.add({entry_id:segment.entry_id, entry_title:segment.entry_title,
        page_idx:segment.page_idx, segment_uid:segment.segment_uid, quote:segment.text});
      return `[S${marker}] ${segment.entry_title}, p.${segment.page_idx + 1}\n${segment.text}`;
    }).join('\n\n');
    const browserTabTarget = options.currentSurface?.kind === 'browser' ? options.currentSurface.browserTab : null;
    const restoredState = execution?.get<ToolRuntimeState>('tools:local');
    const runtime = await createAssistantTools({ execution, budget, plan,
      restoredState: restoredState && { ...restoredState, readNotes: [] }, root:options.root, scope:options.scope, abortSignal:options.abortSignal,
      activeExecution:{agent:main}, runtimeSettings, currentEntry:options.currentEntry, currentNote:options.currentNote,
      contextSnapshot:snapshot, assistantContext:options.assistantContext, availableEntries:options.availableEntries,
      browserTabTarget,
      conversationHistory:options.conversationHistory, sourceLedger:ledger, profiles:options.profiles,
      applicationActions:options.applicationActions, onCreateEntry:options.onCreateEntry,
      onNoteProposal:proposal => proposals.push(proposal), onToolEvent:emit,
      onEntryMetaProposal:proposal => entryMetaProposals.push(proposal),
      onTagProposal:proposal => tagProposals.push(proposal), invocationPlan });
    if (options.requestUserInput) runtime.tools.ask_user = createUserInputTool(options.requestUserInput,
      () => [...ledger.sources.values()], emit);
    const checkpoint = new LocalAgentCheckpoint(execution, budget, () => {
      execution?.set('local:session', session);
      execution?.set('local:events', events);
      execution?.set('noteProposals', proposals);
      execution?.set('entryMetaProposals', entryMetaProposals);
      execution?.set('tagProposals', tagProposals);
      execution?.set('tools:local', runtime.snapshot());
      execution?.set('sources', [...ledger.sources]);
    });
    await bindExecutionIdentity(execution, 'local', { provider: session.provider, agent: main,
      tools: runtime.identityToolNames, mode: plan.executionMode });
    await checkpoint.save();
    const executors = agentExecutors(runtime.tools, options.requestToolApproval);
    const tools = await Promise.all(Object.entries(runtime.tools).map(async ([name, definition]) => ({ name,
      description:definition.description ?? name, inputSchema:await asSchema(definition.inputSchema).jsonSchema })));
    tools.push({name:'approve_tool', description:'Host permission callback. Do not call this tool directly.', inputSchema:{type:'object', properties:{tool_name:{type:'string'}, input:{type:'object'}}, required:['tool_name','input']} });
    const callbacks:AgentStreamCallbacks = { text:delta => options.onDelta?.(delta), reset:() => options.onAnswerReset?.(),
      reasoning:delta => options.onReasoningDelta?.(delta), tool:emit,
      initialized:sessionId => {
        session = {...session, ...(sessionId ? {sessionId} : {}), initialized:true}; onSession(session);
        void checkpoint.save().catch(error => lifetime.abort(error));
      } };
    const stream = session.provider === 'claude' ? new ClaudeStream(callbacks) : new RpcAgentStream(session.provider,callbacks);
    for (const observation of runtime.observations) stream.pdfReading.observe(observation.output);
    const web = localAgentWebContext(runtime.toolNames, browserTabTarget);
    options.abortSignal?.throwIfAborted();
    let answer = '';
    let correction = execution?.get<string>('local:correction') ?? '';
    let correctionCount = execution?.get<number>('local:correctionCount') ?? 0;
    for (;;) {
      budget.turn();
      await checkpoint.save();
      const result = await runLocalAgent({ runId: crypto.randomUUID(), root:options.root, conversationId:options.conversationId, sessionId:session.sessionId,
        provider:session.provider, resume:session.initialized, tools,
        prompt: JSON.stringify({ request:options.question, correction,
          harnessBrief:modelDrivenBrief({ composerSnapshot:options.composerSnapshot, contextPlan:options.contextPlan,
            currentSurface:options.currentSurface, history:options.conversationHistory ?? [],
            mentionScope:options.mentionScope ?? options.scope, tagMentionScopes:options.tagMentionScopes }),
          recovery:options.resumeExecutionId ? { observations:runtime.observations,
            sources:[...ledger.sources].map(([marker,source]) => ({marker:`S${marker}`,source})),
            proposals:[...proposals,...entryMetaProposals,...tagProposals].map(p => ({id:p.id,status:p.status})),
            writesBlocked:budget.writesBlocked,
            instruction:'Continue the frozen request using the saved observations. Completed operations and proposals already exist; do not repeat them. Freshly read a note before any new edit. If writesBlocked, only inspect and explain the uncertain outcome.' } : undefined,
          capabilities:web.capabilities,
          context:{currentSurface:options.currentSurface ? {
            kind:options.currentSurface.kind, pane:options.currentSurface.pane,
            entryId:options.currentSurface.entryId, noteId:options.currentSurface.noteId,
            segmentUid:options.currentSurface.segmentUid
          } : null, browser:web.browser, active_entry:snapshot.active_entry, active_note:snapshot.active_note && {
            entry_id:snapshot.active_note.entry_id, note_id:snapshot.active_note.note_id, note_title:snapshot.active_note.note_title},
            document:snapshot.document && {entry_id:snapshot.document.entry_id, entry_title:snapshot.document.entry_title}, warnings:snapshot.warnings},
          selectedNotes:selected.text.slice(0,36_000), selectedNotesTruncated:selected.text.length > 36_000,
          pinnedEvidence:[pinned.text,pinnedSnapshot].filter(Boolean).join('\n\n').slice(0,32_000),
          targets:{entry:options.currentEntry,note:options.currentNote,mentions:options.composerSnapshot?.mentions,scope:options.scope},
          catalog:{entries:options.availableEntries,notes:options.availableNotes,tags:options.availableTags},
          priorProposalDecisions:(options.conversationHistory ?? []).flatMap(message => (message.note_proposals ?? []).map(p => ({id:p.id,status:p.status}))),
          agentInstructions:main.systemPrompt,
          instructions:[
            'The user can switch reading tabs without starting a new conversation. Preserve prior discussion, but resolve "this paper", "this note" and "the current page" using this request\'s frozen context and targets, not a previous turn or native session memory. The host has already resolved any explicitly pinned reading target. Explicit references to earlier documents and requests to compare them still apply; read their evidence again when needed. Null current targets mean no target is selected: never silently restore the previous one. If the intended target remains ambiguous, ask. A tab change during execution does not retarget this frozen request. Treat historical source markers as historical; only this task\'s retrieved or explicitly recovered markers are valid for new citations.',
            buildToolNotes(runtime.toolNames,plan,{agent:main},invocationPlan),web.instructions,USER_INPUT_INSTRUCTIONS,
            executionModeInstructions(plan.executionMode!),PAPER_PRESENTATION_INSTRUCTIONS,
            TOOL_FAILURE_INSTRUCTIONS,...runtime.availabilityNotes].join('\n\n') }) }, options.abortSignal,
        event => { if (event.type === 'message') stream.consume(event.value); },
        async event => {
          options.abortSignal?.throwIfAborted();
          if (event.name === 'approve_tool') {
            const input = event.input as {tool_name?:unknown; input?:unknown} | null;
            const name = typeof input?.tool_name === 'string' ? input.tool_name.replace(/^(mcp__neuink__|neuink_)/, '') : '';
            // NeuInk's declared tools already validate arguments and request their own
            // approvals. Reads and proposal drafts must not cause a second native prompt.
            // Codex may omit the tool name from an approval elicitation. Rust
            // emits this marker only for this task's NeuInk MCP server.
            const ownMcpApproval = input?.tool_name === 'mcp__neuink__' && session.provider === 'codex';
            const decision = ownMcpApproval || typeof input?.tool_name === 'string' && /^(mcp__neuink__|neuink_)/.test(input.tool_name) && Object.prototype.hasOwnProperty.call(executors,name)
              ? {behavior:'allow',updatedInput:input.input}
              : (plan.executionMode === 'plan' || main.sandbox === 'read-only' || budget.writesBlocked) && name !== 'AskUserQuestion'
                ? {behavior:'deny',message:'当前任务仅允许通过 NeuInk 只读工具核对，不允许原生操作。'}
                : await approveClaudeTool(event.input,event.id,options,session.provider);
            if (decision.behavior === 'allow' && !ownMcpApproval && !Object.prototype.hasOwnProperty.call(executors,name) && name !== 'AskUserQuestion') await checkpoint.approveNative();
            return {content:[{type:'text',text:JSON.stringify(decision)}]};
          }
          const execute = executors[event.name];
          if (!execute) return {isError:true,content:[{type:'text',text:'当前工具不可用。'}]};
          if (event.name === 'note_propose_patch') {
            const input = protocolObject(event.input);
            const entryId = typeof input.entry_id === 'string' ? input.entry_id : options.currentNote?.entryId ?? options.currentEntry?.id;
            const noteId = typeof input.note_id === 'string' ? input.note_id : options.currentNote?.noteId;
            if (!entryId || !noteId || !runtime.snapshot().readNotes.some(([key]) => key === noteSnapshotKey(entryId,noteId))) {
              return {isError:true,content:[{type:'text',text:'本轮修改前必须先成功调用 read_note 或 read_current_note 读取目标笔记，再提交修改提案。'}]};
            }
          }
          try {
            const output = await checkpoint.run(event.name, event.input, {id:event.id, signal:options.abortSignal}, execute);
            options.abortSignal?.throwIfAborted();
            stream.pdfReading.observe(output);
            return {...(isAgentToolFailure(output) ? {isError:true} : {}),content:[{type:'text',text:JSON.stringify(output)}]};
          } catch (error) {
            if (error instanceof AgentPersistenceError || error instanceof AgentStoppedError) { lifetime.abort(error); throw error; }
            options.abortSignal?.throwIfAborted();
            if (RESEARCH_READ_TOOLS.some(name => name === event.name) && !(error instanceof AgentToolNotExecutedError)) {
              const failure = { ...createAgentToolFailure('TOOL_EXECUTION_FAILED'), diagnostic:describeAssistantReadFailure(error) };
              return {isError:true,content:[{type:'text',text:JSON.stringify(failure)},
                {type:'text',text:researchFailureMessage(event.name,failure.diagnostic)}]};
            }
            // Keep safe, host-owned validation guidance, never arbitrary provider diagnostics.
            const message = error instanceof AgentToolNotExecutedError ? error.message : '工具调用失败，请检查目标或使用其他已提供的工具。';
            return {isError:true,content:[{type:'text',text:message}]};
          }
        });
      options.abortSignal?.throwIfAborted();
      await checkpoint.settled();
      session = {...session,initialized:true}; onSession(session);
      await checkpoint.finishNativeTurn();
      answer = normalizeReturnedExternalCitationLinks(
        typeof result.result === 'string' ? result.result : '', returnedExternalCitationUrls(runtime.observations));
      const rejectedNeuInkRead = hasUnrecoveredExternalRead(events, runtime.events,
        observed.activeEntryId, observed.activeNote);
      const rejectedNoteProposal = proposals.length === 0 && events.some(event => event.status === 'error' &&
        /^(?:codex|claude|opencode)\.mcp__neuink__(?:note_propose_create|note_propose_patch|segment_note_propose_patch)$/.test(event.toolName));
      const issue = rejectedNeuInkRead ? {
        message:'NeuInk 正文或笔记读取未完成，请检查工具调用与权限后重试。',
        correction:'The NeuInk read did not yield host-verified evidence for the requested document. Retry the declared NeuInk read tool. If it still fails, do not answer from the title or prior memory; report that the document could not be read.'
      } : rejectedNoteProposal ? {
        message:'笔记提案未创建成功，请检查工具调用与权限后重试。',
        correction:'The attempted NeuInk note proposal was rejected before a reviewable proposal was created. Retry the declared proposal tool only after the required fresh note read. Never say the note was organized or saved without a host-confirmed proposal.'
      } : answerVerification({ answer, question:options.question, plan, sources:ledger.sources,
        events:runtime.events, observations:runtime.observations,
        hasProposals:Boolean(proposals.length || entryMetaProposals.length || tagProposals.length || runtime.snapshot().createdEntries.length),
        availabilityNotes:runtime.availabilityNotes });
      if (!issue) break;
      if (correctionCount++ >= 2) throw new Error(issue.message);
      correction = issue.correction;
      execution?.set('local:correction', correction);
      execution?.set('local:correctionCount', correctionCount);
      await checkpoint.save();
      options.onAnswerReset?.();
    }
    const sources = [...ledger.sources.values()];
    verifyGroundedProposals({ composerSnapshot:options.composerSnapshot, assistantContext:options.assistantContext,
      contextPlan:options.contextPlan, currentSurface:options.currentSurface, history:options.conversationHistory, proposals, sources });
    const cited = normalizeCitedSources(answer, ledger.sources, events);
    const records = paperRecords(runtime.events.flatMap(event => event.status === 'done' ? event.researchPapers ?? [] : []), sources);
    const readingNotice = [parsedEntryReadingNotice(runtime.observations), stream.pdfReading.notice()].filter(Boolean).join('\n');
    const grounded: GroundedAnswer = {...cited, localAgentSession:session, plan, entryMetaProposals, tagProposals, answer:[readingNotice,cited.answer].filter(Boolean).join('\n\n'),
      sources:uniqueConversationSources([...cited.sources,
        ...presentedPaperRecords(answer,records).flatMap(record => record.kind === 'sciverse' ? [record.source] : []),
        ...entryMetaProposals.flatMap(proposal => proposal.sources.map(source => ({ entry_id:source.entryId,
          entry_title:source.entryTitle, page_idx:source.pageIdx, quote:source.quote, segment_uid:source.segmentUid })))]),
      externalCitationUrls:matchedExternalCitationUrls(cited.answer,returnedExternalCitationUrls(runtime.observations),records),
      hadRecoverableFailures:runtime.availabilityNotes.length > 0 || events.some(event => event.status === 'error' && !event.recovered),
      noteProposals:finalizeVerifiedProposals(proposals,execution?.record.id ?? `local-${runId}`), toolEvents:events};
    const verification = verifyHarnessResult({ activeExecution:{agent:main}, grounded, invocationPlan, plan, snapshot });
    if (verification.errors.length) throw new AssistantVerificationError(verification.errors);
    const proposalIds = [...(grounded.noteProposals ?? []),...entryMetaProposals,...tagProposals].map(p => p.id);
    const task = createCompiledTaskState({ conversationId:options.conversationId, request:options.question, spec:plan });
    grounded.taskState = transitionTaskState(task, proposalIds.length ? 'awaiting_approval' : plan.executionMode === 'plan' ? 'awaiting_user' : 'completed', 'verify', proposalIds);
    grounded.agentRun = finishAgentRun(createAgentRun(execution?.record.id ?? `local-${runId}`),'succeeded');
    return grounded;
  } finally {
    // A crashed CLI or a lost IPC channel must release host approval/question
    // waiters too, without marking an ordinary completion as a user stop.
    lifetime.abort(new DOMException('本地 Agent 已结束。','AbortError'));
  }
}

const PAPER_READ_NAMES = new Set(['read_entry_assistant_context', 'read_pdf_pages', 'search_pdf_text',
  'read_segment_content', 'search_segments']);
const NOTE_READ_NAMES = new Set(['read_note', 'read_current_note']);
const EXTERNAL_NEUINK_READ = /^(?:codex|claude|opencode)\.mcp__neuink__(.+)$/;

function hasUnrecoveredExternalRead(events: AssistantToolTraceEvent[], hostEvents: AssistantToolTraceEvent[],
  activeEntryId: string | null, activeNote: {entryId:string;noteId:string} | null) {
  return events.some(failed => {
    if (failed.status !== 'error' || failed.recovered) return false;
    const name = EXTERNAL_NEUINK_READ.exec(failed.toolName)?.[1] ?? '';
    const paper = PAPER_READ_NAMES.has(name);
    if (!paper && !NOTE_READ_NAMES.has(name)) return false;
    const failedInput = protocolObject(failed.input);
    const entryId = typeof failedInput.entry_id === 'string' ? failedInput.entry_id : activeEntryId;
    const noteId = typeof failedInput.note_id === 'string' ? failedInput.note_id : activeNote?.noteId;
    return !hostEvents.some(done => {
      if (done.status !== 'done' || !(paper ? PAPER_READ_NAMES : NOTE_READ_NAMES).has(done.toolName)) return false;
      if (paper) return (done.sources ?? []).some(source =>
        'entry_id' in source && (!entryId || source.entry_id === entryId));
      const readInput = protocolObject(done.input);
      const readEntryId = typeof readInput.entry_id === 'string' ? readInput.entry_id : activeNote?.entryId;
      const readNoteId = typeof readInput.note_id === 'string' ? readInput.note_id : activeNote?.noteId;
      return (!entryId || readEntryId === entryId) && (!noteId || readNoteId === noteId);
    });
  });
}
