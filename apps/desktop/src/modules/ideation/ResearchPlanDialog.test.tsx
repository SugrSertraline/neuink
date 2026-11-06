// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResearchPlanDialog } from './ResearchPlanDialog';
import { board, state, plan } from './researchPlan.fixtures';
const mocks = vi.hoisted(() => ({ context: {} as any, generate: vi.fn(), update: vi.fn(), save: vi.fn() }));
vi.mock('./IdeationContext', () => ({ useIdeationContext: () => mocks.context }));
vi.mock('./generateResearchPlan', () => ({ generateResearchPlan: mocks.generate }));
vi.mock('@/shared/components/SourceSnapshotPreview', () => ({ SourceSnapshotPreview: ({ markdown }: { markdown: string }) => <pre>{markdown}</pre> }));
beforeEach(() => { vi.clearAllMocks(); mocks.context = { activeBoard: board, state: structuredClone(state), update: mocks.update, save: mocks.save }; mocks.save.mockResolvedValue(true); mocks.generate.mockResolvedValue({ plan, model: '测试模型', evidenceStatus: '来源已核对' }); });
afterEach(cleanup);
const start = () => fireEvent.click(screen.getByRole('button', { name: '评价并生成方案' }));
it('requires explicit acceptance, and retries a failed save without adding a duplicate', async () => {
  mocks.save.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const close = vi.fn(); render(<ResearchPlanDialog root="root" onClose={close} />); start();
  await waitFor(() => expect((screen.getByRole('button', { name: '保存为方案卡' }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存为方案卡' }));
  await screen.findByText(/保存失败，方案仍/); expect(mocks.update).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(close).toHaveBeenCalled()); expect(mocks.update).toHaveBeenCalledTimes(1);
});
it('invalidates review after changing the goal', async () => {
  render(<ResearchPlanDialog root="root" onClose={vi.fn()} />); start();
  await screen.findByText(/来源已核对/);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '不同目标' } });
  expect((screen.getByRole('button', { name: '保存为方案卡' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/卡片、关系或目标已改变/)).toBeTruthy();
});
it('ignores a late model response after stopping', async () => {
  let complete!: (value: any) => void;
  mocks.generate.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<ResearchPlanDialog root="root" onClose={vi.fn()} />); start();
  fireEvent.click(screen.getByRole('button', { name: '停止评价' }));
  await act(async () => complete({ plan, model: '模型', evidenceStatus: '来源已核对' }));
  expect(screen.queryByText(/来源已核对/)).toBeNull(); expect(mocks.update).not.toHaveBeenCalled();
});
it('allows keyboard-accessible selection and rejects an empty selection', () => {
  render(<ResearchPlanDialog root="root" onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }));
  expect((screen.getByRole('button', { name: '评价并生成方案' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  expect((screen.getByRole('button', { name: '评价并生成方案' }) as HTMLButtonElement).disabled).toBe(false);
});
