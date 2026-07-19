// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SearchIndexStatusLine } from './SearchIndexStatusLine';

describe('SearchIndexStatusLine', () => {
  it('shows persisted backend build progress', () => {
    render(
      <SearchIndexStatusLine
        buildStatus={{
          completed: 40,
          error: null,
          message: '正在构建全局向量索引 · 40/100',
          phase: 'embedding',
          root: 'D:\\workspace',
          scope: 'global',
          started_at_ms: 1,
          state: 'running',
          total: 100,
          updated_at_ms: 2
        }}
        mode="hybrid"
        status={null}
      />
    );

    expect(screen.getByText(/40\/100/).textContent).toContain('40%');
  });
});
