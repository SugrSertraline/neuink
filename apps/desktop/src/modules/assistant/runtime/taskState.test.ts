import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import type { AssistantTaskState } from '@/shared/types/assistant';

import { latestAwaitingUserTask, latestPendingTask } from './taskState';

describe('latestAwaitingUserTask', () => {
  it('restores only an explicit awaiting_user task', () => {
    const completed = task('completed', '2026-07-14T01:00:00Z');
    const awaiting = task('awaiting_user', '2026-07-14T00:00:00Z');
    const history = [message(completed), message(awaiting)];
    expect(latestAwaitingUserTask(history)?.taskId).toBe(awaiting.taskId);
  });

  it('does not recover a legacy plan part', () => {
    const history = [{
      content: '',
      created_at: '',
      message_id: 'message-1',
      parts: [],
      role: 'assistant' as const,
      source_links: []
    }];
    expect(latestAwaitingUserTask(history)).toBeNull();
  });

  it('exposes the latest failed state without parsing magic retry phrases', () => {
    const failed = task('failed', '2026-07-14T02:00:00Z');
    const history = [message(failed)];

    expect(latestPendingTask(history, '再次修改')?.taskId).toBe(failed.taskId);
    expect(latestPendingTask(history, '这篇论文讲了什么')?.taskId).toBe(failed.taskId);
  });
});

function message(value: AssistantTaskState): ConversationMessage {
  return {
    content: '',
    created_at: value.updatedAt,
    message_id: `message-${value.status}`,
    parts: [{ task: value, type: 'task-state' }],
    role: 'assistant',
    source_links: []
  };
}

function task(status: AssistantTaskState['status'], updatedAt: string): AssistantTaskState {
  const taskId = `task-${status}`;
  return {
    conversationId: 'conversation-1',
    createdAt: updatedAt,
    evidenceLedger: { createdAt: updatedAt, evidence: [], ledgerId: 'ledger-1', taskId, updatedAt },
    goal: { normalizedGoal: 'goal', originalRequest: 'goal' },
    operation: null,
    phase: 'compile',
    proposalIds: [],
    revision: 1,
    spec: {
      attachments: [], capabilities: [], confidence: 1, deliverables: ['chat_answer'],
      intent: 'general_qa', missing: [], needsCurrentNote: false,
      needsDocumentContext: false, needsNoteProposal: false, needsSegmentSearch: false,
      rationale: 'test', steps: [], target: { kind: 'chat_only' }
    },
    status,
    taskId,
    updatedAt
  };
}
