import type { AssistantContextSnapshot } from '@/shared/ipc/assistantApi';
import type {
  AgentInvocationPlan,
  AssistantActiveSegment,
  AssistantActiveSurfaceSnapshot,
  AssistantContextPlan,
  AssistantTaskPlan
} from '@/shared/types/assistant';
import type { AgentRuntimeSettings, AgentToolId } from '@/shared/types/agentRuntime';

type CompileExecutionContractOptions = {
  activeSegment?: AssistantActiveSegment | null;
  activeSurface?: AssistantActiveSurfaceSnapshot | null;
  contextPlan?: AssistantContextPlan | null;
  question: string;
  snapshot: AssistantContextSnapshot;
};

export type AssistantExecutionContract = {
  failurePolicy: NonNullable<AgentInvocationPlan['failurePolicy']>;
  plan: AssistantTaskPlan;
  requiredToolIds: AgentToolId[];
  sourcePolicy: NonNullable<AgentInvocationPlan['sourcePolicy']>;
};

const CURRENT_DOCUMENT_RE = /(?:当前|这篇|本篇|正在看的|正在阅读的).{0,8}(?:论文|文章|文档|pdf)|(?:current|this)\s+(?:paper|article|document)/iu;
const SUMMARY_RE = /讲了什么|主要内容|总结|概括|摘要|核心观点|研究了什么|summari[sz]e|summary|what\s+is\s+.*about/iu;
const NOTE_EDIT_RE = /(?:笔记|markdown|note).{0,20}(?:追加|添加|插入|修改|编辑|润色|改写|更新|删除|移除|替换)|(?:追加|添加|插入|修改|编辑|润色|改写|更新|删除|移除|替换).{0,20}(?:笔记|markdown|note)|(?:append|edit|update|delete|remove|replace).{0,16}(?:note|markdown)/iu;
const SEGMENT_NOTE_RE = /片段笔记|段落笔记|segment\s+note/iu;
const SCIVERSE_RE = /sciverse/iu;
const EXTERNAL_RESEARCH_RE = /外部(?:论文|文献|资料|研究)|文献(?:检索|搜索|证据|调研)|学术(?:检索|搜索)|研究(?:证据|进展|现状)|查找.{0,8}(?:论文|文献)|(?:literature|academic|paper)\s+(?:search|review)|find\s+(?:papers|literature)/iu;
const IMPLICIT_SCHOLARLY_RE = /准确性|主要局限|已知局限|研究进展|研究现状|实证证据|实验结果|临床证据|性能表现|科研影响|state\s+of\s+the\s+art|known\s+limitations?|empirical\s+evidence/iu;
const WORKSPACE_SEARCH_RE = /(?:工作区|本地|我的(?:资料|论文|文献|文库)).{0,12}(?:搜索|检索|查找|寻找)|(?:搜索|检索|查找|寻找).{0,12}(?:工作区|本地|我的(?:资料|论文|文献|文库))/iu;
const DEEP_READ_RE = /原文|全文|上下文|命中位置|深入阅读|详细阅读|read.{0,8}(?:content|context|paper)/iu;
const PAPER_GROUNDED_RE = /论文|文章|文档|pdf|paper|article|document/iu;

export function referencesCurrentDocument(question: string) {
  return CURRENT_DOCUMENT_RE.test(question);
}

