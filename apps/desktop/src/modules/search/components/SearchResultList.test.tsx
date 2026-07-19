// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Command } from '@/components/ui/command';
import type { SearchResults } from '@/shared/ipc/workspaceApi';

import { SearchResultList } from './SearchResultList';

afterEach(cleanup);
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserverMock {
    disconnect() {}
    observe() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = () => undefined;
});

describe('SearchResultList', () => {
  it('owns vertical scrolling without inheriting the sidebar overflow lock', () => {
    const { container } = render(
      <Command>
        <SearchResultList
          className="h-full"
          hoverPreviewEnabled={false}
          results={results()}
          root="C:/workspace"
          onOpenResult={() => undefined}
        />
      </Command>
    );

    const list = container.querySelector('[data-slot="command-list"]');
    expect(list?.className).toContain('min-h-0');
    expect(list?.className).toContain('overflow-y-scroll');
    expect(list?.className).toContain('overscroll-contain');
    expect(list?.className).toContain('search-result-scrollbar');
    expect(list?.className).not.toContain('side-body');
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
        source: {
          field_name: null,
          kind: 'entry_title',
          label: 'Entry',
          note_id: null,
          page_idx: null,
          segment_uid: null,
          tag_id: null
        },
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
