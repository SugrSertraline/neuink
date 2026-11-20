// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IdeationSourceDetails } from './IdeationSourceDetails';

afterEach(cleanup);
it('keeps quoted evidence readable and routes a trashed source to the recycle bin', () => {
  const onOpenTrash = vi.fn(), onOpenEntry = vi.fn();
  render(<IdeationSourceDetails root="library" entryId="paper" trashedTitle="来源论文" sources={[{ segment_uid: 's1', page_idx: 0, quote: '已保存的原文摘录' }]}
    onOpenTrash={onOpenTrash} onOpenEntry={onOpenEntry} onOpenSource={vi.fn()} />);
  expect(screen.getByText('来源已移入回收站：来源论文')).toBeTruthy();
  expect(screen.getByText('已保存的原文摘录')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看来源论文' })).toBeNull();
  expect(screen.getByRole('button', { name: /核对原文/ }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '前往回收站恢复来源' }));
  expect(onOpenTrash).toHaveBeenCalledOnce();
  expect(onOpenEntry).not.toHaveBeenCalled();
});
it('re-enables source opening after restoration without changing the snapshot', () => {
  const onOpenEntry = vi.fn();
  const ui = render(<IdeationSourceDetails root="library" entryId="paper" onOpenEntry={onOpenEntry} />);
  expect(screen.getByText(/来源当前不可用/)).toBeTruthy();
  ui.rerender(<IdeationSourceDetails root="library" entryId="paper" title="已恢复论文" onOpenEntry={onOpenEntry} />);
  fireEvent.click(screen.getByRole('button', { name: '查看来源论文' }));
  expect(onOpenEntry).toHaveBeenCalledWith('paper');
  expect(screen.queryByText(/来源当前不可用/)).toBeNull();
});
