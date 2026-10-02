// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Annotation, SegmentBlockNote, SourceSegment } from '@/shared/types/domain';
import { SegmentRail } from './SegmentRail';
import { SegmentRailMarker } from './SegmentRailMarker';
import { buildSegmentRailMarks, summarizeSegmentRailMarks } from './segmentRailMarks';

const segment = (uid: string, page_idx: number): SourceSegment => ({ uid, page_idx, bbox: [50, 50, 950, 250], text: uid, markdown: null, segment_type: 'paragraph' });
const note = (uid: string, text = '', bookmarked = false): SegmentBlockNote => ({ segment_uid: uid, text, bookmarked, created_at: '', updated_at: '' });
const annotation: Annotation = { annotation_id: 'a', segment_uid: 'annotation', content: 'Evidence', kind: 'comment', importance: 'normal', created_at: '', updated_at: '' };
const segments = [segment('bookmark', 0), segment('note', 1), segment('annotation', 2), segment('plain', 3)];
const notes = new Map([['bookmark', note('bookmark', '', true)], ['note', note('note', 'My note')], ['plain', note('plain')]]);
const annotations = new Map([['annotation', [annotation]], ['plain', []]]);
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('PointerEvent', MouseEvent);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function props() {
  return { activeSegmentUid: null, flashSegmentUid: null, selectedSegmentUid: null, notesBySegmentUid: notes, annotationsBySegmentUid: annotations,
    pages: segments.map(segment => ({ pageIdx: segment.page_idx, segments: [segment], regions: [] })), onJumpToSegment: vi.fn() };
}
const wrapper = ({ children }: { children: React.ReactNode }) => <TooltipProvider>{children}</TooltipProvider>;

