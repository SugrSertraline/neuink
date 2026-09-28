// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { AssistantReadingContextControl } from './AssistantReadingContextControl';
import { resolveAssistantReadingContext, type AssistantReadingChoice, type AssistantReadingContext } from './assistantReadingContext';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { TagMeta } from '@/shared/types/domain';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(224);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const entry: LibraryEntry = { id: 'paper', title: 'Paper', contents: [], tagIds: [], tags: [], fields: {},
  createdAt: '', updatedAt: '', pdfFileName: 'paper.pdf', parseMessage: null, parseEndpoint: null, status: 'Queued', progress: 0 };
const context: AssistantReadingContext = { entry, tag: null, note: null, segment: null, surface: { kind: 'entry-overview',
  surfaceKey: 'entry-overview:paper', entryId: 'paper', noteId: null, segmentUid: null, capturedAt: '', pane: 'left' }, label: 'Paper', bound: false, unavailable: false };
function show(overrides: Partial<AssistantReadingContext> = {}) {
  return render(<AssistantReadingContextControl context={{ ...context, ...overrides }} entries={[entry]} busy={false} choice={null} onChange={vi.fn()} />);
}
it('shows a nonblocking notice for queued, failed and canceled PDF parsing', () => {
  for (const status of ['Queued', 'Parsing', 'Failed', 'Canceled'] as const) {
    const ui = show({ entry: { ...entry, status } });
    expect(screen.getByRole('status').textContent).toContain('仍可让助手按页读取或搜索文字');
    expect((screen.getByRole('button', { name: '更换阅读对象：Paper' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull(); ui.unmount();
  }
});
it('does not warn on parsed PDFs, missing PDFs or note reading', () => {
  for (const overrides of [{ entry: { ...entry, status: 'Parsed' as const } }, { entry: { ...entry, pdfFileName: null } },
    { note: { entryId: 'paper', entryTitle: 'Paper', noteId: 'note', noteTitle: 'Note' } }]) {
    const ui = show(overrides); expect(screen.queryByRole('status')).toBeNull(); ui.unmount();
  }
});
it('keeps the unavailable-object error distinct from unparsed status', () => {
  show({ unavailable: true });
  expect(screen.getByRole('alert').textContent).toContain('对象已不可用');
  expect(screen.queryByRole('status')).toBeNull();
});
it('clears the object, stays unbound on tab changes, and lets the user resume following or pin a paper', async () => {
  function Harness({ activeEntry }: { activeEntry: LibraryEntry }) {
    const [choice, setChoice] = useState<AssistantReadingChoice>(null);
    const resolved = resolveAssistantReadingContext({ choice, entries: [activeEntry], items: [], activeEntry,
      activeNote: null, activeSegment: null, activeSurface: { ...context.surface, entryId: activeEntry.id } });
    return <AssistantReadingContextControl context={resolved} entries={[activeEntry]} busy={true} choice={choice} onChange={setChoice} />;
  }
  const ui = render(<Harness activeEntry={entry} />);
  fireEvent.click(screen.getByRole('button', { name: '取消关联阅读对象' }));
  expect(screen.getByRole('button', { name: '更换阅读对象：不关联内容' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '更换阅读对象：不关联内容' }));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('button', { name: '取消关联阅读对象' })).toBeNull();
  ui.rerender(<Harness activeEntry={{ ...entry, id: 'other', title: 'Other Paper' }} />);
  fireEvent.click(screen.getByRole('button', { name: '更换阅读对象：不关联内容' }));
  expect(screen.getByRole('button', { name: '不关联内容', pressed: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '跟随当前标签页（已附选区优先）' }));
  fireEvent.click(screen.getByRole('button', { name: '更换阅读对象：Other Paper' }));
  fireEvent.click(screen.getByRole('button', { name: '不关联内容' }));
  fireEvent.click(screen.getByRole('button', { name: '更换阅读对象：不关联内容' }));
  fireEvent.click(screen.getByRole('button', { name: '条目' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Other Paper 条目概览' }));
  expect(screen.getByRole('button', { name: '更换阅读对象：Other Paper' })).toBeTruthy();
  expect(screen.getByText(/已固定/)).toBeTruthy();
});

it('offers tags as fixed reading targets and resolves a removed tag as unavailable', async () => {
  const tag: TagMeta = { id: 'tag', name: '时间序列', parent_id: null, created_at: '', updated_at: '' };
  const onChange = vi.fn();
  const ui = render(<AssistantReadingContextControl context={context} entries={[entry]} tags={[tag]}
    busy={false} choice={null} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: '更换阅读对象：Paper' }));
  expect(screen.getByRole('group', { name: '阅读对象类型' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('option', { name: '时间序列 时间序列' }));
  expect(onChange).toHaveBeenCalledWith({ tagId: 'tag' });
  const selected = resolveAssistantReadingContext({ choice: { tagId: 'tag' }, entries: [entry], tags: [tag], items: [],
    activeEntry: entry, activeNote: null, activeSegment: null, activeSurface: context.surface });
  expect(selected.tag?.id).toBe('tag');
  expect(selected.entry).toBeNull();
  expect(selected.label).toBe('标签 · 时间序列');
  expect(resolveAssistantReadingContext({ choice: { tagId: 'tag' }, entries: [entry], tags: [], items: [],
    activeEntry: entry, activeNote: null, activeSegment: null, activeSurface: context.surface }).unavailable).toBe(true);
  ui.unmount();
});

it('keeps PDF distinct from the entry overview and rejects a removed PDF', () => {
  const selected = resolveAssistantReadingContext({ choice: { entryId: 'paper', contentKind: 'pdf' }, entries: [entry], items: [],
    activeEntry: entry, activeNote: null, activeSegment: null, activeSurface: context.surface });
  expect(selected.surface.kind).toBe('pdf');
  expect(selected.label).toBe('paper.pdf · PDF');
  expect(resolveAssistantReadingContext({ choice: { entryId: 'paper', contentKind: 'pdf' }, entries: [{ ...entry, pdfFileName: null }], items: [],
    activeEntry: entry, activeNote: null, activeSegment: null, activeSurface: context.surface }).unavailable).toBe(true);
});

it('keeps large tag catalogs searchable and supports keyboard selection', async () => {
  const tags: TagMeta[] = Array.from({ length: 60 }, (_, index) => ({ id: `tag-${index}`, name: `领域 ${String(index).padStart(2, '0')}`,
    parent_id: null, created_at: '', updated_at: '' }));
  const onChange = vi.fn();
  render(<AssistantReadingContextControl context={context} entries={[entry]} tags={tags}
    busy={false} choice={null} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: '更换阅读对象：Paper' }));
  const input = screen.getByRole('combobox', { name: '搜索所选阅读对象' });
  expect(await screen.findByRole('option', { name: '领域 00 领域 00' })).toBeTruthy();
  fireEvent.change(input, { target: { value: '领域 42' } });
  expect(await screen.findByRole('option', { name: '领域 42 领域 42' })).toBeTruthy();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith({ tagId: 'tag-42' });
});
