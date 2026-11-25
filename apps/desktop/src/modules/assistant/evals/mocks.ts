/**
 * `vi.mock` factories shared by the live and offline harness tests.
 * They bridge the production code to the in-memory fixture surface.
 */
type ImportOriginal = <T = unknown>() => Promise<T>;

export function tauriHttpFactory() {
  return {
    fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args)
  };
}

export async function assistantApiFactory(importOriginal: ImportOriginal) {
  const actual = await importOriginal<typeof import('@/shared/ipc/assistantApi')>();
  const { evalState, fixtureMissing } = await import('./evalState');
  return {
    ...actual,
    loadPrompt: async (name: string) => {
      const prompt = evalState.prompts.get(name);
      if (prompt === undefined) throw new Error(`Prompt fixture missing: ${name}`);
      return prompt;
    },
    listTools: async () => [...evalState.descriptors],
    invokeAssistantTool: async (name: string, args: unknown) => {
      const handler = evalState.invoke.get(name);
      if (!handler) return fixtureMissing('invoke', name);
      return handler((args ?? {}) as Record<string, unknown>);
    }
  };
}

export async function researchApiFactory(importOriginal: ImportOriginal) {
  const actual = await importOriginal<typeof import('@/shared/ipc/researchApi')>();
  const { evalState, fixtureMissing } = await import('./evalState');
  return {
    ...actual,
    runResearchTool: async (name: string, input: unknown) => {
      const handler = evalState.research.get(name);
      if (!handler) return fixtureMissing('research', name);
      return handler((input ?? {}) as Record<string, unknown>);
    }
  };
}

export async function pdfTextApiFactory(importOriginal: ImportOriginal) {
  const actual = await importOriginal<typeof import('@/shared/ipc/pdfTextApi')>();
  return {
    ...actual,
    inspectPdfText: async (_root: string, entryId: string, startPage: number, pageCount: number) => {
      const { evalState, fixtureMissing } = await import('./evalState');
      const fixture = evalState.pdf.get(entryId);
      if (!fixture) return fixtureMissing('pdf', entryId);
      return {
        entry_id: entryId,
        entry_title: entryId,
        revision: fixture.revision,
        page_count: fixture.pageCount,
        pages: fixture.pages
          .filter(page => page.page_idx + 1 >= startPage)
          .slice(0, pageCount)
      };
    },
    readAssistantPdfBytes: async () => {
      throw new Error('eval fixture did not provide PDF bytes');
    },
    cachePdfText: async () => undefined
  };
}

export async function browserApiFactory(importOriginal: ImportOriginal) {
  const actual = await importOriginal<typeof import('@/shared/ipc/browserApi')>();
  return {
    ...actual,
    readBrowserTab: async () => {
      const { evalState, fixtureMissing } = await import('./evalState');
      if (!evalState.browserTab) return fixtureMissing('browser', 'tab');
      return evalState.browserTab;
    }
  };
}

export async function workspaceApiFactory(importOriginal: ImportOriginal) {
  const actual = await importOriginal<typeof import('@/shared/ipc/workspaceApi')>();
  return {
    ...actual,
    readNote: async (_root: string, entryId: string, noteId: string) => {
      const { evalState, fixtureMissing } = await import('./evalState');
      const note = evalState.notes.get(`${entryId}:${noteId}`);
      if (!note) return fixtureMissing('note', `${entryId}:${noteId}`);
      return note;
    }
  };
}

/** Retain host observations and proposals even if final answer verification throws. */
export async function toolRuntimeFactory(importOriginal: ImportOriginal) {
  const actual = await importOriginal<typeof import('../sdk/tools')>();
  const { evalState } = await import('./evalState');
  return {
    ...actual,
    createAssistantTools: async (options: Parameters<typeof actual.createAssistantTools>[0]) => {
      const runtime = await actual.createAssistantTools({ ...options,
        onToolEvent: event => {
          evalState.toolEvents.set(event.id, structuredClone(event));
          options.onToolEvent?.(event);
        },
        onNoteProposal: options.onNoteProposal ? proposal => {
          evalState.noteProposals.push(structuredClone(proposal));
          options.onNoteProposal?.(proposal);
        } : undefined,
        onEntryMetaProposal: options.onEntryMetaProposal ? proposal => {
          evalState.entryMetaProposals.push(structuredClone(proposal));
          options.onEntryMetaProposal?.(proposal);
        } : undefined,
        onTagProposal: options.onTagProposal ? proposal => {
          evalState.tagProposals.push(structuredClone(proposal));
          options.onTagProposal?.(proposal);
        } : undefined
      });
      evalState.ledgers.push({ actorId: options.actorId ?? 'main', sources: runtime.sourceByMarker });
      return runtime;
    }
  };
}

export async function agentDriverFactory(importOriginal: ImportOriginal) {
  const actual = await importOriginal<typeof import('../sdk/agentDriver')>();
  const { evalState, recordTurn, recordToolResult } = await import('./evalState');
  const { evalError } = await import('./diagnostics');
  return {
    ...actual,
    createAgentDriver: (options: Parameters<typeof actual.createAgentDriver>[0]) => {
      let current: import('./types').EvalTurn | undefined;
      let currentCalls: import('./types').EvalToolCall[] = [];
      const driver = actual.createAgentDriver({ ...options,
        onDelta: text => {
          if (current) current.text = (current.text ?? '') + text;
          options.onDelta?.(text);
        },
        onReasoningDelta: text => {
          if (current) current.reasoningChars = (current.reasoningChars ?? 0) + text.length;
          options.onReasoningDelta?.(text);
        }
      });
      const phase: 'main' | 'subagent' =
        /delegated, read-only worker|Agent Kind: subagent/.test(options.system) ? 'subagent' : 'main';
      let turn = 0;
      return {
        ...driver,
        async turn(
          messages: Parameters<typeof driver.turn>[0],
          signal?: AbortSignal,
          turnOptions?: Parameters<typeof driver.turn>[2]
        ) {
          turn += 1;
          current = { phase, turn, declaredTools: [], callCount: 0, status: 'running', text: '',
            messages: structuredClone([...messages]) };
          evalState.turns.push(current);
          const started = Date.now();
          try {
            const result = await driver.turn(messages, signal, turnOptions);
            current.status = 'completed';
            current.text = result.text;
            current.callCount = result.calls.length;
            // Preserve provider-normalized output even when the driver hides raw tool markup.
            current.messages!.push(...structuredClone(result.messages));
            currentCalls = recordTurn(current.declaredTools, phase, turn, result.calls);
            return result;
          } catch (error) {
            current.status = 'failed';
            current.error = evalError(error);
            throw error;
          } finally {
            current.durationMs = Date.now() - started;
          }
        },
        result(...[call, output, failed]: Parameters<typeof driver.result>) {
          const recorded = currentCalls.find(item => item.id === call.id);
          if (!recorded) throw new Error('Tool outcome has no recorded model call');
          recordToolResult(recorded, output, failed);
          return driver.result(call, output, failed);
        }
      };
    }
  };
}

export async function providerFactory(importOriginal: ImportOriginal) {
  const actual = await importOriginal<typeof import('../sdk/provider')>();
  const { traceModel } = await import('./modelTrace');
  return { ...actual, createNeuinkModel: (...args: Parameters<typeof actual.createNeuinkModel>) =>
    traceModel(actual.createNeuinkModel(...args)) };
}
