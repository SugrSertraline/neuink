// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssistantComposerTargetPicker, type ComposerPickerItem } from './AssistantComposerTargetPicker';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(224);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(384);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('chooses type first, searches within that type, then returns the chosen content', () => {
  const items: ComposerPickerItem<string>[] = [
    { id: 'tag:methods', kind: 'tag', label: '方法', description: '标签范围', searchText: '方法', value: 'tag:methods' },
    { id: 'entry:paper', kind: 'entry', label: '论文 A', description: '论文 A', searchText: '论文 A', value: 'entry:paper' },
    { id: 'pdf:paper', kind: 'pdf', label: 'paper.pdf', description: '论文 A', searchText: 'paper.pdf 论文 A', value: 'pdf:paper' },
    { id: 'note:paper', kind: 'note', label: '读书笔记', description: '论文 A', searchText: '读书笔记 论文 A', value: 'note:paper' }
  ];
  const onSelect = vi.fn();
  render(<AssistantComposerTargetPicker items={items} disabled={false} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: '选择上下文' }));
  expect(screen.getByRole('option', { name: /方法/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索所选类型' }), { target: { value: 'paper' } });
  expect(screen.getByRole('option', { name: /paper.pdf/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /读书笔记/ })).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: /paper.pdf/ }));
  expect(onSelect).toHaveBeenCalledWith('pdf:paper');
});
