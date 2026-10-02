// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadingSelectionToolbarControls } from './ReadingSelectionToolbarControls';

afterEach(cleanup);
describe('ReadingSelectionToolbarControls', () => {
  it('shows all real actions in demonstration mode without invoking any provided handlers', () => {
    const action = vi.fn();
    render(<ReadingSelectionToolbarControls text="Source text" demonstration
      onClose={action} onAsk={action} onAnnotate={action} onHighlight={action} onTranslate={action} onCopy={action} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button.hasAttribute('disabled')).toBe(true);
      fireEvent.click(button);
    }
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText('演示 · 不执行操作')).toBeTruthy();
    expect(screen.queryByRole('button', { name:'关闭选区工具' })).toBeNull();
  });

  it('does not expose unavailable real reader actions', () => {
    render(<ReadingSelectionToolbarControls text="Source text" />);
    expect(screen.getByRole('button', { name:'翻译' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name:'提问' })).toBeNull();
    expect(screen.queryByRole('button', { name:'高亮并批注' })).toBeNull();
  });
});
