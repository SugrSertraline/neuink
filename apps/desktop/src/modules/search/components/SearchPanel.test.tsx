// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';

import { SearchPanel } from './SearchPanel';

const mocks = vi.hoisted(() => ({
  rebuildSearchIndex: vi.fn()
}));

vi.mock('@/shared/ipc/workspaceApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ipc/workspaceApi')>()),
  rebuildSearchIndex: mocks.rebuildSearchIndex
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
    searchIndexStatus: {
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
    },
    setSearchIndexError: vi.fn(),
    setSearchIndexStatus: vi.fn()
  })
}));

beforeEach(() => {
  mocks.rebuildSearchIndex.mockReset();
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
});
