// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';

import {
  groupSegmentsByPage,
  scrollToPage,
  scrollToPdfRect,
  scrollToSegment,
} from './readerUtils';

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

  it('synthesizes a caption hit strip below its visual-group figure', () => {
    const figure: SourceSegment = {
      asset_path: 'images/figure.jpg',
      bbox: [125, 226, 874, 381],
      markdown: null,
      page_idx: 0,
      raw_type: 'image',
      segment_type: 'figure',
      text: '```mermaid\ngraph TD\n```',
      uid: 'figure-1',
      visual_group_id: 'visual-image-p0',
    };
    const caption: SourceSegment = {
      asset_path: 'images/figure.jpg',
      bbox: null,
      block_role: 'caption',
      markdown: null,
      page_idx: 0,
      raw_type: 'image',
      segment_type: 'paragraph',
      text: 'Figure 1: demo caption',
      uid: 'figure-1-caption',
      visual_group_id: 'visual-image-p0',
    };
    const bodyBelow: SourceSegment = {
      bbox: [53, 440, 947, 520],
      markdown: null,
      page_idx: 0,
      segment_type: 'paragraph',
      text: 'Body text under the figure.',
      uid: 'body-1',
    };

    const page = groupSegmentsByPage([figure, caption, bodyBelow], 1)[0];
    const captionRegion = page.regions.find((region) => region.id === 'figure-1-caption');

    expect(captionRegion).toBeDefined();
    expect(captionRegion?.bbox).toEqual([125, 381, 874, 440]);
    expect(captionRegion?.sourceSegment.text).toBe('Figure 1: demo caption');
    // 同组命中：hover 题注时图片区域一起高亮
    expect(captionRegion?.hoverGroupUid).toBe(
      page.regions.find((region) => region.id === 'figure-1')?.hoverGroupUid,
    );
  });

  it('synthesizes a table caption strip above the table body', () => {
    const table: SourceSegment = {
      bbox: [93, 103, 470, 247],
      markdown: null,
      page_idx: 0,
      raw_type: 'table',
      segment_type: 'table',
      text: '| a | b |',
      uid: 'table-1',
      visual_group_id: 'visual-table-p0',
    };
    const caption: SourceSegment = {
      bbox: null,
      block_role: 'caption',
      markdown: null,
      page_idx: 0,
      raw_type: 'table',
      segment_type: 'paragraph',
      text: 'Table 1: demo caption',
      uid: 'table-1-caption',
      visual_group_id: 'visual-table-p0',
    };
    const headerAbove: SourceSegment = {
      bbox: [53, 0, 947, 60],
      markdown: null,
      page_idx: 0,
      segment_type: 'page_header',
      text: 'Header',
      uid: 'header-1',
    };

    const page = groupSegmentsByPage([table, caption, headerAbove], 1)[0];
    const captionRegion = page.regions.find((region) => region.id === 'table-1-caption');

    expect(captionRegion?.bbox).toEqual([93, 60, 470, 103]);
  });

  it('skips caption synthesis when no visual-group anchor has a bbox', () => {
    const caption: SourceSegment = {
      bbox: null,
      block_role: 'caption',
      markdown: null,
      page_idx: 0,
      raw_type: 'image',
      segment_type: 'paragraph',
      text: 'Figure 9: orphan caption',
      uid: 'orphan-caption',
      visual_group_id: 'visual-image-orphan',
    };

    const page = groupSegmentsByPage([caption], 1)[0];

    expect(page.regions).toHaveLength(0);
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
  it.each([1, 1.25])('positions the page below a floating toolbar at %sx UI scale', (scale) => {
    const container=document.createElement('div'), page=document.createElement('section');
    page.dataset.pdfPageIndex='1'; container.append(page); document.body.append(container);
    container.style.scrollPaddingTop='104px';
    Object.defineProperty(container,'clientHeight',{value:484});
    Object.defineProperty(container,'offsetHeight',{value:500});
    const scrollTo=vi.fn(); Object.defineProperty(container,'scrollTo',{value:scrollTo});
    vi.spyOn(container,'getBoundingClientRect').mockReturnValue(new DOMRect(0,20,500*scale,500*scale));
    vi.spyOn(page,'getBoundingClientRect').mockReturnValue(new DOMRect(0,20+800*scale,480*scale,600*scale));
    expect(scrollToPage(1,container)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({behavior:'auto',top:696});
    container.remove();
  });
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

    expect(scrollToPage(4, container)).toBe(true);

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 588 });
    container.remove();
    hiddenReader.remove();
  });
});

describe('scrollToPdfRect', () => {
  it('centers a persisted normalized selection inside the active PDF reader', () => {
    const container = document.createElement('div');
    const page = document.createElement('section');
    const surface = document.createElement('div');
    page.dataset.pdfPageIndex = '2';
    surface.dataset.pdfPageSurface = 'true';
    page.append(surface);
    container.append(page);
    document.body.append(container);
    const scrollTo = vi.fn();
    Object.defineProperties(container, {
      clientHeight: { configurable: true, value: 200 },
      clientWidth: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, value: 40 },
      scrollTop: { configurable: true, value: 100 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 300, 200),
    );
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(20, 500, 400, 600),
    );

    expect(scrollToPdfRect(2, [250, 400, 450, 500], container)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({
      behavior: 'smooth',
      left: 50,
      top: 794,
    });
    // A source citation targets the visible area below the floating toolbar.
    container.style.scrollPaddingTop = '80px';
    scrollToPdfRect(2, [250, 400, 450, 500], container);
    expect(scrollTo).toHaveBeenLastCalledWith({behavior:'smooth',left:50,top:744.4});
    container.remove();
  });

  it('does not scroll when the requested page is outside this reader', () => {
    const container = document.createElement('div');
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });

    expect(scrollToPdfRect(8, [100, 100, 200, 200], container)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