export function compileAssistantExecutionContract({
  activeSegment = null,
  activeSurface = null,
  contextPlan,
  question,
  snapshot
}: CompileExecutionContractOptions): AssistantExecutionContract {
  const activeEntryId = snapshot.active_entry?.entry_id;
  const activeNote = snapshot.active_note;
  const base = basePlan(question, contextPlan, activeEntryId);

  if (NOTE_EDIT_RE.test(question)) {
    const segmentEdit = SEGMENT_NOTE_RE.test(question);
    const targetSegment = activeSegment ?? snapshot.pinned_segments[0] ?? null;
    const noteAction = inferNoteAction(question);
    const missing = segmentEdit
      ? targetSegment ? [] : ['target_segment' as const]
      : activeNote ? [] : ['active_note' as const];
    const requiredToolIds: AgentToolId[] = segmentEdit
      ? ['read_segment_content', 'segment_note.propose_patch']
      : ['read_current_note', 'note.propose_patch'];
    return {
      failurePolicy: 'stop',
      requiredToolIds,
      sourcePolicy: 'active_context_only',
      plan: {
        ...base,
        capabilities: segmentEdit
          ? ['read_document', 'read_note', 'propose_note']
          : ['read_note', 'propose_note'],
        confidence: missing.length ? 0.45 : 0.97,
        deliverables: [segmentEdit ? 'segment_note_proposal' : 'note_patch_proposal'],
        editCoordinatePolicy: !segmentEdit && (noteAction === 'patch' || noteAction === 'delete')
          ? 'line_and_hash'
          : undefined,
        evidencePolicy: PAPER_GROUNDED_RE.test(question) ? 'required' : 'none',
        intent: segmentEdit ? 'segment_note_update' : 'note_update',
        missing,
        needsCurrentNote: !segmentEdit,
        needsDocumentContext: PAPER_GROUNDED_RE.test(question),
        needsNoteProposal: true,
        noteAction,
        requiredToolIds,
        target: segmentEdit
          ? {
              entryId: activeSegment?.entryId ?? activeEntryId,
              kind: 'segment_note',
              segmentUid: activeSegment?.segmentUid ?? snapshot.pinned_segments[0]?.segment_uid
            }
          : {
              entryId: activeNote?.entry_id ?? activeEntryId,
              kind: 'markdown_note',
              noteId: activeNote?.note_id
            },
        clarificationQuestion: missing.length
          ? segmentEdit
            ? '请先在 PDF 中选中要修改的片段。'
            : '请先聚焦或用 @ 指定要修改的 Markdown 笔记。'
          : undefined,
        rationale: 'The request changes a concrete note. Read the frozen target first, then create a reviewable line-precise proposal.',
        steps: [
          { dependsOn: [], id: 'read-target', kind: 'read_context' },
          { dependsOn: ['read-target'], id: 'draft-patch', kind: 'draft_note' }
        ]
      }
    };
  }

  if (
    SCIVERSE_RE.test(question) ||
    (!referencesCurrentDocument(question) && (
      EXTERNAL_RESEARCH_RE.test(question) ||
      IMPLICIT_SCHOLARLY_RE.test(question)
    ))
  ) {
    const requiredToolIds: AgentToolId[] = [
      'search_sciverse_evidence',
      ...(DEEP_READ_RE.test(question) ? ['read_sciverse_content' as const] : [])
    ];
    return {
      failurePolicy: 'stop',
      requiredToolIds,
      sourcePolicy: 'sciverse_only',
      plan: {
        ...base,
        capabilities: ['search_evidence', 'synthesize'],
        citationPolicy: 'required',
        confidence: 0.96,
        evidencePolicy: 'required',
        intent: 'paper_search',
        needsSegmentSearch: false,
        requiredToolIds,
        rationale: 'The request asks for external scholarly evidence. Sciverse is the required source and local fallback is forbidden.',
        steps: [
          { dependsOn: [], id: 'search-sciverse', kind: 'search' },
          ...(DEEP_READ_RE.test(question)
            ? [{ dependsOn: ['search-sciverse'], id: 'read-sciverse', kind: 'read_context' as const }]
            : []),
          { dependsOn: DEEP_READ_RE.test(question) ? ['read-sciverse'] : ['search-sciverse'], id: 'answer', kind: 'synthesize_answer' }
        ]
      }
    };
  }

  if (WORKSPACE_SEARCH_RE.test(question)) {
    const requiredToolIds: AgentToolId[] = ['search_segments'];
    return {
      failurePolicy: 'stop',
      requiredToolIds,
      sourcePolicy: 'workspace_only',
      plan: {
        ...base,
        capabilities: ['search_evidence', 'synthesize'],
        citationPolicy: 'required',
        confidence: 0.95,
        evidencePolicy: 'required',
        intent: 'paper_search',
        needsSegmentSearch: true,
        requiredToolIds,
        rationale: 'The request explicitly targets the local Neuink workspace.',
        steps: [
          { dependsOn: [], id: 'search-workspace', kind: 'search' },
          { dependsOn: ['search-workspace'], id: 'answer', kind: 'synthesize_answer' }
        ]
      }
    };
  }

  if (referencesCurrentDocument(question)) {
    const missing = activeEntryId ? [] : ['active_entry' as const];
    const requiredToolIds: AgentToolId[] = ['read_entry_assistant_context'];
    return {
      failurePolicy: 'stop',
      requiredToolIds,
      sourcePolicy: 'active_context_only',
      plan: {
        ...base,
        capabilities: ['read_document', 'synthesize'],
        citationPolicy: 'required',
        clarificationQuestion: missing.length
          ? '当前没有聚焦论文标签页。请先打开并聚焦要询问的 PDF 或论文条目。'
          : undefined,
        confidence: missing.length ? 0.4 : 0.99,
        evidencePolicy: 'required',
        intent: SUMMARY_RE.test(question) ? 'paper_summary' : 'paper_qa',
        missing,
        needsDocumentContext: true,
        requiredToolIds,
        target: { entryId: activeEntryId, kind: 'chat_only' },
        rationale: `The phrase "current paper" is bound to the frozen focused tab${activeSurface ? ` ${activeSurface.surfaceKey}` : ''}.`,
        steps: [
          { dependsOn: [], id: 'read-current-paper', kind: 'read_context' },
          { dependsOn: ['read-current-paper'], id: 'answer', kind: 'synthesize_answer' }
        ]
      }
    };
  }

  return {
    failurePolicy: 'allow_general_fallback',
    requiredToolIds: [],
    sourcePolicy: 'none',
    plan: base
  };
}

