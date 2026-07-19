// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';

import { groupSegmentsByPage, scrollToPage, scrollToSegment } from './readerUtils';

describe('groupSegmentsByPage', () => {
  it('creates independently hoverable regions for MinerU list items', () => {
    const segment: SourceSegment = {
      bbox: [100, 100, 900, 800],
      markdown: '1. First reference\n2. Second reference',
      mineru_metadata: {
        list_item_regions: JSON.stringify([
          { bbox: [110, 120, 890, 300], text: 'First reference' },
          { bbox: [110, 320, 890, 760], text: 'Second reference' },
        ]),
      },
      page_idx: 0,
      segment_type: 'list',
      text: '1. First reference\n2. Second reference',
      uid: 'list-1',
    };

    const page = groupSegmentsByPage([segment], 1)[0];
    const itemRegions = page.regions.filter((region) => region.id.includes(':list-item:'));

    expect(page.regions).toHaveLength(2);
    expect(page.regions.some((region) => region.id === 'list-1')).toBe(false);
    expect(itemRegions).toHaveLength(2);
    expect(itemRegions.map((region) => region.listItemIndex)).toEqual([0, 1]);
    expect(itemRegions[1].segment.text).toBe('Second reference');
    expect(itemRegions[1].sourceSegment.uid).toBe('list-1');
  });

  it('does not project an itemized list parent into an adjacent page', () => {
    const segment: SourceSegment = {
      bbox: [100, 800, 900, 1250],
      markdown: '1. First reference',
      mineru_metadata: {
        list_item_regions: JSON.stringify([
          { bbox: [110, 820, 890, 980], text: 'First reference' },
        ]),
      },
      page_idx: 0,
      segment_type: 'list',
      text: '1. First reference',
      uid: 'cross-page-list',
    };

    const pages = groupSegmentsByPage([segment], 2);

    expect(pages[0].regions.map((region) => region.id)).toEqual([
      'cross-page-list:list-item:0',
    ]);
    expect(pages[1].regions).toHaveLength(0);
  });

  it('renders middle-json list items on their own pages', () => {
    const segment: SourceSegment = {
      bbox: [100, 100, 900, 900],
      markdown: '[1] First reference\n[2] Second reference',
      mineru_metadata: {
        list_item_regions: JSON.stringify([
          { bbox: [110, 120, 890, 300], page_idx: 0, text: 'First reference' },
          { bbox: [110, 80, 890, 280], page_idx: 1, text: 'Second reference' },
        ]),
      },
      page_idx: 0,
      segment_type: 'list',
      text: '[1] First reference\n[2] Second reference',
      uid: 'references',
    };

    const pages = groupSegmentsByPage([segment], 2);

    expect(pages[0].regions.map((region) => region.segment.text)).toEqual(['First reference']);
    expect(pages[1].regions.map((region) => region.segment.text)).toEqual(['Second reference']);
  });
});

describe('scrollToSegment', () => {
  it('finds a list child by its source segment uid within the active reader', () => {
    const container = document.createElement('div');
    const otherReader = document.createElement('div');
    const listItem = document.createElement('div');
    const staleItem = document.createElement('div');
    listItem.dataset.segmentUid = 'list-1:list-item:0';
    listItem.dataset.sourceSegmentUid = 'list-1';
    staleItem.dataset.segmentUid = 'list-1';
    container.append(listItem);
    otherReader.append(staleItem);
    document.body.append(container, otherReader);
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(container, 'scrollLeft', { configurable: true, value: 0 });
    Object.defineProperty(container, 'scrollTop', { configurable: true, value: 0 });
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200));
    vi.spyOn(listItem, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 400, 90, 50));

    expect(scrollToSegment('list-1', container)).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    container.remove();
    otherReader.remove();
  });
});

describe('scrollToPage', () => {
  it('uses the page inside the active reader instead of an identically named hidden page', () => {
    const container = document.createElement('div');
    const activePage = document.createElement('section');
    const hiddenReader = document.createElement('div');
    const hiddenPage = document.createElement('section');
    activePage.dataset.pdfPageIndex = '4';
    activePage.id = 'pdf-page-4';
    hiddenPage.dataset.pdfPageIndex = '4';
    hiddenPage.id = 'pdf-page-4';
    container.append(activePage);
    hiddenReader.append(hiddenPage);
    document.body.append(container, hiddenReader);
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });
    Object.defineProperty(container, 'scrollLeft', { configurable: true, value: 0 });
    Object.defineProperty(container, 'scrollTop', { configurable: true, value: 0 });
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200));
    vi.spyOn(activePage, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 600, 280, 500));

    scrollToPage(4, container);

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', left: 10, top: 588 });
    container.remove();
    hiddenReader.remove();
  });
});
