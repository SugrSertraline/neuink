// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionRecovery } from './ExecutionRecovery';
import { listAgentExecutions } from '@/shared/ipc/agentExecutionApi';
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ listAgentExecutions: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
describe('execution recovery entry', () => {
  it('shows interrupted work and uses an explicit accessible continuation action', async () => {
    vi.mocked(listAgentExecutions).mockResolvedValue([{ id: 'execution-1', conversationId: 'conversation', revision: 1,
      updatedAt: '', status: 'cancelled', payload: { question: 'Read the paper' } }]);
    const onResume = vi.fn();
    const view = render(<ExecutionRecovery root="root" conversationId="conversation" busy={false} onResume={onResume} />);
    fireEvent.click(await view.findByRole('button', { name: '继续任务' }));
    expect(onResume).toHaveBeenCalledWith('execution-1');
    view.rerender(<ExecutionRecovery root="root" conversationId="conversation" busy onResume={onResume} />);
    expect(view.queryByRole('button', { name: '继续任务' })).toBeNull();
  });
  it('distinguishes empty and failed states and permits retry', async () => {
    vi.mocked(listAgentExecutions).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    const view = render(<ExecutionRecovery root="root" conversationId="conversation" busy={false} onResume={vi.fn()} />);
    fireEvent.click(await view.findByRole('button', { name: '重试' }));
    await waitFor(() => expect(view.queryByText('未能读取未完成任务')).toBeNull());
    expect(view.queryByRole('button', { name: '继续任务' })).toBeNull();
  });
});
