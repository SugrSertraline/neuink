// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TagQuickPicker } from './TagQuickPicker';

afterEach(cleanup);

describe('TagQuickPicker', () => {
  it('renders parent and child tags with visible branch guide structures', () => {
    const onTogglePath = vi.fn();
    const view = render(
      <TagQuickPicker
        selectedPaths={[]}
        tags={[
          { id: 'research', name: '研究', parent_id: null, created_at: '', updated_at: '' },
          { id: 'hci', name: 'HCI', parent_id: 'research', created_at: '', updated_at: '' }
        ]}
        onTogglePath={onTogglePath}
      />
    );

    const branch = view.getByRole('group', { name: '研究 的子标签' });
    expect(branch.className).toContain('before:border-l');

    const child = view.getByText('HCI').closest('[data-tag-depth="1"]');
    expect(child?.className).toContain('before:border-t');

    const collapseButton = view.getByRole('button', { name: '收起 研究' });
    expect(collapseButton.getAttribute('data-slot')).toBe('button');
    expect(collapseButton.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(collapseButton);
    expect(view.queryByRole('group', { name: '研究 的子标签' })).toBeNull();

    const expandButton = view.getByRole('button', { name: '展开 研究' });
    expect(expandButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expandButton);

    fireEvent.click(view.getByText('HCI'));
    expect(onTogglePath).toHaveBeenCalledWith('研究/HCI');
  });
});
