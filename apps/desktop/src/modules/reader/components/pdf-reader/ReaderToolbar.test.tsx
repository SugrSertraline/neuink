/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReaderToolbar } from './ReaderToolbar';

describe('ReaderToolbar', () => {
  it('keeps the content title with compact reader metadata', () => {
    const onOpenTranslationTask = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    render(
      <ReaderToolbar
        entry={{
          id: 'entry-1',
          contents: [],
          title: '相对论笔记',
          tagIds: [],
          tags: [],
          fields: {},
          createdAt: '',
          updatedAt: '',
          pdfFileName: 'einstein-paper.pdf',
          parseMessage: null,
          parseEndpoint: null,
          status: 'Parsed',
          progress: 100
        }}
        hasRetryableFailures={false}
        pageCount={12}
      readerPreferences={{
        autoTranslateTextSelection: false,
          closeSegmentOverlayOnBlankClick: true,
          closeSegmentOverlayOnSameSegmentClick: true,
          hoverPreviewEnabled: true,
          hoverPreviewShowAnnotation: true,
          hoverPreviewShowNote: true,
          hoverPreviewShowOriginal: true,
          hoverPreviewShowRegion: true,
          hoverPreviewShowTranslation: true,
      leftClickOpensNotePane: true,
      segmentNoteOpenGesture: 'single',
          reflowHoverSourceEnabled: true,
          reflowTranslationMode: 'source',
          showRegions: false
        }}
        recommendedTags={[]}
        segmentCount={86}
        selectedRecommendedTagPaths={[]}
        tagSuggestionBusy={false}
        tagSuggestionsOpen={false}
        translation={null}
        translationBusy={false}
        zoom={1}
        onApplyRecommendedTags={() => {}}
        onDismissRecommendedTags={() => {}}
        onExportTranslation={() => {}}
        onOpenTranslationTask={onOpenTranslationTask}
        onPauseTranslation={() => {}}
        onReaderPreferencesChange={() => {}}
        onRecommendedTagToggle={() => {}}
        onRetryFailedTranslation={() => {}}
        onTagSuggestionsOpenChange={() => {}}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
      />
    );

    expect(screen.getByText('PDF 内容')).toBeTruthy();
    expect(screen.getByText('相对论笔记')).toBeTruthy();
    expect(screen.getByText('einstein-paper.pdf')).toBeTruthy();
    expect(screen.getByText('86 个区域')).toBeTruthy();
    expect(screen.getByText('12 页')).toBeTruthy();
    expect(screen.getByText('已解析')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '翻译任务' }));
    fireEvent.click(screen.getByTitle('缩小'));
    fireEvent.click(screen.getByTitle('放大'));
    expect(onOpenTranslationTask).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
  });
});
