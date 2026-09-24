/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParagraphTranslationProvider, useParagraphTranslation } from './ParagraphTranslationContext';
import { ParagraphTranslationActions, ParagraphTranslationContent } from './ParagraphTranslationControls';
import { SegmentActionMenu } from '../pdf-reader/SegmentActionMenu';
import * as api from '@/shared/ipc/paragraphTranslationApi';
import type { SourceSegment } from '@/shared/types/domain';

const { notify, listen } = vi.hoisted(() => ({ notify: vi.fn(), listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify }) }));
vi.mock('@/shared/ipc/paragraphTranslationApi', () => ({ readParagraphTranslations: vi.fn(), translateParagraph: vi.fn(), setParagraphTranslationView: vi.fn() }));
vi.mock('@/shared/components/SourceSnapshotPreview', () => ({ SourceSnapshotPreview: ({ markdown }: { markdown: string }) => <div>{markdown}</div> }));
const segment: SourceSegment = { uid: 'p1', segment_type: 'paragraph', page_idx: 0, bbox: null, markdown: null, text: 'First sentence. Second sentence.' };
const noop = () => undefined;
function sendProgress(patch: Partial<api.ParagraphLiveProgress> = {}) {
  const callback = listen.mock.calls.find(([name]) => name === 'neuink://paragraph-translation-progress')?.[1];
  const payload: api.ParagraphLiveProgress = { root: 'root', entry_id: 'entry', segment_uid: 'p1', job_id: 'job', source_hash: 'hash',
    part: 'paragraph', phase: 'generating', sequence: 1, retry_after_ms: null, paragraph: '正在出现的译文', sentences: [],
    sources: ['First sentence.', 'Second sentence.'], timing: { queued_ms: 10, rate_limit_ms: 0, generation_ms: 100, total_ms: 110 }, ...patch };
  act(() => callback({ payload }));
}
function refreshJob() {
  const callback = listen.mock.calls.find(([name]) => name === 'neuink://job-event')?.[1];
  act(() => callback({ payload: { job: { kind: 'paragraph_translation', scope: { kind: 'entry', root: 'root', entry_id: 'entry' } } } }));
}
function record(): api.ParagraphTranslation {
  return { segment_uid: 'p1', source_text: segment.text, source_hash: 'hash', job_id: 'job', model: 'model', view: 'sentences',
    paragraph: { status: 'succeeded', value: '完整的段落译文。', error: null },
    sentences: { status: 'succeeded', value: [{ id: 1, source: 'First sentence.', translation: '第一句。' }, { id: 2, source: 'Second sentence.', translation: '第二句。' }], error: null } };
}
function Surface({ source = segment }: { source?: SourceSegment }) {
  const { record } = useParagraphTranslation(source);
  return <><ParagraphTranslationActions segment={source} close={noop} />{record ? <ParagraphTranslationContent record={record} entryId="entry" root="root" /> : <p>原文待翻译</p>}</>;
}
const wrap = (entryId = 'entry', source = segment) => <ParagraphTranslationProvider root="root" entryId={entryId}><Surface source={source} /></ParagraphTranslationProvider>;

