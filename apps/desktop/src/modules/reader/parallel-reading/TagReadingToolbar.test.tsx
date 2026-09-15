/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagReadingToolbar } from './TagReadingToolbar';

function props() {
  return {
    title: '有机合成', path: '化学 / 有机合成', compact: false,
    progress: { done: 1, total: 3, skipped: 1, unavailable: 2 }, saveStatus: '已保存',
    disabled: false, loaded: true, queueVisible: true, hasCompare: true, canFinish: true,
    viewingCompare: false, currentTitle: '论文 A', includeDescendants: true,
    onBack: vi.fn(), onQueue: vi.fn(), onCompare: vi.fn(), onFinish: vi.fn(), onSwap: vi.fn(),
    onRemoveCompare: vi.fn(), onIncludeDescendants: vi.fn(), onReload: vi.fn(),
  };
}
function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: '平行阅读设置与操作' }), { key: 'Enter' });
}

describe('TagReadingToolbar', () => {
  afterEach(cleanup);
  it('exposes explicit primary actions and the full tag path without a second header row', () => {
    const callbacks = props();
    render(<TagReadingToolbar {...callbacks} />);
    expect(screen.getByRole('heading', { name: '有机合成' }).title).toBe('化学 / 有机合成');
    expect(screen.getByTestId('tag-reading-toolbar').className).toContain('h-10');
    expect(screen.getByTestId('tag-reading-toolbar').className).not.toContain('flex-wrap');
    fireEvent.click(screen.getByRole('button', { name: '收起论文列表' }));
    fireEvent.click(screen.getByRole('button', { name: '更换对照论文' }));
    fireEvent.click(screen.getByRole('button', { name: '主读已读，下一篇' }));
    expect(callbacks.onQueue).toHaveBeenCalledOnce();
    expect(callbacks.onCompare).toHaveBeenCalledOnce();
    expect(callbacks.onFinish).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '主读已读，下一篇' }).title).toContain('论文 A');
  });
  it('does not mark a hidden main paper as read when the narrow pane displays comparison', () => {
    const callbacks = props();
    render(<TagReadingToolbar {...callbacks} compact viewingCompare queueVisible={false} />);
    const finish = screen.getByRole('button', { name: '主读已读，下一篇' });
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    expect(finish.title).toBe('请先切回主读论文，再标记已读');
    fireEvent.click(finish);
    expect(callbacks.onFinish).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '标签任务进度' })).toBeNull();
    expect(screen.getByRole('button', { name: '打开论文列表' })).toBeTruthy();
    openMenu();
    expect(screen.getByText(/已读 1 \/ 3 篇；跳过 1 篇，暂不可读 2 篇/)).toBeTruthy();
  });
  it('preserves clear scope, comparison, and reload actions in the secondary menu', () => {
    const callbacks = props();
    render(<TagReadingToolbar {...callbacks} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '包含子标签中的论文' }));
    expect(callbacks.onIncludeDescendants).toHaveBeenCalledWith(false);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '交换主读与对照论文' }));
    expect(callbacks.onSwap).toHaveBeenCalledOnce();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '取消对照，回到单篇阅读' }));
    expect(callbacks.onRemoveCompare).toHaveBeenCalledOnce();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '重新载入已保存进度' }));
    expect(callbacks.onReload).toHaveBeenCalledOnce();
  });
  it('keeps exit available while saving but disables state-changing controls', () => {
    const callbacks = props();
    render(<TagReadingToolbar {...callbacks} disabled saveStatus="保存中…" />);
    for (const name of ['收起论文列表', '更换对照论文', '主读已读，下一篇']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(screen.getByRole('button', { name: '返回条目库' }));
    expect(callbacks.onBack).toHaveBeenCalledOnce();
    openMenu();
    expect(screen.getByRole('menuitem', { name: '重新载入已保存进度' }).getAttribute('aria-disabled')).toBe('true');
  });
  it('keeps unreadable and empty loading states from offering next-paper actions', () => {
    render(<TagReadingToolbar {...props()} loaded={false} hasCompare={false} canFinish={false} progress={null} saveStatus="" />);
    expect((screen.getByRole('button', { name: '主读已读，下一篇' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '选择对照论文' }) as HTMLButtonElement).disabled).toBe(true);
    openMenu();
    expect(screen.getByRole('menuitem', { name: '交换主读与对照论文' }).getAttribute('aria-disabled')).toBe('true');
  });
});
