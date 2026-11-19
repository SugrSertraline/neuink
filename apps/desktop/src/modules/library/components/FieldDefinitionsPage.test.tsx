// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { FieldDefinitionsPage } from './FieldDefinitionsPage';
import { saveFieldDefinitions } from '@/shared/ipc/fieldDefinitionsApi';
vi.mock('@/shared/ipc/fieldDefinitionsApi', () => ({ readFieldDefinitions: vi.fn(), saveFieldDefinitions: vi.fn(async (_root, _expected, next) => next) }));
const definitions = [{ name: 'DOI', kind: 'text' as const, options: [], hidden: false }];
beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('requires confirmation before removing and persists only after confirmation', async () => {
  render(<FieldDefinitionsPage root="test" definitions={definitions} />);
  fireEvent.click(screen.getByRole('button', { name: '移除 DOI' }));
  expect(saveFieldDefinitions).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').textContent).toContain('已填写的值不会删除');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认移除' }));
  await waitFor(() => expect(saveFieldDefinitions).toHaveBeenCalledWith('test', definitions, [{ ...definitions[0], hidden: true }], undefined));
  await waitFor(() => expect(screen.queryByRole('button', { name: '移除 DOI' })).toBeNull());
});
it('creates an attribute directly from the form without a page save button', async () => {
  render(<FieldDefinitionsPage root="test" definitions={definitions} />);
  expect(screen.queryByRole('button', { name: '保存属性定义' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '新增属性' }));
  fireEvent.change(screen.getByLabelText('属性名称'), { target: { value: '项目' } });
  fireEvent.click(screen.getByRole('button', { name: '添加属性' }));
  await waitFor(() => expect(saveFieldDefinitions).toHaveBeenCalledWith('test', definitions, expect.arrayContaining([expect.objectContaining({ name: '项目', kind: 'text' })]), undefined));
  expect(await screen.findByText('项目')).toBeTruthy();
});
it('keeps the attribute visible if removal fails', async () => {
  vi.mocked(saveFieldDefinitions).mockRejectedValueOnce('资料库已变化');
  render(<FieldDefinitionsPage root="test" definitions={definitions} />);
  fireEvent.click(screen.getByRole('button', { name: '移除 DOI' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认移除' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('资料库已变化'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
  expect(screen.getByRole('button', { name: '移除 DOI' })).toBeTruthy();
});

it('edits individual options and saves their order', async () => {
  const list = [{ name: '出版类型', kind: 'select' as const, options: ['期刊', '会议'], hidden: false }];
  render(<FieldDefinitionsPage root="test" definitions={list} />);
  fireEvent.click(screen.getByRole('button', { name: '编辑 出版类型' }));
  fireEvent.click(screen.getByRole('button', { name: '下移选项 1' }));
  fireEvent.click(screen.getByRole('button', { name: '添加选项' }));
  fireEvent.change(screen.getByLabelText('选项 3'), { target: { value: '预印本' } });
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
  await waitFor(() => expect(saveFieldDefinitions).toHaveBeenCalledWith('test', list, [expect.objectContaining({ options: ['会议', '期刊', '预印本'] })], undefined));
});
it('restores removed attributes without showing a recommendation list', async () => {
  const existing = [{ name: 'DOI', kind: 'text' as const, options: [], hidden: true }];
  render(<FieldDefinitionsPage root="test" definitions={existing} />);
  expect(screen.queryByText('推荐属性')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '恢复 DOI' }));
  await waitFor(() => expect(saveFieldDefinitions).toHaveBeenCalledWith('test', existing, [{ ...existing[0], hidden: false }], undefined));
  expect(await screen.findByRole('button', { name: '编辑 DOI' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '新增属性' }));
  expect(within(screen.getByRole('dialog')).queryByText('推荐属性')).toBeNull();
});

it('selects date precision directly without a dropdown', async () => {
  const dates = [{ name: '日期', kind: 'date' as const, date_precision: 'day' as const, options: [], hidden: false }];
  render(<FieldDefinitionsPage root="test" definitions={dates} />);
  fireEvent.click(screen.getByRole('button', { name: '编辑 日期' }));
  const group = screen.getByRole('radiogroup', { name: '日期精度' });
  fireEvent.click(within(group).getByText('年'));
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
  await waitFor(() => expect(saveFieldDefinitions).toHaveBeenCalledWith('test', dates, [expect.objectContaining({ date_precision: 'year' })], undefined));
});
