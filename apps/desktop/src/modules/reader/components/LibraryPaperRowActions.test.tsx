// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SourceLocalCopyProvider } from '@/modules/import/SourceLocalCopyProvider';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { LibraryPaperRowActions, visibleActionCount } from './LibraryPaperRowActions';
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }));
afterEach(cleanup);
const entry = { id: 'paper', title: '论文', status: 'Parsed', pdfFileName: 'paper.pdf', sourceInfo: { kinds: ['mineru'], local_copy_ids: ['copy'] } } as LibraryEntry;
function actions(width: number) {
  return <TooltipProvider><SourceLocalCopyProvider root="library" beforeCopy={vi.fn()} refreshEntries={vi.fn()} setHidden={vi.fn()} onOpenEntry={vi.fn()}>
    <LibraryPaperRowActions width={width} entry={entry} reparseDisabled={false} onOpenInSidePane={vi.fn()} onOpen={vi.fn()} onReparse={vi.fn()} onDelete={vi.fn()} onToggleSourceHidden={vi.fn()} />
  </SourceLocalCopyProvider></TooltipProvider>;
}
it('uses all five slots without reserving an unnecessary more button', () => {
  render(actions(182));
  expect(screen.getAllByRole('button')).toHaveLength(5);
  expect(screen.queryByRole('button', { name: '更多操作：论文' })).toBeNull();
});
it.each([[148, 3, 2], [114, 2, 3], [80, 1, 4], [64, 0, 5]])('at width %s keeps the first %s actions and folds only %s', (width, visible, hidden) => {
  render(actions(width));
  const row = screen.getByRole('group', { name: '条目操作：论文' });
  expect(within(row).getAllByRole('button')).toHaveLength(visible + 1);
  fireEvent.click(screen.getByRole('button', { name: '更多操作：论文' }));
  const panel = screen.getByRole('dialog');
  expect(within(panel).getAllByRole('button')).toHaveLength(hidden);
  for (const button of within(panel).getAllByRole('button')) {
    expect(button.className).toContain('justify-start');
    expect(button.className).toContain('gap-2');
    expect(button.querySelector('svg')).toBeTruthy();
  }
  expect(screen.getAllByRole('button', { name: '查看详情' })).toHaveLength(1);
});
it('freezes the split while expanded then recalculates after Escape', () => {
  const view = render(actions(114));
  fireEvent.click(screen.getByRole('button', { name: '更多操作：论文' }));
  view.rerender(actions(300));
  expect(within(screen.getByRole('dialog')).getAllByRole('button')).toHaveLength(3);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: '更多操作：论文' })).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(5);
});
it('accounts for the actual action count and the exact width boundary', () => {
  expect(visibleActionCount(182, 5)).toBe(5);
  expect(visibleActionCount(181, 5)).toBe(3);
  expect(visibleActionCount(114, 3)).toBe(3);
  expect(visibleActionCount(114, 5)).toBe(2);
});
