// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResearchPlanDialog } from './ResearchPlanDialog';
import { board, state, plan } from './researchPlan.fixtures';
const mocks = vi.hoisted(() => ({ context: {} as any, generate: vi.fn(), update: vi.fn(), save: vi.fn(), entry: vi.fn(), note: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock('@/shared/ipc/workspaceApi', () => ({ createEntry: mocks.entry, createNote: mocks.note, readNote: mocks.read, updateNote: mocks.write }));
vi.mock('./IdeationContext', () => ({ useIdeationContext: () => mocks.context }));
vi.mock('./generateResearchPlan', () => ({ generateResearchPlan: mocks.generate }));
vi.mock('@/shared/components/SourceSnapshotPreview', () => ({ SourceSnapshotPreview: ({ markdown }: { markdown: string }) => <pre>{markdown}</pre> }));
beforeEach(() => { vi.clearAllMocks(); mocks.entry.mockResolvedValue({ id: 'report' }); mocks.note.mockResolvedValue({ contents: [{ note_id: 'note' }] }); mocks.read.mockResolvedValue({ revision: 'r' }); mocks.write.mockResolvedValue({}); mocks.context = { activeBoard: board, state: structuredClone(state), update: mocks.update, save: mocks.save }; mocks.save.mockResolvedValue(true); mocks.generate.mockResolvedValue({ plan, model: '测试模型', evidenceStatus: '来源已核对' }); });
afterEach(cleanup);
const start = () => fireEvent.click(screen.getByRole('button', { name: '开始研究' }));
it('requires explicit acceptance, and retries a failed save without adding a duplicate', async () => {
  mocks.write.mockRejectedValueOnce(new Error('disk')).mockResolvedValueOnce({});
  const close = vi.fn(); render(<ResearchPlanDialog root="root" onClose={close} />); start();
  await waitFor(() => expect((screen.getByRole('button', { name: '确认并保存到条目' }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.entry).not.toHaveBeenCalled(); expect(mocks.note).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认并保存到条目' }));
  await screen.findByText(/报告保存未完成/); expect(mocks.entry).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '确认并保存到条目' }));
  await screen.findByText('已保存到新条目'); expect(mocks.entry).toHaveBeenCalledTimes(1); expect(mocks.note).toHaveBeenCalledTimes(1);
});
it('invalidates review after changing the goal', async () => {
  render(<ResearchPlanDialog root="root" onClose={vi.fn()} />); start();
  await screen.findByText(/来源已核对/);
  fireEvent.change(screen.getByRole('textbox', { name: '研究目标' }), { target: { value: '不同目标' } });
  expect((screen.getByRole('button', { name: '确认并保存到条目' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/卡片、关系或研究说明已改变/)).toBeTruthy();
});
it('ignores a late model response after stopping', async () => {
  let complete!: (value: any) => void;
  mocks.generate.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<ResearchPlanDialog root="root" onClose={vi.fn()} />); start();
  fireEvent.click(screen.getByRole('button', { name: '停止研究' }));
  await act(async () => complete({ plan, model: '模型', evidenceStatus: '来源已核对' }));
  expect(screen.queryByText(/来源已核对/)).toBeNull(); expect(mocks.update).not.toHaveBeenCalled();
});
it('allows keyboard-accessible selection and rejects an empty selection', () => {
  render(<ResearchPlanDialog root="root" onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }));
  expect((screen.getByRole('button', { name: '开始研究' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  expect((screen.getByRole('button', { name: '开始研究' }) as HTMLButtonElement).disabled).toBe(false);
});

it('prevents selecting historical unconfirmed cards for research', () => {
  mocks.context.state.cards[0].origin = 'ai_draft';
  render(<ResearchPlanDialog root="root" onClose={vi.fn()} />);
  expect((screen.getAllByRole('checkbox')[0] as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/待核对，确认后可用于研究/)).toBeTruthy();
});

it('passes research context to the model and saves only the explicitly reviewed report', async () => {
  render(<ResearchPlanDialog root="root" onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: '已有输入' }), { target: { value: '十篇综述文献' } });
  fireEvent.change(screen.getByRole('textbox', { name: '期望输出' }), { target: { value: '研究空白分析报告' } });
  start(); await screen.findByText(/来源已核对/);
  expect(mocks.generate.mock.calls[0][1].brief).toMatchObject({ inputs: '十篇综述文献', outputs: '研究空白分析报告' });
  expect(mocks.entry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '修改报告' }));
  fireEvent.change(screen.getByRole('textbox', { name: '报告正文' }), { target: { value: '# 用户确认后的报告' } });
  fireEvent.click(screen.getByRole('button', { name: '确认并保存到条目' }));
  await screen.findByText('已保存到新条目');
  expect(mocks.write.mock.calls[0][4]).toBe('# 用户确认后的报告');
});
it('closing an unaccepted report never creates a local entry', async () => {
  const close = vi.fn(); render(<ResearchPlanDialog root="root" onClose={close} />);
  start(); await screen.findByText(/来源已核对/);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(close).toHaveBeenCalled(); expect(mocks.entry).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
});
