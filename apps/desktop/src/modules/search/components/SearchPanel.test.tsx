// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';

import { SearchPanel } from './SearchPanel';

const mocks = vi.hoisted(() => ({
  rebuildSearchIndex: vi.fn(),
  getVisualIndexStatus: vi.fn(),
  prepareVisualSearchIndex: vi.fn(),
  searchIndexStatus: {
    scope: 'global' as const,
    semantic_status: 'needs_build' as const,
    document_count: 10,
    semantic_document_count: 10,
    records_fingerprint: 'fingerprint',
    keyword_memory_cache_ready: false,
    semantic_memory_cache_ready: false,
    semantic_disk_cache_ready: false,
    semantic_disk_cache_path: 'semantic.vectors.json',
    semantic_disk_cache_record_count: null as number | null,
    semantic_disk_cache_modified_at_ms: null as number | null,
    message: '待构建向量 · 10'
  }
}));

vi.mock('@/shared/ipc/workspaceApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ipc/workspaceApi')>()),
  rebuildSearchIndex: mocks.rebuildSearchIndex,
  getVisualIndexStatus: mocks.getVisualIndexStatus,
  prepareVisualSearchIndex: mocks.prepareVisualSearchIndex
}));

vi.mock('../hooks/useEmbeddingStatus', () => ({
  useEmbeddingStatus: () => ({
    embeddingError: null,
    embeddingStatus: {
      available: true,
      provider: 'test'
    }
  })
}));

vi.mock('../hooks/useGlobalSearch', () => ({
  useGlobalSearch: () => ({
    busy: false,
    error: null,
    results: null
  })
}));

vi.mock('../hooks/useSearchIndexStatus', () => ({
  useSearchIndexStatus: () => ({
    searchIndexError: null,
    searchIndexStatus: mocks.searchIndexStatus,
    setSearchIndexError: vi.fn(),
    setSearchIndexStatus: vi.fn()
  })
}));

beforeEach(() => {
  mocks.searchIndexStatus = {
    scope: 'global',
    semantic_status: 'needs_build',
    document_count: 10,
    semantic_document_count: 10,
    records_fingerprint: 'fingerprint',
    keyword_memory_cache_ready: false,
    semantic_memory_cache_ready: false,
    semantic_disk_cache_ready: false,
    semantic_disk_cache_path: 'semantic.vectors.json',
    semantic_disk_cache_record_count: null,
    semantic_disk_cache_modified_at_ms: null,
    message: '待构建向量 · 10'
  };
  mocks.rebuildSearchIndex.mockReset();
  mocks.getVisualIndexStatus.mockReset();
  mocks.getVisualIndexStatus.mockResolvedValue({ built: false, snapshot_count: 0, updated_at_ms: null });
  mocks.prepareVisualSearchIndex.mockReset();
  mocks.prepareVisualSearchIndex.mockResolvedValue({ provider: 'qwen_local', model_name: 'model', dimensions: 2048,
    identity: 'identity', namespace: 'namespace', entry_count: 1, asset_count: 2, document_count: 3, embedded_count: 3 });
  mocks.rebuildSearchIndex.mockResolvedValue({
    rebuilt_vector_count: 10,
    status: {
      scope: 'global',
      semantic_status: 'ready_memory',
      document_count: 10,
      semantic_document_count: 10,
      records_fingerprint: 'fingerprint',
      keyword_memory_cache_ready: true,
      semantic_memory_cache_ready: true,
      semantic_disk_cache_ready: true,
      semantic_disk_cache_path: 'semantic.vectors.json',
      semantic_disk_cache_record_count: 10,
      semantic_disk_cache_modified_at_ms: 1,
      message: '向量索引已就绪'
    }
  });
});

afterEach(cleanup);

describe('SearchPanel vector build consent', () => {
  it('does not build on mount and requires the explicit confirmation action', async () => {
    render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast') }}>
        <SearchPanel
          root={'D:\\workspace'}
          status="ready"
          onOpenResult={vi.fn()}
        />
      </ToastContext.Provider>
    );

    expect(mocks.rebuildSearchIndex).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '构建' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.rebuildSearchIndex).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '开始构建' }));
    await waitFor(() => expect(mocks.rebuildSearchIndex).toHaveBeenCalledTimes(1));
    expect(mocks.rebuildSearchIndex).toHaveBeenCalledWith('D:\\workspace');
  });

  it('builds the visual index only after the explicit confirmation dialog', async () => {
    render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast') }}>
        <SearchPanel root={'D:\\workspace'} status="ready" onOpenResult={vi.fn()} />
      </ToastContext.Provider>
    );

    expect(mocks.prepareVisualSearchIndex).not.toHaveBeenCalled();
    const build = await screen.findByRole('button', { name: '构建视觉索引' });
    fireEvent.click(build);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.prepareVisualSearchIndex).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '开始构建视觉索引' }));
    await waitFor(() => expect(mocks.prepareVisualSearchIndex).toHaveBeenCalledWith('D:\\workspace'));
  });

  it('offers an incremental update when a same-model cache already exists', () => {
    mocks.searchIndexStatus = {
      ...mocks.searchIndexStatus,
      document_count: 743,
      semantic_document_count: 743,
      semantic_disk_cache_record_count: 699,
      semantic_disk_cache_modified_at_ms: 1,
      message: '待增量更新 · 已缓存 699/743'
    };

    render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast') }}>
        <SearchPanel root={'D:\\workspace'} status="ready" onOpenResult={vi.fn()} />
      </ToastContext.Provider>
    );

    expect(screen.queryByRole('button', { name: '构建' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(screen.getByText(/已有 699 条本地向量缓存，将增量补齐至 743 条/)).toBeTruthy();
    expect(screen.queryByText(/首次构建可能需要数分钟/)).toBeNull();
    expect(screen.getByRole('button', { name: '开始更新' })).toBeTruthy();
  });

  it('does not announce a successful build when the index still needs work', async () => {
    const notify = vi.fn(() => 'toast');
    mocks.rebuildSearchIndex.mockResolvedValue({
      rebuilt_vector_count: 743,
      status: {
        ...mocks.searchIndexStatus,
        document_count: 743,
        semantic_document_count: 743,
        semantic_disk_cache_record_count: 699,
        message: '待增量更新 · 已缓存 699/743'
      }
    });

    render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify }}>
        <SearchPanel root={'D:\\workspace'} status="ready" onOpenResult={vi.fn()} />
      </ToastContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: '构建' }));
    fireEvent.click(screen.getByRole('button', { name: '开始构建' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'info',
      title: '资料库在构建期间有新变更'
    }));
  });
});