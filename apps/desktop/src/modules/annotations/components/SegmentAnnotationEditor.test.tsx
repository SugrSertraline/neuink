// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hasUnsavedSegmentEditors, saveSegmentEditorsBeforeClose } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Annotation, SourceSegment } from '@/shared/types/domain';

import { SegmentAnnotationEditor } from './SegmentAnnotationEditor';

afterEach(cleanup);

describe('SegmentAnnotationEditor', () => {
  it.each([false, true])('keeps annotation drafts until the actual save settles (success=%s)', async (success) => {
    let finish!: (value: boolean) => void;
    const save = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const props = { annotations: [annotation], busy: false, segment, segments: [segment], sourceEntryId: 'entry-1', workspaceRoot: null, draftScopeKey: 'entry-content:entry-1|pdf', onClose: vi.fn(), onDelete: vi.fn(), onModeChange: vi.fn(), onSave: save };
    const view = render(<SegmentAnnotationEditor {...props} />);
    fireEvent.click(screen.getByTitle('编辑批注'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved new annotation' } });
    let closing!: Promise<boolean>;
    act(() => { closing = saveSegmentEditorsBeforeClose('pdf:entry-1'); });
    // A refreshed annotation list used to be mistaken for save completion.
    view.rerender(<SegmentAnnotationEditor {...props} annotations={[{ ...annotation }]} selectedAnnotationId={annotation.annotation_id} />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Unsaved new annotation');
    expect(hasUnsavedSegmentEditors('pdf:entry-1')).toBe(true);
    await act(async () => finish(success));
    expect(await closing).toBe(success);
    if (success) await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    else {
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Unsaved new annotation');
      expect(hasUnsavedSegmentEditors('pdf:entry-1')).toBe(true);
    }
  });
  it('reports the exact selected annotation so a linked PDF can locate its text range', () => {
    const onSelectAnnotation = vi.fn();
    render(
      <SegmentAnnotationEditor
        annotations={[annotation]}
        busy={false}
        pdfDocument={null}
        segment={segment}
        segments={[segment]}
        sourceEntryId="entry-1"
        workspaceRoot={null}
        onClose={() => undefined}
        onDelete={() => undefined}
        onModeChange={() => undefined}
        onSave={() => undefined}
        onSelectAnnotation={onSelectAnnotation}
      />,
    );

    const content = screen.getByText('A useful conclusion');
    fireEvent.click(content.closest('[role="button"]') as HTMLElement);

    expect(onSelectAnnotation).toHaveBeenCalledWith(annotation);
  });

  it('keeps annotation selection keyboard accessible', () => {
    const onSelectAnnotation = vi.fn();
    render(
      <SegmentAnnotationEditor
        annotations={[annotation]}
        busy={false}
        pdfDocument={null}
        segment={segment}
        segments={[segment]}
        sourceEntryId="entry-1"
        workspaceRoot={null}
        onClose={() => undefined}
        onDelete={() => undefined}
        onModeChange={() => undefined}
        onSave={() => undefined}
        onSelectAnnotation={onSelectAnnotation}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: /A useful conclusion/ }), {
      key: 'Enter',
    });

    expect(onSelectAnnotation).toHaveBeenCalledWith(annotation);
  });
});

const segment: SourceSegment = {
  bbox: [100, 120, 900, 300],
  markdown: null,
  page_idx: 2,
  segment_type: 'paragraph',
  text: 'The source paragraph',
  uid: 'segment-1',
};

const annotation: Annotation = {
  annotation_id: 'annotation-1',
  content: 'A useful conclusion',
  created_at: '2026-09-05T00:00:00Z',
  importance: 'important',
  kind: 'highlight',
  segment_snapshot: {
    bbox: segment.bbox,
    markdown: segment.markdown,
    page_idx: segment.page_idx,
    segment_type: segment.segment_type,
    segment_uid: segment.uid,
    text: segment.text,
  },
  segment_uid: segment.uid,
  text_selection: {
    color: 'yellow',
    page_idx: 2,
    rects: [[180, 150, 520, 190]],
    text: 'source paragraph',
  },
  updated_at: '2026-09-05T00:00:00Z',
};
