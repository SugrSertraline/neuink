// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SegmentRegion, buildPreviewLayout } from './SegmentRegion';

describe('PDF segment preview layout', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('Use the deterministic text-layout fallback in this test.');
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    { item: 'Second source item', source: '- First source item\n- Second source item', translated: '- 第一项译文\n- 第二项译文', expected: '第二项译文', absent: '第一项译文' },
    { item: '[17] S. K. McGrath, Stakeholder defined', source: '[3] G. Lucassen, User stories\n[17] S. K. McGrath, Stakeholder defined', translated: '[17] 利益相关者的定义\n[3] 用户故事的使用', expected: '[17] 利益相关者的定义', absent: '用户故事的使用' },
    { item: 'S. K. McGrath, Stakeholder defined', source: '[17] S. K. McGrath, Stakeholder defined\n[3] G. Lucassen, User stories', translated: '[17] 利益相关者的定义\n[3] 用户故事的使用', expected: '[17] 利益相关者的定义', absent: '用户故事的使用' },
  ])('shows the translation matching the hovered source: $item', async ({ item, source, translated, expected, absent }) => {
    render(
      <SegmentRegion
        active
        flashed={false}
        hasAnnotation={false}
        hasNote={false}
        hovered
        isContinuation={false}
        listItemIndex={1}
        pageIdx={0}
        previewPosition={{ x: 120, segmentTop: 120, segmentBottom: 120 }}
        previewShowOriginal={false}
        previewShowNote={false}
        previewShowAnnotation={false}
        previewShowRegion
        previewShowTranslation
        previewNote={null}
        previewAnnotations={[]}
        regionBbox={[100, 320, 900, 500]}
        regionId="list-1:list-item:1"
        relatedImagePath={null}
        segment={{
          bbox: [100, 320, 900, 500],
          markdown: item,
          mineru_metadata: {
            list_item_regions: JSON.stringify([
              { bbox: [100, 320, 900, 500], text: item },
            ]),
          },
          page_idx: 0,
          segment_type: 'list',
          text: item,
          uid: 'list-1:list-item:1',
        }}
        showRegions={false}
        sourceBacklinkCount={0}
        sourceEntryId="entry-1"
        translatedSegment={{
          error: null,
          page_idx: 0,
          segment_type: 'list',
          segment_uid: 'list-1',
          source_hash: 'hash',
          source_text: source,
          status: 'translated',
          translated_text: translated,
          updated_at: '2026-07-17T00:00:00Z',
        }}
        translationMode="hover"
        translationStatus="succeeded"
        translationVisible
        workspaceRoot={null}
        onToggleSegment={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.body.textContent).toContain(expected);
    });
    expect(document.body.textContent).not.toContain(absent);
  });

  it('shows the saved note and annotations when their preview sections are enabled', async () => {
    render(
      <SegmentRegion
        active
        flashed={false}
        hasAnnotation
        hasNote
        hovered
        isContinuation={false}
        pageIdx={0}
        previewAnnotations={[
          {
            annotation_id: 'annotation-1',
            content: 'Note and annotation preview content',
            created_at: '2026-07-17T00:00:00Z',
            importance: 'important',
            kind: 'question',
            segment_uid: 'segment-1',
            updated_at: '2026-07-17T00:00:00Z'
          }
        ]}
        previewNote="Saved segment note preview content"
        previewPosition={{ x: 120, segmentTop: 120, segmentBottom: 120 }}
        previewShowAnnotation
        previewShowNote
        previewShowOriginal={false}
        previewShowRegion
        previewShowTranslation={false}
        regionBbox={[100, 320, 900, 500]}
        regionId="segment-1"
        relatedImagePath={null}
        segment={{
          bbox: [100, 320, 900, 500],
          markdown: 'Source paragraph',
          page_idx: 0,
          segment_type: 'paragraph',
          text: 'Source paragraph',
          uid: 'segment-1'
        }}
        showRegions={false}
        sourceBacklinkCount={0}
        sourceEntryId="entry-1"
        translatedSegment={null}
        translationMode="hover"
        translationStatus={null}
        translationVisible={false}
        workspaceRoot={null}
        onToggleSegment={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(document.body.textContent).toContain('Saved segment note preview content');
    });
    expect(document.body.textContent).toContain('Note and annotation preview content');
  });

  it('keeps expanded corner indicators fully outside the selectable segment text', () => {
    render(
      <SegmentRegion
        active
        flashed={false}
        hasAnnotation
        hasNote
        hovered
        isContinuation={false}
        pageIdx={0}
        previewAnnotations={[]}
        previewNote="Saved note"
        previewPosition={null}
        previewShowAnnotation
        previewShowNote
        previewShowOriginal={false}
        previewShowRegion
        previewShowTranslation={false}
        regionBbox={[100, 320, 900, 500]}
        regionId="segment-corners"
        relatedImagePath={null}
        segment={{
          bbox: [100, 320, 900, 500],
          markdown: 'Selectable text',
          page_idx: 0,
          segment_type: 'paragraph',
          text: 'Selectable text',
          uid: 'segment-corners'
        }}
        showRegions={false}
        sourceBacklinkCount={1}
        sourceEntryId="entry-1"
        translatedSegment={null}
        translationMode="hover"
        translationStatus={null}
        translationVisible={false}
        workspaceRoot={null}
        onAddSourceLink={vi.fn()}
        onToggleSegment={vi.fn()}
      />
    );

    expect(document.querySelector('[title="片段笔记"]')?.className).toContain('-translate-x-full');
    expect(document.querySelector('[title="批注"]')?.className).toContain('translate-x-full');
    expect(document.querySelector('[title="1 个笔记引用"]')?.className).toContain('-translate-x-full');
  });

  it('uses a single click only to select the segment', () => {
    const onToggleSegment = vi.fn();
    const { container } = render(
      <SegmentRegion
        active={false}
        flashed={false}
        hasAnnotation={false}
        hasNote={false}
        hovered={false}
        isContinuation={false}
        pageIdx={0}
        previewAnnotations={[]}
        previewNote={null}
        previewPosition={null}
        previewShowAnnotation={false}
        previewShowNote={false}
        previewShowOriginal={false}
        previewShowRegion={false}
        previewShowTranslation={false}
        regionBbox={[100, 320, 900, 500]}
        regionId="double-click-segment"
        relatedImagePath={null}
        segment={{
          bbox: [100, 320, 900, 500],
          markdown: 'Source paragraph',
          page_idx: 0,
          segment_type: 'paragraph',
          text: 'Source paragraph',
          uid: 'double-click-segment'
        }}
        showRegions={true}
        sourceBacklinkCount={0}
        sourceEntryId="entry-1"
        translatedSegment={null}
        translationMode="hover"
        translationStatus={null}
        translationVisible={false}
        workspaceRoot={null}
        onToggleSegment={onToggleSegment}
      />
    );

    fireEvent.click(container.querySelector('[data-segment-uid="double-click-segment"]')!);
    expect(onToggleSegment).toHaveBeenCalledWith(expect.objectContaining({ uid: 'double-click-segment' }));
  });

  it('tracks pointer movement while there is room beside it', () => {
    const first = buildPreviewLayout({
      hasFooter: false,
      position: { x: 80, segmentTop: 80, segmentBottom: 80 },
      preferScrollable: true,
      text: 'short list item',
    });
    const moved = buildPreviewLayout({
      hasFooter: false,
      position: { x: 120, segmentTop: 110, segmentBottom: 110 },
      preferScrollable: true,
      text: 'short list item',
    });

    expect(moved.left - first.left).toBe(40);
    expect(moved.top - first.top).toBe(30);
  });

  it('flips to the near side of the pointer at the viewport edges', () => {
    const layout = buildPreviewLayout({
      hasFooter: false,
      position: { x: 920, segmentTop: 720, segmentBottom: 720 },
      preferScrollable: true,
      text: 'short list item',
    });

    expect(layout.left + layout.width).toBe(912);
    expect(layout.top).toBeLessThan(720);
  });

  it('applies independent font and card size preferences', () => {
    const compact = buildPreviewLayout({
      fontSize: 'small',
      hasFooter: false,
      position: { x: 80, segmentTop: 80, segmentBottom: 80 },
      preferScrollable: true,
      size: 'compact',
      text: 'preview text'
    });
    const large = buildPreviewLayout({
      fontSize: 'large',
      hasFooter: false,
      position: { x: 80, segmentTop: 80, segmentBottom: 80 },
      preferScrollable: true,
      size: 'large',
      text: 'preview text'
    });

    expect(compact.width).toBeLessThan(large.width);
    expect(Number(compact.contentStyle.fontSize)).toBeLessThan(
      Number(large.contentStyle.fontSize)
    );
  });
});
