// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { ZoteroOrganizationInfo } from './ZoteroOrganizationInfo';

afterEach(cleanup);
const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
beforeAll(() => Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
afterAll(() => { if (scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView); else Reflect.deleteProperty(Element.prototype, 'scrollIntoView'); });
const organization = [{ source_id: 'zotero-library', tags: ['topic/label', '已有标签'], collections: ['研究 / 时间序列'] }];

it('keeps source names read-only and copies only after reviewing a local path', async () => {
  const onAddTagPath = vi.fn(async () => undefined);
  render(<ZoteroOrganizationInfo organization={organization} tags={[]} tagPaths={['已有标签']} onAddTagPath={onAddTagPath} />);
  expect(onAddTagPath).not.toHaveBeenCalled();
  expect(screen.getByText('来源只读')).toBeTruthy();
  expect(screen.getByRole('button', { name: '添加标签 已有标签 到我的标签' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '添加标签 topic/label 到我的标签' }));
  expect(screen.getByLabelText('本地标签路径')).toHaveProperty('value', 'topic／label');
  fireEvent.change(screen.getByLabelText('本地标签路径'), { target: { value: '我的分类/研究主题' } });
  fireEvent.click(screen.getByRole('button', { name: '确认添加' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onAddTagPath).toHaveBeenCalledExactlyOnceWith('我的分类/研究主题');
  expect(screen.getByText('topic/label')).toBeTruthy();
});

it('preserves the proposed path on failure and lets the user retry', async () => {
  const onAddTagPath = vi.fn().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue(undefined);
  render(<ZoteroOrganizationInfo organization={organization} tags={[]} tagPaths={[]} onAddTagPath={onAddTagPath} />);
  fireEvent.click(screen.getByRole('button', { name: '添加分类 研究 / 时间序列 到我的标签' }));
  expect(screen.getByLabelText('本地标签路径')).toHaveProperty('value', '研究/时间序列');
  fireEvent.click(screen.getByRole('button', { name: '确认添加' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('本地标签路径')).toHaveProperty('value', '研究/时间序列');
  fireEvent.click(screen.getByRole('button', { name: '确认添加' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onAddTagPath).toHaveBeenCalledTimes(2);
});

it('limits the sidebar to a short summary, opens the overview and keeps every hidden source item available to add', async () => {
  const onOpenDetails = vi.fn(), onAddTagPath = vi.fn(async () => undefined);
  render(<ZoteroOrganizationInfo compact onOpenDetails={onOpenDetails} organization={[{ source_id: 'source', collections: ['分类一', '分类二', '分类三'], tags: ['标签一', '标签二', '标签三', '标签四'] }]} tags={[]} tagPaths={[]} onAddTagPath={onAddTagPath} />);
  expect(screen.queryByText('分类三')).toBeNull();
  expect(screen.queryByText('标签四')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '已收起其余 2 项，在条目详情查看全部' }));
  expect(onOpenDetails).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '选择其他来源分类或标签添加' }));
  fireEvent.click(screen.getByRole('combobox', { name: '选择来源分类或标签' }));
  fireEvent.click(await screen.findByRole('option', { name: '标签：标签四' }));
  expect(screen.getByLabelText('本地标签路径')).toHaveProperty('value', '标签四');
  fireEvent.click(screen.getByRole('button', { name: '确认添加' }));
  await waitFor(() => expect(onAddTagPath).toHaveBeenCalledExactlyOnceWith('标签四'));
});
