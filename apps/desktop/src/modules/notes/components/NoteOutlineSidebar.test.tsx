// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteOutlineSidebar } from './NoteOutlineSidebar';
import { collectNoteOutline } from '../editor/noteOutline';
import { revealNoteOutlinePosition } from '../editor/noteOutlineNavigation';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];

function fixture(content: string, editable = true) {
  const ancestor = document.createElement('div');
  const viewport = document.createElement('div');
  const element = document.createElement('div');
  ancestor.append(viewport); viewport.append(element); document.body.append(ancestor); hosts.push(ancestor);
  const editor = new Editor({ element, extensions: [StarterKit], content, editable });
  editors.push(editor);
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 500 },
    offsetHeight: { configurable: true, value: 500 },
    scrollHeight: { configurable: true, value: 2500 },
    clientTop: { configurable: true, value: 2 },
  });
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 400, 500));
  for (const item of collectNoteOutline(editor.state.doc)) {
    const node = editor.view.nodeDOM(item.position);
    if (node instanceof HTMLElement) vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 700, 200, 30));
  }
  return { editor, viewport, ancestor, scrollRef: { current: viewport } };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
  for (const host of hosts.splice(0)) host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('NoteOutlineSidebar', () => {
  it('starts collapsed and opens an inline heading hierarchy with read-only element navigation', async () => {
    const note = fixture('<h1>Overview</h1><p>Body</p><h3>Methods</h3><blockquote><p>Quoted evidence</p></blockquote><pre><code>const x = 1;</code></pre>', false);
    const result = render(<NoteOutlineSidebar {...note} />);
    const trigger = result.getByRole('button', { name: '展开笔记目录' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(result.queryByRole('navigation')).toBeNull();
    fireEvent.click(trigger);
    expect(result.getByRole('button', { name: '收起笔记目录' })).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(await result.findByRole('button', { name: '定位1 级标题：Overview' })).toBeTruthy();
    const nested = result.getByRole('button', { name: '定位3 级标题：Methods' });
    expect(Number.parseInt(nested.style.paddingLeft)).toBeGreaterThan(8);
    expect(result.queryByRole('button', { name: /定位代码/ })).toBeNull();
    fireEvent.click(result.getByRole('button', { name: '全部元素' }));
    expect(result.getByRole('button', { name: /定位代码/ })).toBeTruthy();
    fireEvent.change(result.getByRole('textbox', { name: '搜索笔记目录' }), { target: { value: 'Quoted' } });
    expect(result.queryByRole('button', { name: /定位代码/ })).toBeNull();
    expect(result.getByRole('button', { name: /定位引用/ })).toBeTruthy();
    const navigation = result.getByRole('navigation', { name: '笔记文内定位' });
    expect(result.container.contains(navigation)).toBe(true);
    expect(result.container.querySelector(`[id="${trigger.getAttribute('aria-controls')}"]`)).toBeTruthy();
    expect(result.queryByRole('dialog')).toBeNull();
    const changed = vi.fn(); note.editor.on('update', changed);
    fireEvent.click(result.getByRole('button', { name: /定位引用/ }));
    expect(note.viewport.scrollTop).toBe(582);
    expect(result.getByRole('navigation')).toBe(navigation);
    expect(changed).not.toHaveBeenCalled();
    expect(note.editor.isEditable).toBe(false);
  });

  it('locates only its note when another visible note has the same heading, without changing content/selection', async () => {
    const other = fixture('<h1>Same heading</h1>');
    const note = fixture('<h1>Same heading</h1>');
    other.viewport.scrollTop = 80; note.ancestor.scrollTop = 90; note.viewport.scrollLeft = 42;
    const savedDoc = note.editor.state.doc;
    const savedSelection = note.editor.state.selection;
    const changed = vi.fn(); note.editor.on('update', changed);
    const dispatch = vi.spyOn(note.editor.view, 'dispatch');
    const result = render(<NoteOutlineSidebar {...note} />);
    const trigger = result.getByRole('button', { name: '展开笔记目录' });
    fireEvent.click(trigger);
    const row = await result.findByRole('button', { name: '定位1 级标题：Same heading' });
    row.focus();
    fireEvent.click(row);
    expect(note.viewport.scrollTop).toBe(582);
    expect(note.viewport.scrollLeft).toBe(42);
    expect(other.viewport.scrollTop).toBe(80);
    expect(note.ancestor.scrollTop).toBe(90);
    expect(note.editor.state.doc).toBe(savedDoc);
    expect(note.editor.state.selection).toBe(savedSelection);
    expect(changed).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.getByRole('navigation')).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(row);
  });

  it('updates from actual document changes while open and rereads when reopened', async () => {
    const note = fixture('<h1>Before</h1>');
    const result = render(<NoteOutlineSidebar {...note} />);
    const trigger = result.getByRole('button', { name: '展开笔记目录' });
    fireEvent.click(trigger);
    await result.findByRole('button', { name: '定位1 级标题：Before' });
    act(() => { note.editor.commands.setContent('<h2>After</h2>'); });
    expect(await result.findByRole('button', { name: '定位2 级标题：After' })).toBeTruthy();
    expect(result.queryByRole('button', { name: /Before/ })).toBeNull();
    fireEvent.click(trigger);
    act(() => { note.editor.commands.setContent('<h6>Reopened</h6>'); });
    fireEvent.click(trigger);
    expect(await result.findByRole('button', { name: '定位6 级标题：Reopened' })).toBeTruthy();
  });

  it('keeps expanded state and search independent for two visible note sidebars', async () => {
    const left = fixture('<h1>Left heading</h1><h2>Left detail</h2>');
    const right = fixture('<h1>Right heading</h1>');
    const result = render(<>
      <div data-testid="left-note"><NoteOutlineSidebar {...left} /></div>
      <div data-testid="right-note"><NoteOutlineSidebar {...right} /></div>
    </>);
    const leftView = within(result.getByTestId('left-note'));
    const rightView = within(result.getByTestId('right-note'));
    fireEvent.click(leftView.getByRole('button', { name: '展开笔记目录' }));
    expect(rightView.queryByRole('navigation')).toBeNull();
    fireEvent.click(rightView.getByRole('button', { name: '展开笔记目录' }));
    fireEvent.change(leftView.getByRole('textbox', { name: '搜索笔记目录' }), { target: { value: 'detail' } });
    expect(leftView.queryByRole('button', { name: '定位1 级标题：Left heading' })).toBeNull();
    expect(await leftView.findByRole('button', { name: '定位2 级标题：Left detail' })).toBeTruthy();
    expect(rightView.getByRole('textbox', { name: '搜索笔记目录' })).toHaveProperty('value', '');
    fireEvent.click(leftView.getByRole('button', { name: '收起笔记目录' }));
    expect(rightView.getByRole('button', { name: '定位1 级标题：Right heading' })).toBeTruthy();
    expect(left.viewport.scrollTop).toBe(0);
    expect(right.viewport.scrollTop).toBe(0);
  });

  it('searches the untruncated end of a long heading', async () => {
    const label = `${'A long section '.repeat(30)}Distinct suffix`;
    const note = fixture(`<h2>${label}</h2>`);
    const result = render(<NoteOutlineSidebar {...note} />);
    fireEvent.click(result.getByRole('button', { name: '展开笔记目录' }));
    fireEvent.change(await result.findByRole('textbox', { name: '搜索笔记目录' }), { target: { value: 'Distinct suffix' } });
    const row = result.getByRole('button', { name: `定位2 级标题：${label}` });
    expect(row.title).toBe(`2 级标题：${label}`);
  });

  it('retains the inline sidebar on surface changes and outside Escape without taking focus', async () => {
    const note = fixture('<h1>Retained note</h1>');
    const destination = document.createElement('button');
    note.ancestor.append(destination);
    const result = render(<NoteOutlineSidebar {...note} />);
    fireEvent.click(result.getByRole('button', { name: '展开笔记目录' }));
    await result.findByRole('button', { name: /定位1 级标题/ });
    act(() => {
      window.dispatchEvent(new Event('neuink:reader-surface-change'));
      destination.focus();
    });
    fireEvent.keyDown(destination, { key: 'Escape' });
    fireEvent.click(destination);
    expect(result.getByRole('navigation')).toBeTruthy();
    expect(result.getByRole('button', { name: '收起笔记目录' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(destination);
    expect(note.viewport.scrollTop).toBe(0);
  });

  it('keeps long lists keyboard accessible and Escape returns to its trigger', async () => {
    const note = fixture(Array.from({ length: 100 }, (_, index) => `<h2>Heading ${index}</h2>`).join(''));
    const result = render(<NoteOutlineSidebar {...note} />);
    const trigger = result.getByRole('button', { name: '展开笔记目录' });
    fireEvent.click(trigger);
    const first = await result.findByRole('button', { name: '定位2 级标题：Heading 0' });
    const last = result.getByRole('button', { name: '定位2 级标题：Heading 99' });
    const navigation = result.getByRole('navigation');
    Object.defineProperty(navigation, 'clientHeight', { configurable: true, value: 60 });
    Object.defineProperties(last, {
      offsetTop: { configurable: true, value: 1800 },
      offsetHeight: { configurable: true, value: 24 },
    });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(result.getByRole('button', { name: '定位2 级标题：Heading 1' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(last);
    expect(navigation.scrollTop).toBe(1764);
    expect(note.viewport.scrollTop).toBe(0);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(first);
    expect(navigation.scrollTop).toBe(0);
    fireEvent.keyDown(first, { key: 'Escape' });
    await waitFor(() => expect(result.queryByRole('navigation')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('distinguishes no headings, empty content and no search matches', async () => {
    const note = fixture('<p>Body only</p>');
    const result = render(<NoteOutlineSidebar {...note} />);
    fireEvent.click(result.getByRole('button', { name: '展开笔记目录' }));
    fireEvent.click(await result.findByRole('button', { name: '查看全部元素' }));
    expect(result.getByRole('button', { name: '定位段落：Body only' })).toBeTruthy();
    fireEvent.change(result.getByRole('textbox', { name: '搜索笔记目录' }), { target: { value: 'missing' } });
    expect(result.getByText('没有匹配的目录项。')).toBeTruthy();
    fireEvent.change(result.getByRole('textbox', { name: '搜索笔记目录' }), { target: { value: '' } });
    act(() => { note.editor.commands.setContent(''); });
    expect(await result.findByText('此笔记暂无可定位内容。')).toBeTruthy();
  });

  it('disables navigation during load/failure and removes document subscriptions on close', async () => {
    const note = fixture('<h1>Ready</h1>');
    const off = vi.spyOn(note.editor, 'off');
    const result = render(<NoteOutlineSidebar {...note} disabled />);
    expect(result.getByRole('button', { name: '展开笔记目录' })).toHaveProperty('disabled', true);
    result.rerender(<NoteOutlineSidebar {...note} />);
    fireEvent.click(result.getByRole('button', { name: '展开笔记目录' }));
    await result.findByRole('button', { name: /定位1 级标题/ });
    result.rerender(<NoteOutlineSidebar {...note} disabled />);
    await waitFor(() => expect(result.queryByRole('navigation')).toBeNull());
    expect(result.getByRole('button', { name: '展开笔记目录' })).toHaveProperty('disabled', true);
    expect(off).toHaveBeenCalledWith('transaction', expect.any(Function));
  });

  it('preserves search and element scope when collapsed and Escape from search restores the toggle', async () => {
    const note = fixture('<h1>Overview</h1><blockquote><p>Quoted evidence</p></blockquote>');
    const result = render(<NoteOutlineSidebar {...note} />);
    const trigger = result.getByRole('button', { name: '展开笔记目录' });
    fireEvent.click(trigger);
    fireEvent.click(result.getByRole('button', { name: '全部元素' }));
    const search = result.getByRole('textbox', { name: '搜索笔记目录' });
    fireEvent.change(search, { target: { value: 'Quoted' } });
    search.focus();
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(result.queryByRole('navigation')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(result.getByRole('textbox', { name: '搜索笔记目录' })).toHaveProperty('value', 'Quoted');
    expect(result.getByRole('button', { name: '全部元素' }).getAttribute('aria-pressed')).toBe('true');
    expect(result.getByRole('button', { name: /定位引用/ })).toBeTruthy();
    expect(result.queryByRole('button', { name: /定位1 级标题/ })).toBeNull();
  });

  it('resets navigation state and releases the previous document when the editor instance changes', async () => {
    const first = fixture('<h1>First</h1><p>First body</p>');
    const next = fixture('<h2>Next</h2><p>Next body</p>');
    const off = vi.spyOn(first.editor, 'off');
    const result = render(<NoteOutlineSidebar {...first} />);
    fireEvent.click(result.getByRole('button', { name: '展开笔记目录' }));
    fireEvent.click(result.getByRole('button', { name: '全部元素' }));
    fireEvent.change(result.getByRole('textbox', { name: '搜索笔记目录' }), { target: { value: 'First' } });
    result.rerender(<NoteOutlineSidebar {...next} />);
    await waitFor(() => expect(result.queryByRole('navigation')).toBeNull());
    expect(off).toHaveBeenCalledWith('transaction', expect.any(Function));
    fireEvent.click(result.getByRole('button', { name: '展开笔记目录' }));
    expect(result.getByRole('textbox', { name: '搜索笔记目录' })).toHaveProperty('value', '');
    expect(result.getByRole('button', { name: '标题' }).getAttribute('aria-pressed')).toBe('true');
    expect(await result.findByRole('button', { name: '定位2 级标题：Next' })).toBeTruthy();
    expect(result.queryByRole('button', { name: /First|定位段落/ })).toBeNull();
    expect(first.viewport.scrollTop).toBe(0);
    expect(next.viewport.scrollTop).toBe(0);
  });

  it('keeps the rail disabled before the editor is ready and cleans up an open subscription on unmount', async () => {
    const note = fixture('<h1>Ready</h1>');
    const off = vi.spyOn(note.editor, 'off');
    const result = render(<NoteOutlineSidebar editor={null} scrollRef={note.scrollRef} />);
    const trigger = result.getByRole('button', { name: '展开笔记目录' });
    expect(trigger).toHaveProperty('disabled', true);
    fireEvent.click(trigger);
    expect(result.queryByRole('navigation')).toBeNull();
    result.rerender(<NoteOutlineSidebar {...note} />);
    fireEvent.click(result.getByRole('button', { name: '展开笔记目录' }));
    await result.findByRole('button', { name: /定位1 级标题/ });
    result.unmount();
    expect(off).toHaveBeenCalledWith('transaction', expect.any(Function));
  });
});

describe('note-local outline positioning', () => {
  it('accounts for 125% CSS scale and preserves horizontal position', () => {
    const note = fixture('<h1>Scaled</h1>');
    vi.mocked(note.viewport.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 500, 625));
    note.viewport.scrollTop = 60; note.viewport.scrollLeft = 42;
    expect(revealNoteOutlinePosition(note.editor, note.viewport, 0, note.editor.state.doc)).toBe(true);
    expect(note.viewport.scrollTop).toBe(522);
    expect(note.viewport.scrollLeft).toBe(42);
  });

  it('rejects stale positions, another note viewport and hidden notes', () => {
    const note = fixture('<h1>Before</h1>');
    const other = fixture('<h1>Other</h1>');
    const oldDocument = note.editor.state.doc;
    note.editor.commands.setContent('<h2>After</h2>');
    expect(revealNoteOutlinePosition(note.editor, note.viewport, 0, oldDocument)).toBe(false);
    expect(revealNoteOutlinePosition(note.editor, other.viewport, 0, note.editor.state.doc)).toBe(false);
    vi.mocked(note.viewport.getBoundingClientRect).mockReturnValue(new DOMRect());
    expect(revealNoteOutlinePosition(note.editor, note.viewport, 0, note.editor.state.doc)).toBe(false);
    expect(note.viewport.scrollTop).toBe(0);
    expect(other.viewport.scrollTop).toBe(0);
  });
});
