import {
  type SciverseAgenticSearchResponse,
  type SciverseContentResponse,
  type SciverseJsonResponse
} from '@/modules/sciverse/types';
import {
  invokeMcpTool,
  invokeAssistantTool as invokeNativeTool,
  type ConversationSourceLink,
  type ReadEntryAssistantContextResponse,
  type ReadSegmentContentResponse
} from '@/shared/ipc/assistantApi';
import {
  isResearchTool,
  ResearchImportNotApprovedError,
  researchPapersFromResult,
  runResearchTool
} from '@/shared/ipc/researchApi';
import { type SearchResults } from '@/shared/ipc/workspaceApi';
import { AgentToolNotExecutedError } from '../agent-core/agent';
import { formatReadEntryOutput } from './entryContext';
import { isPdfTool, runPdfTool } from './pdfTools';
import { researchImportResult } from './researchImportResult';
import { researchOutput } from './researchOutput';
import { formatSciverseSearchOutput } from './sciverseOutput';
import { assertSuccessfulToolResult } from './toolFailurePolicy';
import {
  formatReadSegmentOutput,
  formatSciverseContentOutput,
  formatSearchSegmentsOutput,
  trimSciverseJson
} from './toolOutput';
import { type JsonObject } from './toolValues';

async function invokeAssistantTool<T>(name: string, input: JsonObject): Promise<T> {
  const result = await invokeNativeTool<T>(name, input);
  assertSuccessfulToolResult(result);
  return result;
}

export async function executeTool(
  toolName: string,
  input: JsonObject,
  {
    addSource,
    signal,
    contextBudget,
    toolCallId
  }: {
    addSource: (source: ConversationSourceLink) => number;
    signal?: AbortSignal;
    contextBudget: number;
    toolCallId?: string;
  }
) {
  if (isPdfTool(toolName)) return runPdfTool(toolName, input, addSource, contextBudget, signal);
  if (isResearchTool(toolName)) {
    let result: unknown;
    try { result = await runResearchTool(toolName, input, signal, toolCallId); }
    catch (error) {
      if (error instanceof ResearchImportNotApprovedError) {
        throw new AgentToolNotExecutedError(error.message, 'TOOL_APPROVAL_UNAVAILABLE');
      }
      throw error;
    }
    assertSuccessfulToolResult(result);
    if (toolName === 'import_papers') return researchImportResult(result, input.paper_ids);
    return { modelOutput: researchOutput(result, contextBudget), sources: [], researchPapers: toolName === 'search_papers' ? researchPapersFromResult(result) : undefined,
      summary: '已获取外部检索结果（不代表已读论文全文）。' };
  }
  if (toolName.startsWith('mcp.')) {
    const result = await invokeMcpTool(toolName, input, signal);
    assertSuccessfulToolResult(result);
    assertSuccessfulToolResult(result.output);
    return {
      modelOutput: result.output ?? result,
      sources: [],
      summary: result.summary ?? `Executed ${toolName}.`
    };
  }

  if (toolName === 'search_segments') {
    const results = await invokeAssistantTool<SearchResults>('search_segments', input);
    return formatSearchSegmentsOutput(results, addSource);
  }

  if (toolName === 'read_segment_content') {
    const result = await invokeAssistantTool<ReadSegmentContentResponse>(
      'read_segment_content',
      input
    );
    return formatReadSegmentOutput(result, addSource, contextBudget);
  }

  if (toolName === 'read_entry_assistant_context') {
    const result = await invokeAssistantTool<ReadEntryAssistantContextResponse>(
      'read_entry_assistant_context',
      { root: input.root, entry_id: input.entry_id }
    );
    signal?.throwIfAborted();
    if (result.has_pdf && result.parsed_segment_count === 0) {
      const fallback = await runPdfTool('read_pdf_pages', { ...input, start_page: 1, page_count: 3 }, addSource, contextBudget, signal);
      return { ...fallback, modelOutput: { ...fallback.modelOutput, requested_tool: 'read_entry_assistant_context',
        note: 'PDF 尚未完整解析，已自动读取前 3 页以内的文字层；按 next_page 继续 read_pdf_pages，不能把这部分当成全文。' } };
    }
    return formatReadEntryOutput(result, addSource, contextBudget, input);
  }

  if (toolName === 'search_sciverse_evidence') {
    const result = await invokeAssistantTool<SciverseAgenticSearchResponse>(toolName, input);
    return formatSciverseSearchOutput(result, addSource, String(input.query), contextBudget);
  }

  if (toolName === 'read_sciverse_content') {
    const result = await invokeAssistantTool<SciverseContentResponse>(toolName, input);
    return formatSciverseContentOutput(result, input, addSource, contextBudget);
  }

  if (toolName === 'search_sciverse_metadata' || toolName === 'search_sciverse_paper_schema' || toolName === 'get_sciverse_metadata_catalog' || toolName === 'get_sciverse_paper_schema') {
    const result = await invokeAssistantTool<SciverseJsonResponse>(toolName, input);
    return {
      modelOutput: trimSciverseJson(result, contextBudget),
      sources: [],
      summary: toolName === 'search_sciverse_metadata'
        ? `Searched Sciverse structured metadata for "${String(input.query)}".`
        : toolName === 'search_sciverse_paper_schema'
          ? `Searched Sciverse Paper Schema for "${String(input.query)}".`
          : toolName === 'get_sciverse_metadata_catalog'
            ? 'Read the Sciverse metadata field catalog.'
            : 'Read the Sciverse Paper Schema.'
    };
  }

  throw new Error(`Unsupported assistant tool: ${toolName}`);
}

export function runningSummary(toolName: string, input: JsonObject) {
  if (isPdfTool(toolName)) return toolName === 'search_pdf_text' ? '正在搜索 PDF 文字层…' : '正在按页读取 PDF 文字层…';
  if (toolName === 'search_segments') {
    return `Searching parsed PDF segments for "${String(input.query)}" using ${String(input.mode)}.`;
  }
  if (toolName === 'read_segment_content') {
    return `Reading segment ${String(input.segment_uid)}.`;
  }
  if (toolName === 'search_sciverse_evidence') {
    return `Searching Sciverse for "${String(input.query)}".`;
  }
  if (toolName === 'read_sciverse_content') {
    return `Reading Sciverse document ${String(input.doc_id)}.`;
  }
  if (toolName === 'read_entry_assistant_context') {
    return `Reading parsed markdown for Entry ${String(input.entry_id)}.`;
  }
  return 'Running assistant tool.';
}
