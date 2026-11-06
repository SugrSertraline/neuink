// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cleanup, fireEvent, render as renderBase, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EntryPaperCards } from './EntryPaperCards';
const render = (ui: ReactElement) => renderBase(ui, { wrapper: TooltipProvider });
const mocks = vi.hoisted(() => ({ context: {} as any, read: vi.fn(), save: vi.fn(), generate: vi.fn() }));
vi.mock('./IdeationContext', () => ({ useIdeationContext: () => mocks.context }));
vi.mock('@/shared/ipc/ideationApi', () => ({ readIdeationDraft: mocks.read, saveIdeationDraft: mocks.save }));
vi.mock('./generateCards', () => ({ generatePaperCards: mocks.generate, classifyCardError: () => 'model', cardErrorMessages: { model: '模型失败' } }));
vi.mock('@/shared/components/SourceSnapshotPreview', () => ({ SourceSnapshotPreview: ({ markdown }: { markdown: string }) => <p>{markdown}</p> }));
const card = (id: string, entry_id: string) => ({ id, entry_id, kind: 'method', title: id, body: '**抽象方法**：通用机制\n\n**原文实例**：具体论文做法' });
beforeEach(() => { vi.clearAllMocks(); mocks.context = { workspaceRoot: 'root', collection: { version: 2, placements: [], links: [], cards: [card('已采纳 A', 'a'), card('其他论文 B', 'b')] }, background: { summaries: [], activeId: null, refresh: vi.fn() } }; mocks.read.mockResolvedValue({ revision: 'r1', draft: { status: 'ready', cards: [card('已采纳 A', 'a'), card('草稿 A', 'a'), card('串入的 B', 'b')] } }); });
afterEach(cleanup);
it('shows only this paper, deduplicates accepted cards, and opens full details without generating', async () => {
  render(<EntryPaperCards entryId="a" parsed />);
  await screen.findByText('草稿 A'); expect(screen.getAllByText('已采纳 A')).toHaveLength(1);
  expect(screen.queryByText('其他论文 B')).toBeNull(); expect(screen.queryByText('串入的 B')).toBeNull();
  expect(mocks.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('草稿 A')); expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText(/具体论文做法/)).toBeTruthy();
});
it('ignores a late draft read after switching to a different paper', async () => {
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue({ revision: 'r2', draft: null });
  const view = render(<EntryPaperCards entryId="a" parsed />); view.rerender(<EntryPaperCards entryId="b" parsed />);
  await screen.findByText('其他论文 B');
  await act(async () => resolve({ revision: 'r1', draft: { status: 'ready', cards: [card('迟到的 A', 'a')] } }));
  expect(screen.queryByText('迟到的 A')).toBeNull(); expect(screen.queryByText('已采纳 A')).toBeNull();
});
it('cancels generation without saving its late result', async () => {
  let resolve!: (value: any) => void;
  mocks.generate.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<EntryPaperCards entryId="a" parsed />); await screen.findByText('草稿 A');
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  fireEvent.click(screen.getByRole('button', { name: '停止' }));
  await act(async () => resolve({ cards: [], model: 'test' })); expect(mocks.save).not.toHaveBeenCalled();
});
it('shows a retry after a failed read and disables generation for unparsed papers', async () => {
  mocks.read.mockRejectedValueOnce(new Error('read failure')).mockResolvedValue({ revision: 'r1', draft: null });
  render(<EntryPaperCards entryId="a" parsed={false} />);
  await screen.findByRole('alert'); fireEvent.click(screen.getByText('重新读取'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect((screen.getByRole('button', { name: '重新整理' }) as HTMLButtonElement).disabled).toBe(true);
});

it('saves regenerated cards as this paper draft without replacing accepted cards', async () => {
  mocks.generate.mockResolvedValue({ cards: [{ ...card('新草稿', 'a'), sources: [] }], model: 'test', partial: false, relations: [] });
  mocks.save.mockImplementation(async (_root: string, _revision: string, draft: unknown) => ({ revision: 'r2', draft }));
  render(<EntryPaperCards entryId="a" parsed />); await screen.findByText('草稿 A');
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await screen.findByText('新草稿');
  expect(mocks.save).toHaveBeenCalledWith('root', 'r1', expect.objectContaining({ entry_id: 'a', cards: [expect.objectContaining({ entry_id: 'a', title: '新草稿' })] }));
  expect(screen.getByText('已采纳 A')).toBeTruthy(); expect(mocks.context.background.refresh).toHaveBeenCalled();
});

it('edits one draft card, preserving its identity and other cards', async () => {
  mocks.save.mockImplementation(async (_root: string, _revision: string, draft: unknown) => ({ revision: 'r2', draft }));
  render(<EntryPaperCards entryId="a" parsed />); await screen.findByText('草稿 A');
  fireEvent.click(screen.getByRole('button', { name: '编辑卡片 草稿 A' }));
  fireEvent.change(screen.getByLabelText('卡片名称'), { target: { value: '编辑后的方法' } });
  fireEvent.click(screen.getByRole('button', { name: '保存卡片' }));
  await screen.findByText('编辑后的方法');
  const saved = mocks.save.mock.calls[0][2]; expect(saved.cards.find((c: any) => c.id === '草稿 A').title).toBe('编辑后的方法');
  expect(saved.cards.some((c: any) => c.id === '已采纳 A')).toBe(true);
});
it('creates an independent paper card and searches its abstract content', async () => {
  mocks.context.updateCollection = (change: any) => { mocks.context.collection = change({ ...mocks.context.collection, placements: [], links: [], version: 2 }); };
  mocks.context.save = vi.fn().mockResolvedValue(true);
  render(<EntryPaperCards entryId="a" parsed />); await screen.findByText('草稿 A');
  fireEvent.click(screen.getByRole('button', { name: '新建卡片' }));
  fireEvent.change(screen.getByLabelText('卡片名称'), { target: { value: '新建机制' } });
  fireEvent.change(screen.getByLabelText('卡片内容'), { target: { value: '共享局部信号' } });
  fireEvent.click(screen.getByRole('button', { name: '保存卡片' }));
  await screen.findByText('新建机制');
  fireEvent.change(screen.getByRole('textbox', { name: '搜索论文卡片' }), { target: { value: '共享局部' } });
  expect(screen.getByText('新建机制')).toBeTruthy(); expect(screen.queryByText('草稿 A')).toBeNull();
  expect(mocks.context.collection.cards.find((c: any) => c.title === '新建机制').entry_id).toBe('a');
});
it('deletes a draft only after confirmation and keeps its neighbors', async () => {
  mocks.save.mockImplementation(async (_root: string, _revision: string, draft: unknown) => ({ revision: 'r2', draft }));
  render(<EntryPaperCards entryId="a" parsed />); await screen.findByText('草稿 A');
  fireEvent.click(screen.getByRole('button', { name: '删除卡片 草稿 A' }));
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(screen.queryByText('草稿 A')).toBeNull());
  expect(screen.getByText('已采纳 A')).toBeTruthy();
});
