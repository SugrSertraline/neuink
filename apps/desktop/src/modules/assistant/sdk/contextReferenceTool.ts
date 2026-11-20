import { jsonSchema, tool } from 'ai';
import type { ConversationMessage, ConversationSourceLink, AssistantToolTraceEvent, ScopeSnapshot } from '@/shared/ipc/assistantApi';
import type { AssistantContext } from '@/shared/types/assistant';
import { selectionContextRef, scopeContextRef, scopeMetadata } from '../context/observation';
import { AgentToolNotExecutedError } from '../agent-core';

/** Reads only context the user already supplied to this conversation; never opens an arbitrary file. */
export function createContextReferenceTool(options: {
  assistantContext?: AssistantContext | null;
  history: readonly ConversationMessage[];
  scopes?: ScopeSnapshot[];
  signal?: AbortSignal;
  addSource: (source: ConversationSourceLink) => number;
  emit: (event: AssistantToolTraceEvent) => void;
  observe: (output: unknown) => void;
}) {
  return tool({
    description: 'Read a frozen selection or a large scope catalog by its context_ref/scope_ref, or a prior host artifact using latest_diagram or latest_arxiv_search. Historical content is a snapshot, not current authorization or a fresh note read. Paginate using exact next_read. For live papers and notes use the document/note reading tools.',
    inputSchema: jsonSchema<{ context_ref: string; offset?: number; limit?: number }>({ type: 'object', additionalProperties: false,
      properties: { context_ref: { type: 'string' }, offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 100, maximum: 16000 } }, required: ['context_ref'] }),
    execute: async (input, call) => {
      const signal = call.abortSignal ?? options.signal;
      signal?.throwIfAborted();
      const offset = input.offset ?? 0, limit = input.limit ?? 8000;
      let text: string | undefined, kind = 'selection';
      let source: ConversationSourceLink | undefined;
      let artifactSources: ConversationSourceLink[] = [];
      const items = [...options.assistantContext?.items ?? [], ...options.history.flatMap(message =>
        (message.parts ?? []).flatMap(part => part.type === 'context-snapshot' ? part.items : []))];
      if (input.context_ref.startsWith('selection:')) {
        for (const item of items) {
          if (item.kind !== 'segment' || await selectionContextRef(item) !== input.context_ref) continue;
          text = item.text;
          source = { entry_id: item.entryId, entry_title: item.entryTitle, segment_uid: item.segmentUid,
            page_idx: item.pageIdx, quote: item.text.slice(0, 4000) };
          break;
        }
      } else if (input.context_ref.startsWith('scope:')) {
        for (const scope of options.scopes ?? []) {
          if (await scopeContextRef(scope) !== input.context_ref) continue;
          text = JSON.stringify(scopeMetadata(scope)); kind = 'scope_metadata'; break;
        }
      } else {
        const parts = [...options.history].reverse().flatMap(message => [...message.parts ?? []].reverse());
        if (input.context_ref === 'latest_diagram') {
          const part = parts.find(part => part.type === 'tool-result' && part.diagram);
          if (part?.type === 'tool-result' && part.diagram) {
            text = part.diagram.code; kind = 'historical_diagram';
            artifactSources = part.sourceLinks ?? [];
          }
        } else if (input.context_ref === 'latest_arxiv_search') {
          const part = parts.find(part => part.type === 'tool-result' && part.researchSearch);
          if (part?.type === 'tool-result' && part.researchSearch) {
            text = JSON.stringify(part.researchSearch); kind = 'historical_search';
          }
        }
      }
      signal?.throwIfAborted();
      if (text === undefined) throw new AgentToolNotExecutedError('The context reference is unavailable. Do not invent the missing selection or artifact.', 'TOOL_INVALID_ARGUMENTS');
      const characters = Array.from(text);
      if (offset > 0 && offset >= characters.length) throw new AgentToolNotExecutedError(
        'The offset is outside this context snapshot. Use its returned next_read arguments.', 'TOOL_INVALID_ARGUMENTS');
      const next = offset + limit;
      const chunk = characters.slice(offset, next).join('');
      if (!chunk) source = undefined;
      if (source) source = { ...source, quote: Array.from(chunk).slice(0, 4000).join('') };
      const marker = source ? options.addSource(source) : undefined;
      const evidence = artifactSources.slice(0, 8).map(saved => {
        const snapshot = { ...saved, quote: Array.from(saved.quote).slice(0, 300).join('') };
        return { marker: `[S${options.addSource(snapshot)}]`, source: snapshot };
      });
      const output = { kind, context_ref: input.context_ref, snapshot_only: true,
        ...(marker ? { marker: `[S${marker}]` } : {}), text: chunk,
        ...(evidence.length ? { evidence, evidence_truncated: artifactSources.length > evidence.length } : {}),
        total_chars: characters.length, more: next < characters.length,
        next_read: next < characters.length ? { context_ref: input.context_ref, offset: next, limit } : null };
      options.observe(output);
      options.emit({ id: call.toolCallId, toolName: 'read_context_reference', status: 'done', input,
        summary: 'Read the requested context snapshot.',
        ...((source || evidence.length) ? { sources: [...(source ? [source] : []), ...evidence.map(item => item.source)] } : {}) });
      return output;
    }
  });
}