export function buildInvocationPlanForContract(
  contract: AssistantExecutionContract,
  runtimeSettings: AgentRuntimeSettings,
  preferredAgentId?: string | null
): AgentInvocationPlan {
  const enabledToolIds = toolsForContract(contract, runtimeSettings.mainAssistant.enabledToolIds);
  const configured = new Set(runtimeSettings.mainAssistant.enabledToolIds);
  const missing = contract.requiredToolIds.filter((toolId) => !configured.has(toolId));
  return {
    enabledToolIds,
    failurePolicy: contract.failurePolicy,
    mainAssistantId: preferredAgentId ?? runtimeSettings.mainAssistant.id,
    missing,
    mode: 'agent_execute',
    noteEditMode: contract.plan.noteAction && contract.plan.noteAction !== 'create'
      ? contract.plan.noteAction
      : undefined,
    rationale: contract.plan.rationale,
    requiredToolIds: contract.requiredToolIds,
    skillIdsToLoad: [],
    sourcePolicy: contract.sourcePolicy,
    subagentTasks: [],
    writePolicy: contract.plan.needsNoteProposal ? 'proposal_only' : 'chat_only'
  };
}

function basePlan(
  question: string,
  contextPlan: AssistantContextPlan | null | undefined,
  activeEntryId?: string
): AssistantTaskPlan {
  return {
    attachments: contextPlan?.items ?? [],
    capabilities: ['synthesize'],
    citationPolicy: 'none',
    confidence: 0.9,
    deliverables: ['chat_answer'],
    evidencePolicy: 'none',
    intent: 'general_qa',
    missing: [],
    needsCurrentNote: false,
    needsDocumentContext: false,
    needsNoteProposal: false,
    needsSegmentSearch: false,
    rationale: 'No workspace-specific execution contract was inferred; answer as a general question without claiming workspace evidence.',
    request: question,
    target: { entryId: activeEntryId, kind: 'chat_only' },
    steps: [{ dependsOn: [], id: 'answer', kind: 'synthesize_answer' }]
  };
}

function inferNoteAction(question: string): NonNullable<AssistantTaskPlan['noteAction']> {
  if (/删除|移除|删掉|delete|remove/iu.test(question)) return 'delete';
  if (/开头|最前|prepend/iu.test(question)) return 'prepend';
  if (/整篇|全部.{0,4}替换|完全重写|replace\s+(?:all|entire)/iu.test(question)) return 'replace';
  if (/追加|末尾|append/iu.test(question)) return 'append';
  return 'patch';
}

function toolsForContract(contract: AssistantExecutionContract, configuredIds: AgentToolId[]) {
  const configured = new Set(configuredIds);
  const supporting = new Set<AgentToolId>(contract.requiredToolIds);
  if (contract.sourcePolicy === 'active_context_only') {
    supporting.add('read_entry_assistant_context');
    supporting.add('read_segment_content');
    supporting.add('read_current_note');
    supporting.add('read_note');
  } else if (contract.sourcePolicy === 'workspace_only') {
    supporting.add('search_segments');
    supporting.add('read_segment_content');
    supporting.add('read_entry_assistant_context');
  } else if (contract.sourcePolicy === 'sciverse_only') {
    supporting.add('search_sciverse_evidence');
    supporting.add('read_sciverse_content');
  } else {
    for (const toolId of configuredIds) {
      if (!isWriteTool(toolId)) supporting.add(toolId);
    }
  }
  return [...supporting].filter((toolId) => configured.has(toolId));
}

function isWriteTool(toolId: AgentToolId) {
  return toolId === 'create_entry' || toolId.includes('propose_') || toolId.includes('.propose');
}