describe('paragraph translation', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.readParagraphTranslations).mockResolvedValue({}); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('waits for persisted data and deduplicates repeated submissions', async () => {
    let resolve!: (value: api.ParagraphTranslation) => void;
    vi.mocked(api.translateParagraph).mockImplementation(() => new Promise(done => { resolve = done; }));
    render(wrap());
    const button = screen.getByRole('menuitem', { name: '翻译此段' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    fireEvent.click(button); fireEvent.click(button);
    expect(api.translateParagraph).toHaveBeenCalledExactlyOnceWith('root', 'entry', 'p1', false);
    const running = record(); running.paragraph.status = 'running'; running.sentences.status = 'running';
    await act(async () => resolve(running));
    expect(screen.getByRole('menuitem', { name: '正在翻译此段…' }).hasAttribute('disabled')).toBe(true);
  });
  it('renders sentence pairs inside one paragraph and switches cached views without translating', async () => {
    const saved = record();
    vi.mocked(api.readParagraphTranslations).mockResolvedValue({ p1: saved });
    vi.mocked(api.setParagraphTranslationView).mockResolvedValue({ ...saved, view: 'paragraph' });
    const { container } = render(wrap());
    await screen.findByText('第一句。');
    expect(container.querySelectorAll('[data-paragraph-translation]')).toHaveLength(1);
    expect(container.querySelectorAll('[lang]')).toHaveLength(4);
    expect(container.querySelector('[lang="en"]')?.nextElementSibling?.textContent).toBe('第一句。');
    fireEvent.click(screen.getByRole('menuitemradio', { name: '整段对照' }));
    await screen.findByText('完整的段落译文。');
    expect(api.setParagraphTranslationView).toHaveBeenCalledExactlyOnceWith('root', 'entry', 'p1', 'paragraph');
    expect(api.translateParagraph).not.toHaveBeenCalled();
    expect(screen.queryByText('第一句。')).toBeNull();
    expect(screen.getByRole('menuitemradio', { name: '整段对照' }).getAttribute('aria-checked')).toBe('true');
  });
  it('shows each request status and offers failed-only retry without losing completed output', async () => {
    const saved = record(); saved.view = 'paragraph'; saved.sentences = { status: 'failed', value: null, error: '模拟断网' };
    vi.mocked(api.readParagraphTranslations).mockResolvedValue({ p1: saved });
    vi.mocked(api.translateParagraph).mockResolvedValue({ ...saved, sentences: { ...saved.sentences, status: 'running', error: null } });
    render(wrap());
    await screen.findByText('完整的段落译文。');
    expect(screen.getByRole('status').textContent).toContain('逐句翻译失败：模拟断网');
    expect(screen.getByRole('menuitem', { name: '补充逐句翻译' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '重试失败的翻译' }));
    await waitFor(() => expect(api.translateParagraph).toHaveBeenCalledExactlyOnceWith('root', 'entry', 'p1', true));
    expect(screen.getByText('完整的段落译文。')).toBeTruthy();
  });
  it('starts only missing work before persisting sentence view from the paragraph menu', async () => {
    const saved = record(); saved.view = 'paragraph'; saved.sentences = { status: 'failed', value: null, error: '未完成' };
    const running = { ...saved, sentences: { ...saved.sentences, status: 'running' as const, error: null } };
    vi.mocked(api.readParagraphTranslations).mockResolvedValue({ p1: saved });
    vi.mocked(api.translateParagraph).mockResolvedValue(running);
    vi.mocked(api.setParagraphTranslationView).mockResolvedValue({ ...running, view: 'sentences' });
    render(wrap()); await screen.findByText('完整的段落译文。');
    fireEvent.click(screen.getByRole('menuitemradio', { name: '逐句对照' }));
    await waitFor(() => expect(api.setParagraphTranslationView).toHaveBeenCalledExactlyOnceWith('root', 'entry', 'p1', 'sentences'));
    expect(api.translateParagraph).toHaveBeenCalledExactlyOnceWith('root', 'entry', 'p1', true);
  });
  it('hides stale results after source edits and excludes non-paragraph blocks', async () => {
    vi.mocked(api.readParagraphTranslations).mockResolvedValue({ p1: record() });
    const { rerender } = render(wrap());
    await screen.findByText('第一句。');
    rerender(wrap('entry', { ...segment, text: 'Changed.' }));
    expect(screen.queryByText('第一句。')).toBeNull();
    expect(screen.getByRole('menuitem', { name: '翻译此段' })).toBeTruthy();
    rerender(wrap('entry', { ...segment, segment_type: 'heading' }));
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
  it('ignores an old entry response after switching readers', async () => {
    let resolve!: (value: api.ParagraphTranslation) => void;
    vi.mocked(api.translateParagraph).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { rerender } = render(wrap());
    await waitFor(() => expect(screen.getByRole('menuitem').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('menuitem'));
    rerender(wrap('other-entry'));
    await act(async () => resolve(record()));
    expect(screen.queryByText('第一句。')).toBeNull();
    expect(screen.getByText('原文待翻译')).toBeTruthy();
  });
  it('reports repeated read failure once while retrying and recovers', async () => {
    vi.useFakeTimers();
    vi.mocked(api.readParagraphTranslations).mockRejectedValue(new Error('disk unavailable'));
    render(wrap());
    await act(async () => undefined);
    await act(async () => { await vi.advanceTimersByTimeAsync(3600); });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menuitem').hasAttribute('disabled')).toBe(true);
    vi.mocked(api.readParagraphTranslations).mockResolvedValue({});
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(screen.getByRole('menuitem').hasAttribute('disabled')).toBe(false);
  });
  it('supports keyboard menu navigation and scrolling without closing the menu', () => {
    const close = vi.fn();
    render(<SegmentActionMenu canAddSourceLink={false} canCopyContent={false} canCopySourceLink={false} position={{ x: 300, y: 450 }} segment={segment} sourceBacklinks={[]}
      onOpenSegmentAnnotation={noop} onOpenSegmentNote={noop} onOpenSourceBacklink={noop} onClose={close}
      translationActions={<><button role="menuitem">翻译此段</button><button role="menuitemradio">逐句对照</button></>} />);
    const menu = screen.getByRole('menu');
    expect(document.activeElement?.textContent).toBe('编辑片段笔记（浮窗）');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('逐句对照');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('翻译此段');
    fireEvent.scroll(menu); expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
  });
  it('shows partial paragraph text, ignores stale events and clears a failed attempt preview', async () => {
    const saved = record(); saved.view = 'paragraph'; saved.paragraph.status = 'running';
    vi.mocked(api.readParagraphTranslations).mockResolvedValue({ p1: saved });
    render(wrap()); await screen.findByText('完整的段落译文。');
    sendProgress();
    expect(screen.getByText('正在出现的译文')).toBeTruthy();
    expect(screen.getByText(segment.text)).toBeTruthy();
    sendProgress({ job_id: 'old-job', paragraph: '旧任务错误内容', sequence: 50 });
    sendProgress({ paragraph: '过时顺序', sequence: 0 });
    expect(screen.queryByText('旧任务错误内容')).toBeNull(); expect(screen.queryByText('过时顺序')).toBeNull();
    sendProgress({ sequence: 2, paragraph: null, phase: 'queued' });
    expect(screen.queryByText('正在出现的译文')).toBeNull();
    expect(screen.getByText('完整的段落译文。')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('整段排队中');
    sendProgress({ sequence: 3, phase: 'rate_limited', paragraph: null, retry_after_ms: 2000 });
    expect(screen.getByRole('status').textContent).toContain('限流等待');
    sendProgress({ sequence: 4, paragraph: '未校验的临时内容' });
    vi.mocked(api.readParagraphTranslations).mockResolvedValue({ p1: { ...saved, paragraph: { ...saved.paragraph, status: 'failed', error: '模拟失败' } } });
    refreshJob();
    await waitFor(() => expect(screen.queryByText('未校验的临时内容')).toBeNull());
    expect(screen.getByText('完整的段落译文。')).toBeTruthy();
  });
  it('shows complete pairs progressively while retaining untranslated originals and cached view switching', async () => {
    const saved = record(); saved.sentences = { status: 'running', value: null, error: null };
    vi.mocked(api.readParagraphTranslations).mockResolvedValue({ p1: saved });
    vi.mocked(api.setParagraphTranslationView).mockResolvedValue({ ...saved, view: 'paragraph' });
    const { container } = render(wrap()); await screen.findByRole('menuitemradio', { name: '整段对照' });
    sendProgress({ part: 'sentences', paragraph: null, sentences: [{ id: 1, source: 'First sentence.', translation: '第一句预览。' }] });
    expect(screen.getByText('第一句预览。')).toBeTruthy();
    expect(screen.getByText('Second sentence.')).toBeTruthy();
    expect(container.querySelectorAll('[data-paragraph-translation]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('menuitemradio', { name: '整段对照' }));
    await screen.findByText('完整的段落译文。');
    expect(api.translateParagraph).not.toHaveBeenCalled();
    vi.mocked(api.setParagraphTranslationView).mockResolvedValue(saved);
    fireEvent.click(screen.getByRole('menuitemradio', { name: '逐句对照' }));
    await screen.findByText('第一句预览。');
  });
  it('displays saved timings after completion without requiring a live stream', async () => {
    const saved = record(); saved.paragraph.timing = { queued_ms: 1000, rate_limit_ms: 2000, generation_ms: 3000, total_ms: 6000 };
    vi.mocked(api.readParagraphTranslations).mockResolvedValue({ p1: saved });
    render(wrap()); await screen.findByText('第一句。');
    expect(screen.getByRole('status').textContent).toContain('整段已完成 · 6.0 秒');
    expect(screen.getByTitle('排队 1.0 秒，限流等待 2.0 秒，生成与传输 3.0 秒')).toBeTruthy();
  });
});
