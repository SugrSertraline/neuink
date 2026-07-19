// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EntryTagBadges } from './EntryTagBadges';

afterEach(cleanup);

describe('EntryTagBadges', () => {
  it('keeps the table cell compact while exposing the complete tag count', () => {
    const { container, getByRole, getByText, queryByText } = render(
      <EntryTagBadges tags={[
        '研究/人工智能/智能体',
        '方法/工具调用',
        '论文/综述',
        '状态/重点'
      ]} />
    );

    expect(getByRole('button', { name: '查看全部 4 个标签' })).toBeTruthy();
    expect(getByText('智能体')).toBeTruthy();
    expect(getByText('工具调用')).toBeTruthy();
    expect(getByText('+2')).toBeTruthy();
    expect(container.querySelector('.entry-tag-badges')).toBeTruthy();
    expect(container.querySelector('.entry-tag-narrow-count')?.textContent).toBe('+3');
    expect(container.querySelector('.entry-tag-compact-count')?.textContent).toContain('4');
    expect(queryByText('综述')).toBeNull();
  });

  it('renders a neutral empty state without a hover trigger', () => {
    const { getByText, queryByRole } = render(<EntryTagBadges tags={[]} />);

    expect(getByText('无标签')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });
});
