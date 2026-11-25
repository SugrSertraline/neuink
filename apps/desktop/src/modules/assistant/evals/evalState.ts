import type { AssistantToolDescriptor, AssistantToolTraceEvent, ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { AssistantNoteProposal, AssistantEntryMetaProposal, AssistantTagProposal } from '@/shared/types/assistant';
import type { BrowserTabSnapshot } from '@/shared/ipc/browserApi';
import type { EvalToolCall, EvalTurn, FixtureHandler, NoteFixture, PdfFixture } from './types';
import { isAgentToolFailure } from '../agent-core/toolFailure';

/**
 * Mutable fixture surface shared by the mocked host bridge and the runner.
 * Shared only by the eval mocks; credentials and application settings never enter this state.
 */
export const evalState = {
  descriptors: [] as AssistantToolDescriptor[],
  invoke: new Map<string, FixtureHandler>(),
  research: new Map<string, FixtureHandler>(),
  pdf: new Map<string, PdfFixture>(),
  notes: new Map<string, NoteFixture>(),
  browserTab: null as BrowserTabSnapshot | null,
  prompts: new Map<string, string>(),
  calls: [] as EvalToolCall[],
  turns: [] as EvalTurn[],
  fixtureErrors: [] as string[],
  toolEvents: new Map<string, AssistantToolTraceEvent>(),
  noteProposals: [] as AssistantNoteProposal[],
  entryMetaProposals: [] as AssistantEntryMetaProposal[],
  tagProposals: [] as AssistantTagProposal[],
  ledgers: [] as Array<{ actorId: string; sources: Map<number, ConversationSourceLink> }>
};

export function resetEvalState() {
  evalState.descriptors = [];
  evalState.invoke.clear();
  evalState.research.clear();
  evalState.pdf.clear();
  evalState.notes.clear();
  evalState.browserTab = null;
  evalState.calls = [];
  evalState.turns = [];
  evalState.fixtureErrors = [];
  evalState.toolEvents.clear();
  evalState.noteProposals = [];
  evalState.entryMetaProposals = [];
  evalState.tagProposals = [];
  evalState.ledgers = [];
}

export function recordTurn(
  declaredTools: string[],
  phase: EvalTurn['phase'],
  turn: number,
  calls: Array<{ id: string; name: string; input: unknown; error?: string; errorCode?: string }>
) {
  return calls.map(call => {
    const recorded: EvalToolCall = {
      id: call.id,
      name: call.name,
      input: call.input,
      status: call.error ? 'rejected' : 'attempted',
      error: call.error,
      errorCode: call.errorCode,
      phase,
      turn,
      declaredTools: [...declaredTools]
    };
    evalState.calls.push(recorded);
    return recorded;
  });
}

/** Observe the core's actual outcome, including preflight and approval failures. */
export function recordToolResult(call: EvalToolCall, output: unknown, failed: boolean) {
  call.output = structuredClone(output);
  const failure = isAgentToolFailure(output) ? output : undefined;
  call.status = failed ? failure?.outcome === 'not_executed' ? 'rejected' : 'failed' : 'succeeded';
  if (failed) {
    call.error = failure?.message ?? 'Tool execution failed';
    call.errorCode = failure?.code;
  }
}

export function fixtureMissing(kind: 'invoke' | 'research' | 'pdf' | 'note' | 'browser', key: string): never {
  const message = `eval fixture missing: ${kind}:${key}`;
  evalState.fixtureErrors.push(message);
  throw new Error(message);
}
