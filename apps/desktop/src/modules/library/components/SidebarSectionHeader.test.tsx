/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';

import { SidebarSectionHeader } from './SidebarSectionHeader';

describe('SidebarSectionHeader', () => {
  afterEach(() => cleanup());

  it('keeps the toggle and section action as sibling buttons', () => {
    const onToggle = vi.fn();
    const onAction = vi.fn();
    const { container } = render(
      <SidebarSectionHeader
        action={
          <Button size="xs" type="button" variant="ghost" onClick={onAction}>
            清除
          </Button>
        }
        label="标签"
        open
        onToggle={onToggle}
      />
    );

    expect(container.querySelector('button button')).toBeNull();
    const toggle = screen.getByRole('button', { name: '标签' });
    expect(toggle.getAttribute('data-variant')).toBe('plain');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.className).not.toContain('aria-expanded:bg-muted');
    expect(toggle.className).toContain('hover:bg-muted');
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onToggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '标签' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
