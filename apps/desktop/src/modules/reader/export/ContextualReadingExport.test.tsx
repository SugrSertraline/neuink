// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadingExportScope } from '@/shared/ipc/readingExportApi';
import type { EntryTranslation } from '@/shared/ipc/workspaceApi';
import type { Annotation, SourceSegment } from '@/shared/types/domain';
import { ToastContext } from '@/shared/hooks/useToast';
import { SegmentAnnotationEditor } from '@/modules/annotations/components/SegmentAnnotationEditor';
import { SegmentNoteEditor } from '../components/pdf-reader/SegmentNoteEditor';
import { TranslationTaskDialog } from '../translation/TranslationTaskDialog';

vi.mock('./ReadingExportDialog', () => ({ ReadingExportDialog: ({ scope }: { scope: ReadingExportScope }) =>
  <output data-testid="export-scope">{JSON.stringify(scope)}</output> }));
afterEach(() => { cleanup(); localStorage.clear(); });
const segment: SourceSegment = { uid: 's2', continuation_group_id: 'group-1', page_idx: 2, bbox: null, segment_type: 'paragraph', text: 'Source', markdown: 'Source' };
const shared = { segment, sourceEntryId: 'e1', workspaceRoot: 'C:/library', busy: false, onClose: vi.fn(), onModeChange: vi.fn(), onSave: vi.fn() };
const scope = () => JSON.parse(screen.getByTestId('export-scope').textContent!);

describe('contextual reading export entrances', () => {
  it('exports a saved segment note by its logical group and blocks unsaved drafts', () => {
    const view = (dirty: boolean) => <ToastContext.Provider value={{ notify: vi.fn(), dismiss: vi.fn() }}>
      <SegmentNoteEditor {...shared} annotationCount={0} noteText="Saved note" dirty={dirty} onNoteTextChange={vi.fn()} />
    </ToastContext.Provider>;
    const { rerender } = render(view(true));
    const button = screen.getByRole<HTMLButtonElement>('button', { name: '导出当前片段笔记' });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('请先保存片段笔记再导出');
    rerender(view(false));
    fireEvent.click(button);
    expect(scope()).toEqual({ kinds: ['segment_note'], segment_uids: ['s2', 'group-1'] });
  });
  it('limits annotation export to the current segment including its continuation group', () => {
    const annotation = (id: string, uid: string): Annotation => ({ annotation_id: id, segment_uid: uid, kind: 'highlight', importance: 'normal', content: id, created_at: '', updated_at: '' });
    render(<SegmentAnnotationEditor {...shared} segments={[segment]} relatedSegmentUids={['s1', 's2']} pdfDocument={null}
      annotations={[annotation('a1', 's1'), annotation('a2', 's2'), annotation('unrelated', 's3')]} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '导出当前片段批注' }));
    expect(scope().kinds).toEqual(['annotation']);
    expect(scope().item_ids.sort()).toEqual(['annotation:a1', 'annotation:a2']);
  });
  it('offers export alongside an expanded saved translation', () => {
    localStorage.setItem('neuink.reader.segmentNote.translationCollapsed', 'false');
    render(<ToastContext.Provider value={{ notify: vi.fn(), dismiss: vi.fn() }}>
      <SegmentNoteEditor {...shared} annotationCount={0} noteText="" dirty={false} translatedText="已保存译文内容" onNoteTextChange={vi.fn()} />
    </ToastContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: '导出当前片段译文' }));
    expect(scope()).toEqual({ kinds: ['translation'], segment_uids: ['s2', 'group-1'] });
  });
  it('exports saved translations from the task dialog but disables the entrance while running or empty', () => {
    const translation: EntryTranslation = {
      entry_id: 'e1', created_at: '', updated_at: '', error: null, model: null, paper_context: null, schema_version: 1,
      source_language: 'en', target_language: 'zh', status: 'succeeded', progress: { failed: 0, skipped: 0, total: 1, translated: 1 },
      segments: [{ segment_uid: 's2', page_idx: 2, segment_type: 'paragraph', source_hash: '', source_text: 'Source', translated_text: '译文', status: 'translated', updated_at: '', error: null }]
    };
    const view = (busy: boolean, saved: EntryTranslation | null) => <TranslationTaskDialog open segments={[segment]} translation={saved}
      busy={busy} onOpenChange={vi.fn()} onTranslate={vi.fn()} exportContext={{ entryId: 'e1', entryTitle: '论文', workspaceRoot: 'C:/library' }} />;
    const { rerender } = render(view(false, null));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '导出已保存译文' }).disabled).toBe(true);
    rerender(view(true, translation));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '导出已保存译文' }).disabled).toBe(true);
    rerender(view(false, translation));
    fireEvent.click(screen.getByRole('button', { name: '导出已保存译文' }));
    expect(scope()).toEqual({ kinds: ['translation'] });
  });
});
