// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { Link2 } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReaderEmptyState, ReaderModeSwitch } from './ReaderSurfacePrimitives';
import { EntryContentHeader } from './EntryContentHeader';

afterEach(cleanup);

describe('ReaderSurfacePrimitives', () => {
  it('keeps the page function as the title and the entry as supporting context', () => {
    const { getByText } = render(
      <EntryContentHeader contentTitle="条目概览" entryTitle="示例论文" />
    );

    expect(getByText('条目概览').className).toContain('font-semibold');
    expect(getByText('示例论文').className).toContain('text-muted-foreground');
  });

  it('uses one accessible mode switch for notes and annotations', () => {
    const onValueChange = vi.fn();
    const { getByRole } = render(
      <ReaderModeSwitch
        items={[
          { label: '片段笔记', value: 'segment' },
          { badge: 2, label: '批注', value: 'annotation' }
        ]}
        value="segment"
        onValueChange={onValueChange}
      />
    );

    expect(getByRole('tab', { name: '片段笔记' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(getByRole('tab', { name: '批注 2' }));
    expect(onValueChange).toHaveBeenCalledWith('annotation');
  });

  it('renders a consistent title and next-step description for empty content', () => {
    const { getByText } = render(
      <ReaderEmptyState
        description="在阅读视图中插入来源后，会显示在这里。"
        icon={Link2}
        title="暂无来源链接"
      />
    );

    expect(getByText('暂无来源链接')).toBeTruthy();
    expect(getByText('在阅读视图中插入来源后，会显示在这里。')).toBeTruthy();
  });
});
