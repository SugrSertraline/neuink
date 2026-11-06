// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FoldControls } from './FoldControls';
import type { FoldReader } from './useFoldReader';
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);
it('opens paragraph selection without generating or changing the reading level', () => {
  const start = vi.fn(() => true), change = vi.fn(), progress = vi.fn();
  const fold = { level: 'off', running: false, loadState: 'ready', start } as unknown as FoldReader;
  render(<TooltipProvider><FoldControls fold={fold} onLevelChange={change} onShowProgress={progress} /></TooltipProvider>);
  expect(screen.queryByRole('button', { name: '生成当前章节' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '阅读详略' }));
  expect(start).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled(); expect(progress).toHaveBeenCalledOnce();
});

it('opens the retained task from the toolbar while paused', () => {
  const progress = vi.fn(), resume = vi.fn();
  const fold = { level: 'key', running: true, loadState: 'ready', resume,
    task: { status: 'paused', progress: { completed: 2, failed: 0, canceledSegmentUids: [], total: 5 } } } as unknown as FoldReader;
  render(<TooltipProvider><FoldControls fold={fold} onLevelChange={vi.fn()} onShowProgress={progress} /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: '查看进度 2/5' }));
  expect(screen.getByText('已暂停')).toBeTruthy();
  expect(progress).toHaveBeenCalledOnce(); expect(resume).not.toHaveBeenCalled();
});

it.each(['full', 'off'] as const)('offers the five detail levels and can leave sentence suspension from %s', level => {
  const change = vi.fn();
  const fold = { level, running: false, loadState: 'ready' } as FoldReader;
  render(<TooltipProvider><FoldControls fold={fold} onLevelChange={change} onShowProgress={vi.fn()} /></TooltipProvider>);
  const trigger = screen.getByRole('combobox', { name: '阅读详略' });
  expect(trigger.textContent).toBe(level === 'off' ? '逐句模式' : '原文');
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.getAllByRole('option').map(item => item.textContent)).toEqual(['原文', '精简', '要点', '结论', '主题']);
  expect(screen.queryByRole('option', { name: '关闭详略' })).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: level === 'off' ? '原文' : '要点' }));
  expect(change).toHaveBeenLastCalledWith(level === 'off' ? 'full' : 'key');
});
