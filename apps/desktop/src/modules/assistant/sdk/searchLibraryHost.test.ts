import { describe, expect, it, vi } from 'vitest';
import { AgentStoppedError } from '../agent-core/agent';
import type { PlanResolution } from './retrievalPlanning';
import { runSearchLibrary, type TaskSearchItem, type TaskSearchRequest } from './searchLibrary';

const libraryEntries = [{ id: 'A', title: 'Paper A' }, { id: 'B', title: 'Paper B' }];
const libraryFrozen = { intent: 'library' as const, entry_ids: [], tagged: false };
const selectedAFrozen = { intent: 'selection' as const, entry_ids: ['A'], tagged: false };

function plannedWith(overrides: Partial<PlanResolution['plan']>): PlanResolution {
  return {
    status: 'planned',
    attempts: 1,
    plan: {
      question_types: ['multi_target'],
      scope_kind: 'unspecified',
      original_question: '比较 A 和 Z 的方法？',
      retrieval_tasks: [
        { id: 't1', question: 'A 的方法？', constraints: [], depends_on: [], target_entry_ids: ['A'] }
      ],
      unresolved_targets: [],
      synthesis_task: undefined,
      ...overrides
    }
  };
}

function okItem(taskId: string, entries: Array<{ entry_id: string; entry_title: string }>): TaskSearchItem {
  return {
    task_id: taskId,
    outcome: {
      status: 'ok',
      mode: 'hybrid',
      evidence: entries.map((entry, index) => ({
        entry_id: entry.entry_id,
        entry_title: entry.entry_title,
        segment_uid: `${entry.entry_id}-${index}`,
        page: 1,
        marker: `S${index + 1}`
      })),
      sources: [],
      warnings: []
    }
  };
}

const baseInput = {
  question: '比较 A 和 Z 的方法？',
  topK: 5,
  libraryEntries
};

describe('runSearchLibrary host guarantees', () => {
  it('stops for clarification and makes no batch call when a named target is unresolved', async () => {
    const searchBatch = vi.fn(async () => []);
    const result = await runSearchLibrary({
      ...baseInput,
      usePlanning: true,
      scopeRequest: { kind: 'unspecified' },
      frozenScope: libraryFrozen,
      plan: async () => plannedWith({ unresolved_targets: ['Zeta paper'], retrieval_tasks: [] }),
      searchBatch
    });
    expect(searchBatch).not.toHaveBeenCalled();
    expect(result.modelOutput.status).toBe('needs_clarification');
    expect(result.modelOutput.clarification).toContain('Zeta paper');
    expect(result.modelOutput.task_results).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it('reports an unresolvable selected scope as clarification, not as an ordinary empty result', async () => {
    const searchBatch = vi.fn(async () => []);
    const result = await runSearchLibrary({
      ...baseInput,
      usePlanning: false,
      scopeRequest: { kind: 'unspecified' },
      frozenScope: { intent: 'selection', entry_ids: ['gone'], tagged: false },
      plan: async () => plannedWith({}),
      searchBatch
    });
    expect(searchBatch).not.toHaveBeenCalled();
    expect(result.modelOutput.status).toBe('needs_clarification');
    expect(result.modelOutput.clarification).toBeTruthy();
  });

  it('reports an explicit empty scope as empty_scope, which is distinct from clarification', async () => {
    const result = await runSearchLibrary({
      ...baseInput,
      usePlanning: false,
      scopeRequest: { kind: 'explicit_multi', entry_ids: [] },
      frozenScope: libraryFrozen,
      plan: async () => plannedWith({}),
      searchBatch: async () => []
    });
    expect(result.modelOutput.status).toBe('empty_scope');
    expect(result.modelOutput.clarification).toBeUndefined();
  });

  it('passes the execution signal to the planner', async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    await runSearchLibrary({
      ...baseInput,
      usePlanning: true,
      scopeRequest: { kind: 'unspecified' },
      frozenScope: libraryFrozen,
      abortSignal: controller.signal,
      plan: async (input) => {
        seen.push(input.abortSignal);
        return plannedWith({ retrieval_tasks: [] });
      },
      searchBatch: async () => []
    });
    expect(seen).toEqual([controller.signal]);
  });

  it('lets a stop error from the planner propagate instead of degrading it to model_unavailable', async () => {
    await expect(runSearchLibrary({
      ...baseInput,
      usePlanning: true,
      scopeRequest: { kind: 'unspecified' },
      frozenScope: libraryFrozen,
      plan: async () => { throw new AgentStoppedError('Request token budget exhausted.'); },
      searchBatch: async () => []
    })).rejects.toBeInstanceOf(AgentStoppedError);
  });

  it('drops evidence from another paper inside a task bound to A', async () => {
    const result = await runSearchLibrary({
      ...baseInput,
      usePlanning: true,
      scopeRequest: { kind: 'unspecified' },
      frozenScope: libraryFrozen,
      plan: async () => plannedWith({}),
      searchBatch: async (requests: TaskSearchRequest[]) => [
        okItem(requests[0].task_id, [
          { entry_id: 'A', entry_title: 'Paper A' },
          { entry_id: 'B', entry_title: 'Paper B' }
        ])
      ]
    });
    const [task] = result.modelOutput.task_results;
    expect(task.evidence.map((item) => item.entry_id)).toEqual(['A']);
    expect(task.status).toBe('retrieved');
  });

  it('never sends a task outside the frozen selection', async () => {
    const searchBatch = vi.fn(async (requests: TaskSearchRequest[]) => requests.map((request) => okItem(request.task_id, [])));
    await runSearchLibrary({
      ...baseInput,
      usePlanning: false,
      scopeRequest: { kind: 'unspecified' },
      frozenScope: selectedAFrozen,
      plan: async () => plannedWith({}),
      searchBatch
    });
    expect(searchBatch.mock.calls[0][0][0]).toMatchObject({ scope_entry_ids: ['A'], allowed_entry_ids: ['A'] });
  });

  it('lets a stop error from the batch propagate as cancellation', async () => {
    await expect(runSearchLibrary({
      ...baseInput,
      usePlanning: false,
      scopeRequest: { kind: 'unspecified' },
      frozenScope: libraryFrozen,
      plan: async () => plannedWith({}),
      searchBatch: async () => { throw new AgentStoppedError('stopped'); }
    })).rejects.toBeInstanceOf(AgentStoppedError);
  });
});
