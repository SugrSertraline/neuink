// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentRecordsHeader } from './SegmentRecordsHeader';

afterEach(cleanup);
const base = {
  entryId: 'e1', entryTitle: '论文', workspaceRoot: 'C:/library', noteCount: 2, annotationCount: 3,
  linkedReaderKind: 'pdf' as const, follow: true, collapsed: false, filter: 'all' as const,
  pageIndex: 4, loading: false, busy: false, exportScope: { kinds: ['segment_note', 'annotation'] as ('segment_note' | 'annotation')[] },
  onFollowChange: vi.fn(), onToggleList: vi.fn(), onFilterChange: vi.fn(), onLocate: vi.fn()
};

describe('SegmentRecordsHeader', () => {
  it('uses a document icon and an outlined button without changing the locate callback', () => {
    const onLocate = vi.fn();
    render(<SegmentRecordsHeader {...base} onLocate={onLocate} />);
    const locate = screen.getByRole('button', { name: '定位原文' });
    expect(locate.querySelector('.lucide-file-search2')).toBeTruthy();
    expect(locate.querySelector('.lucide-locate-fixed')).toBeNull();
    expect(locate.getAttribute('data-variant')).toBe('outline');
    expect(locate.title).toContain('PDF中定位第 5 页');
    fireEvent.click(locate);
    expect(onLocate).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '导出片段记录' })).toBeTruthy();
  });
  it('explains the unpaired target and disables follow until a reader is paired', () => {
    render(<SegmentRecordsHeader {...base} linkedReaderKind={null} />);
    expect(screen.getByRole('button', { name: '在 PDF 中打开' }).getAttribute('data-variant')).toBe('outline');
    expect(screen.getByRole<HTMLButtonElement>('switch').disabled).toBe(true);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });
  it('keeps filter and collapse controls explicit and locates in the paired reflow', () => {
    const onFilterChange = vi.fn();
    const onToggleList = vi.fn();
    render(<SegmentRecordsHeader {...base} linkedReaderKind="reflow" collapsed filter="highlight" onFilterChange={onFilterChange} onToggleList={onToggleList} />);
    expect(screen.getByRole('button', { name: '定位原文' }).title).toContain('重排视图');
    fireEvent.click(screen.getByRole('button', { name: '展开片段列表' }));
    fireEvent.click(screen.getByRole('button', { name: '有笔记' }));
    expect(onToggleList).toHaveBeenCalledOnce();
    expect(onFilterChange).toHaveBeenCalledWith('note');
    expect(screen.getByRole('button', { name: '仅高亮' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '导出高亮' })).toBeTruthy();
  });
  it('disables unavailable actions in loading and empty states', () => {
    const { rerender } = render(<SegmentRecordsHeader {...base} pageIndex={null} loading />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '定位原文' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '导出片段记录' }).disabled).toBe(true);
    rerender(<SegmentRecordsHeader {...base} workspaceRoot={null} noteCount={0} annotationCount={0} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '导出片段记录' }).disabled).toBe(true);
  });
});
