/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TagReadingMember, TagReadingState } from '@/shared/ipc/tagReadingApi';
import { TagReadingQueue } from './TagReadingQueue';

function props() {
  const members: TagReadingMember[] = ['A', 'B', 'C', 'D'].map((id) => ({
    entry_id: id, title: `论文 ${id}`, pdf_available: id !== 'D', reflow_available: id !== 'D',
    preferred_mode: 'pdf', issue: id === 'D' ? '原始文件不存在' : null,
  }));
  const state: TagReadingState = {
    version: 1, revision: 1, tag_id: 'tag', active_entry_id: 'A', compare_entry_id: 'B',
    queue_collapsed: false, split_ratio: 0.5, include_descendants: true, updated_at: '',
    member_states: Object.fromEntries(members.map((member, order) => [member.entry_id, { status: 'unread', order, updated_at: '' }])),
  };
  return { members, state, disabled: false, onSelect: vi.fn(), onCompare: vi.fn(), onStatus: vi.fn(), onMove: vi.fn() };
}
describe('TagReadingQueue', () => {
  afterEach(cleanup);
  it('separates opening the main paper from fixing a comparison', () => {
    const callbacks = props(); render(<TagReadingQueue {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: '论文 C' }));
    expect(callbacks.onSelect).toHaveBeenCalledWith('C');
    expect(callbacks.onCompare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '将“论文 C”设为对照论文' }));
    expect(callbacks.onCompare).toHaveBeenCalledWith('C');
    expect(screen.queryByRole('button', { name: '将“论文 A”设为对照论文' })).toBeNull();
    expect(screen.getByText('原始文件不存在')).toBeTruthy();
    expect((screen.getByRole('button', { name: '论文 D' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('comparison chooser only selects a new comparison, never replaces the main paper', () => {
    const callbacks = props(); render(<TagReadingQueue {...callbacks} mode="compare" />);
    for (const id of ['A', 'B', 'D']) {
      const button = screen.getByRole('button', { name: `论文 ${id}` });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    fireEvent.click(screen.getByRole('button', { name: '论文 C' }));
    expect(callbacks.onCompare).toHaveBeenCalledExactlyOnceWith('C');
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /阅读状态与顺序/ })).toBeNull();
  });
  it('groups status and ordering and uses full queue order when filtered', () => {
    const callbacks = props(); render(<TagReadingQueue {...callbacks} />);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索本标签论文' }), { target: { value: '论文 A' } });
    const open = () => fireEvent.keyDown(screen.getByRole('button', { name: '“论文 A”的阅读状态与顺序' }), { key: 'Enter' });
    open();
    expect(screen.getByRole('menuitem', { name: '提前一篇' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: '已读' }));
    expect(callbacks.onStatus).toHaveBeenCalledWith('A', 'done');
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: '推后一篇' }));
    expect(callbacks.onMove).toHaveBeenCalledWith('A', 1);
  });
  it('provides explicit search-empty feedback and disables choices during saves', () => {
    const callbacks = props(); render(<TagReadingQueue {...callbacks} disabled />);
    fireEvent.click(screen.getByRole('button', { name: '论文 C' }));
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索本标签论文' }), { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的论文')).toBeTruthy();
  });
});
