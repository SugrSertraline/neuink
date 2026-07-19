// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./SearchResultPreview', () => ({
  SearchResultPreview: () => <div>搜索预览内容</div>
}));

import { Command } from '@/components/ui/command';
import type { SearchResults } from '@/shared/ipc/workspaceApi';

import { SearchResultList } from './SearchResultList';

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserverMock {
    disconnect() {}
    observe() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = () => undefined;
});

describe('SearchResultList hover preview', () => {
  afterEach(() => document.body.replaceChildren());

  it('opens the preview from a native hover trigger around the command item', async () => {
    render(
      <Command>
        <SearchResultList
          hoverPreviewEnabled
          results={results()}
          root="C:/workspace"
          onOpenResult={vi.fn()}
        />
      </Command>
    );

    fireEvent.pointerEnter(
      document.querySelector<HTMLElement>('[data-slot="hover-card-trigger"]')!,
    );

    expect(await screen.findByText('搜索预览内容')).toBeTruthy();
  });
});

function results(): SearchResults {
  return {
    entries: [{
      entry_id: 'entry-1',
      entry_title: 'Paper',
      hit_count: 1,
      hits: [{
        entry_id: 'entry-1',
        entry_title: 'Paper',
        matched_terms: ['agent'],
        score: 1,
        snippet: 'Agent evidence',
        source: { field_name: null, kind: 'entry_title', label: 'Entry', note_id: null, page_idx: null, segment_uid: null, tag_id: null },
        target: { entry_id: 'entry-1', kind: 'entry' },
        title: 'Paper'
      }],
      max_score: 1
    }],
    index_generation: 1,
    mode: 'keyword',
    query: 'agent',
    total_hit_count: 1,
    warnings: []
  };
}
