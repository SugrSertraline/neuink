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

  it('hints at the manual build action when vectors need building', () => {
    render(
      <SearchIndexStatusLine
        mode="hybrid"
        status={{
          document_count: 574,
          keyword_memory_cache_ready: false,
          message: '待构建向量 · 574',
          records_fingerprint: 'abc',
          semantic_disk_cache_modified_at_ms: null,
          semantic_disk_cache_path: 'D:\\workspace\\.neuink-cache\\search\\semantic-x.vectors.json',
          semantic_disk_cache_record_count: null,
          semantic_disk_cache_ready: false,
          semantic_document_count: 574,
          semantic_memory_cache_ready: false,
          semantic_status: 'needs_build',
          scope: 'global'
        }}
      />
    );

    expect(screen.getByText(/待构建向量 · 574/).textContent).toContain('点击右侧「构建」开始');
  });

  it('describes a same-model disk cache as an incremental update', () => {
    render(
      <SearchIndexStatusLine
        mode="hybrid"
        status={{
          document_count: 743,
          keyword_memory_cache_ready: false,
          message: '待增量更新 · 已缓存 699/743',
          records_fingerprint: 'abc',
          semantic_disk_cache_modified_at_ms: 1,
          semantic_disk_cache_path: 'D:\\workspace\\.neuink-cache\\search\\semantic-x.vectors.json',
          semantic_disk_cache_record_count: 699,
          semantic_disk_cache_ready: false,
          semantic_document_count: 743,
          semantic_memory_cache_ready: false,
          semantic_status: 'needs_build',
          scope: 'global'
        }}
      />
    );

    const line = screen.getByText(/待增量更新 · 已缓存 699\/743/);
    expect(line.textContent).toContain('点击右侧「更新」补齐');
    expect(line.getAttribute('title')).toContain('仅增量计算新增或变更内容，已有缓存会直接复用');
  });
});