describe('marked reading positions', () => {
  it('distinguishes empty bookmarks from written notes and ignores cleared records', () => {
    const marks = buildSegmentRailMarks(notes, annotations);
    expect(summarizeSegmentRailMarks(segments, marks)).toEqual({ bookmarks: 1, notes: 1, annotations: 1, total: 3 });
    expect(summarizeSegmentRailMarks([segments[0]], marks)).toEqual({ bookmarks: 1, notes: 0, annotations: 0, total: 1 });
    expect(summarizeSegmentRailMarks([segments[3]], marks).total).toBe(0);
  });

  it('counts a continuation note once even when physical and logical ids both exist', () => {
    const continued = [0, 1].map(page => ({ ...segment(`part-${page}`, page), continuation_group_id: 'group' }));
    const record = note('part-0', 'Note text', true);
    const marks = buildSegmentRailMarks(new Map([['part-0', record], ['group', record]]), new Map());
    expect(summarizeSegmentRailMarks(continued, marks)).toEqual({ bookmarks: 1, notes: 1, annotations: 0, total: 1 });
  });

  it('filters all three mark types without jumping or changing the outline', () => {
    const input = props();
    const { container } = render(<SegmentRail {...input} />, { wrapper });
    expect(container.querySelectorAll('[data-rail-marker]')).toHaveLength(4);
    const filter = screen.getByRole('button', { name: '只看标记（3 处）' });
    fireEvent.click(filter);
    expect(filter.getAttribute('aria-pressed')).toBe('true');
    expect(input.onJumpToSegment).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[data-rail-marker]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '段落，第 1 页，收藏 1 处' }));
    expect(input.onJumpToSegment).toHaveBeenCalledExactlyOnceWith('bookmark');
    fireEvent.click(filter);
    expect(container.querySelectorAll('[data-rail-marker]')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '打开详细目录' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('updates after canceling the final mark and keeps a way back to the full rail', () => {
    const input = { ...props(), notesBySegmentUid: new Map([['bookmark', note('bookmark', '', true)]]), annotationsBySegmentUid: new Map<string, Annotation[]>() };
    const { container, rerender } = render(<SegmentRail {...input} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '只看标记（1 处）' }));
    rerender(<SegmentRail {...input} notesBySegmentUid={new Map([['bookmark', note('bookmark')]])} />);
    expect(screen.getByRole('status').textContent).toBe('暂无标记');
    const filter = screen.getByRole('button', { name: '只看标记（0 处）' });
    expect(filter.hasAttribute('disabled')).toBe(false);
    fireEvent.click(filter);
    expect(container.querySelectorAll('[data-rail-marker]')).toHaveLength(4);
    expect(filter.hasAttribute('disabled')).toBe(true);
  });

  it('opens a bookmarked position within a cluster instead of its active unmarked neighbor', () => {
    const onJumpToSegment = vi.fn();
    render(<SegmentRailMarker activeSegmentUid="plain" selectedSegmentUid={null} flashSegmentUid={null}
      item={{ segment: segments[3], segments: [segments[3], segments[0]], top: 50, isHeading: false, headingLevel: null }}
      {...buildSegmentRailMarks(notes, new Map())} open={false} pointerY={null} railHeight={500} railWidth={36}
      onJumpToSegment={onJumpToSegment} onHoverOpenChange={vi.fn()} onOpenOutline={vi.fn()} onPointerFocus={vi.fn()} />, { wrapper });
    const marker = screen.getByRole('button', { name: '2 个相邻片段，第 1 页，收藏 1 处' });
    expect(marker.getAttribute('aria-current')).toBe('location');
    fireEvent.click(marker);
    expect(onJumpToSegment).toHaveBeenCalledExactlyOnceWith('bookmark');
  });

  it('navigates only once to the chosen preview item instead of also clicking the rail behind its portal', async () => {
    const manySegments = Array.from({ length: 128 }, (_, index) => segment(`s${index}`, index));
    const input = { ...props(), notesBySegmentUid: new Map<string, SegmentBlockNote>(), annotationsBySegmentUid: new Map<string, Annotation[]>(),
      pages: manySegments.map(segment => ({ pageIdx: segment.page_idx, segments: [segment], regions: [] })) };
    render(<SegmentRail {...input} />, { wrapper });
    fireEvent.focus(screen.getByRole('button', { name: '2 个相邻片段，第 1 页' }));
    const previewItem = await screen.findByRole('button', { name: '第 2 页 · 段落 s1' });
    fireEvent.click(previewItem);
    expect(input.onJumpToSegment).toHaveBeenCalledExactlyOnceWith('s1');
  });

  it('keeps only the latest preview during rapid movement and ignores an older close timer', () => {
    vi.useFakeTimers();
    render(<SegmentRail {...props()} />, { wrapper });
    const first = screen.getByRole('button', { name: '段落，第 1 页，收藏 1 处' });
    const second = screen.getByRole('button', { name: '段落，第 2 页，笔记 1 处' });
    const third = screen.getByRole('button', { name: '段落，第 3 页，批注 1 处' });
    const previews = () => document.querySelectorAll('[data-slot="hover-card-content"]');

    fireEvent.pointerMove(first, { pointerType: 'mouse' });
    expect(previews()).toHaveLength(1);
    expect(previews()[0].textContent).toContain('bookmark');
    fireEvent.pointerLeave(first, { pointerType: 'mouse' });
    fireEvent.pointerMove(second, { pointerType: 'mouse' });
    fireEvent.pointerLeave(second, { pointerType: 'mouse' });
    fireEvent.pointerMove(third, { pointerType: 'mouse' });
    expect(previews()).toHaveLength(1);
    expect(previews()[0].textContent).toContain('annotation');

    act(() => vi.advanceTimersByTime(200));
    expect(previews()).toHaveLength(1);
    expect(previews()[0].textContent).toContain('annotation');
    fireEvent.keyDown(third, { key: 'Escape' });
    expect(previews()).toHaveLength(0);
    fireEvent.pointerMove(first, { pointerType: 'mouse' });
    expect(previews()).toHaveLength(1);
    fireEvent.scroll(document);
    expect(previews()).toHaveLength(0);
  });

  it('replaces the current preview when keyboard focus moves to another marker', async () => {
    render(<SegmentRail {...props()} />, { wrapper });
    const first = screen.getByRole('button', { name: '段落，第 1 页，收藏 1 处' });
    const second = screen.getByRole('button', { name: '段落，第 2 页，笔记 1 处' });
    fireEvent.focus(first);
    await screen.findByText('bookmark');
    fireEvent.blur(first);
    fireEvent.focus(second);
    await screen.findByText('note');
    const previews = document.querySelectorAll('[data-slot="hover-card-content"]');
    expect(previews).toHaveLength(1);
    expect(previews[0].textContent).toContain('note');
  });
});
