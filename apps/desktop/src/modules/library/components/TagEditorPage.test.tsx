// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagMeta } from '@/shared/types/domain';
import { TagEditorPage } from './TagEditorPage';

class Pointer extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
  }
}
beforeEach(() => vi.stubGlobal('PointerEvent', Pointer));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const tags: TagMeta[] = [
  { id: 'root', name: '研究', parent_id: null, created_at: '', updated_at: '' },
  { id: 'child', name: '视觉', parent_id: 'root', created_at: '', updated_at: '' }
];

function showEditor(overrides: Partial<React.ComponentProps<typeof TagEditorPage>> = {}) {
  const onRenameTag = vi.fn().mockResolvedValue(undefined);
  const onCreateTagPath = vi.fn().mockResolvedValue(undefined);
  const onSelectTag = vi.fn();
  render(<TagEditorPage standalone activeTag={null} entries={[]} tags={tags} onCreateTagPath={onCreateTagPath}
    onDeleteTag={vi.fn()} onRenameTag={onRenameTag} onSelectTag={onSelectTag} {...overrides} />);
  return { onRenameTag, onCreateTagPath, onSelectTag };
}

describe('TagEditorPage', () => {
  it('collapses and expands the tree while keeping the selected tag editable', () => {
    showEditor();
    const graph = screen.getByLabelText('标签树图');
    fireEvent.click(within(graph).getByRole('button', { name: '选择标签 研究/视觉' }), { detail: 1 });
    expect(within(screen.getByLabelText('标签编辑')).getByText('视觉')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '收起全部' }));
    expect(within(graph).queryByRole('button', { name: '选择标签 研究/视觉' })).toBeNull();
    expect(within(screen.getByLabelText('标签编辑')).getByRole('heading', { name: '研究' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '展开全部' }));
    expect(within(graph).getByRole('button', { name: '选择标签 研究/视觉' })).toBeTruthy();
  });

  it('renames and adds a child from the inspector', async () => {
    const { onRenameTag, onCreateTagPath } = showEditor();
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    fireEvent.change(screen.getByRole('textbox', { name: '重命名标签' }), { target: { value: '新研究' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onRenameTag).toHaveBeenCalledWith('root', '新研究'));
    await waitFor(() => expect(screen.getByRole('button', { name: '添加子标签' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '添加子标签' }));
    fireEvent.change(screen.getByRole('textbox', { name: '添加到“研究”下' }), { target: { value: '机器学习' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onCreateTagPath).toHaveBeenCalledWith('研究/机器学习'));
  });

  it('keeps the draft and shows an error when saving fails', async () => {
    showEditor({ onRenameTag: vi.fn().mockRejectedValue(new Error('保存失败')) });
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    fireEvent.change(screen.getByRole('textbox', { name: '重命名标签' }), { target: { value: '保留草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '保存失败');
    expect(screen.getByRole('textbox', { name: '重命名标签' })).toHaveProperty('value', '保留草稿');
  });

  it('pans from blank canvas, leaves node clicks alone, and resets the view', () => {
    showEditor();
    const graph = screen.getByLabelText('标签树图');
    Object.assign(graph, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
    const stage = graph.querySelector<HTMLElement>('[data-tag-editor-stage]')!;
    fireEvent.pointerDown(graph, { pointerId: 7, button: 0, clientX: 100, clientY: 100, pointerType: 'mouse' });
    fireEvent.pointerMove(graph, { pointerId: 7, clientX: 60, clientY: 80 });
    expect(stage.style.transform).toBe('translate3d(-40px, -20px, 0)');
    fireEvent.pointerUp(graph, { pointerId: 7 });

    fireEvent.pointerDown(within(graph).getByRole('button', { name: '选择标签 研究' }),
      { pointerId: 8, button: 0, clientX: 50, clientY: 50, pointerType: 'mouse' });
    fireEvent.pointerMove(graph, { pointerId: 8, clientX: 10, clientY: 10 });
    expect(stage.style.transform).toBe('translate3d(-40px, -20px, 0)');
    fireEvent.pointerDown(graph, { pointerId: 9, button: 0, clientX: 100, clientY: 100, pointerType: 'touch' });
    fireEvent.pointerMove(graph, { pointerId: 9, clientX: 130, clientY: 130 });
    expect(stage.style.transform).toBe('translate3d(-40px, -20px, 0)');
    fireEvent.pointerDown(graph, { pointerId: 10, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(graph, { pointerId: 10, clientX: 120, clientY: 130 });
    fireEvent.keyDown(graph, { key: 'Escape' });
    expect(stage.style.transform).toBe('translate3d(-40px, -20px, 0)');
    fireEvent.click(screen.getByRole('button', { name: '视图居中' }));
    expect(stage.style.transform).toBe('translate3d(0px, 0px, 0)');
  });

  it('edits the tag that was right-clicked', () => {
    showEditor();
    fireEvent.contextMenu(screen.getByRole('button', { name: '选择标签 研究/视觉' }), { clientX: 80, clientY: 90 });
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    expect(screen.getByRole('textbox', { name: '重命名标签' })).toHaveProperty('value', '视觉');
  });

  it('keeps panning distance correct at 125% app zoom and rolls back canceled gestures', () => {
    showEditor();
    const graph = screen.getByRole('region', { name: '标签树图' });
    const release = vi.fn();
    Object.assign(graph, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: release });
    Object.defineProperties(graph, { offsetWidth: { value: 800 }, offsetHeight: { value: 400 } });
    vi.spyOn(graph, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 500 } as DOMRect);
    const stage = graph.querySelector<HTMLElement>('[data-tag-editor-stage]')!;
    fireEvent.pointerDown(graph, { pointerId: 5, button: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(graph, { pointerId: 5, clientX: 102, clientY: 101 });
    expect(stage.style.transform).toBe('translate3d(0px, 0px, 0)');
    expect(graph.classList.contains('cursor-grabbing')).toBe(false);
    fireEvent.pointerMove(graph, { pointerId: 6, clientX: 200, clientY: 200 });
    expect(stage.style.transform).toBe('translate3d(0px, 0px, 0)');
    fireEvent.pointerMove(graph, { pointerId: 5, clientX: 150, clientY: 125 });
    expect(stage.style.transform).toBe('translate3d(40px, 20px, 0)');
    fireEvent.pointerUp(graph, { pointerId: 5 });
    for (const end of ['pointercancel', 'lostpointercapture', 'blur'] as const) {
      fireEvent.pointerDown(graph, { pointerId: 7, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(graph, { pointerId: 7, clientX: 175, clientY: 150 });
      if (end === 'blur') fireEvent(window, new Event('blur'));
      else fireEvent(graph, new Pointer(end, { pointerId: 7, bubbles: true }));
      expect(stage.style.transform).toBe('translate3d(40px, 20px, 0)');
      expect(graph.classList.contains('cursor-grabbing')).toBe(false);
    }
    fireEvent.pointerDown(graph, { pointerId: 9, button: 0, clientX: 100, clientY: 100 });
    cleanup();
    expect(release).toHaveBeenLastCalledWith(9);
  });

  it('zooms with buttons and canvas keys without losing the selected tag or editing draft', () => {
    const { onSelectTag } = showEditor();
    const graph = screen.getByRole('region', { name: '标签树图' });
    fireEvent.click(within(graph).getByRole('button', { name: '选择标签 研究/视觉' }), { detail: 1 });
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    const input = screen.getByRole('textbox', { name: '重命名标签' });
    fireEvent.change(input, { target: { value: '保留草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '放大树图' }));
    expect(screen.getByRole('button', { name: '恢复 100%' }).textContent).toBe('110%');
    fireEvent.keyDown(input, { key: '-' });
    expect(screen.getByRole('button', { name: '恢复 100%' }).textContent).toBe('110%');
    expect(input).toHaveProperty('value', '保留草稿');
    expect(within(graph).getByRole('button', { name: '选择标签 研究/视觉' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(graph, { key: '0' });
    expect(screen.getByRole('button', { name: '恢复 100%' }).textContent).toBe('100%');
    for (let i = 0; i < 15; i++) fireEvent.keyDown(graph, { key: '+' });
    expect(screen.getByRole('button', { name: '恢复 100%' }).textContent).toBe('200%');
    expect(screen.getByRole('button', { name: '放大树图' })).toHaveProperty('disabled', true);
    for (let i = 0; i < 25; i++) fireEvent.keyDown(graph, { key: '-' });
    expect(screen.getByRole('button', { name: '恢复 100%' }).textContent).toBe('10%');
    expect(screen.getByRole('button', { name: '缩小树图' })).toHaveProperty('disabled', true);
    expect(onSelectTag).not.toHaveBeenCalled();
  });

  it('keeps ordinary wheel scrolling and anchors Ctrl-wheel zoom in app-scaled coordinates', () => {
    showEditor();
    const graph = screen.getByRole('region', { name: '标签树图' });
    Object.defineProperties(graph, { clientWidth: { value: 800 }, offsetWidth: { value: 800 }, clientHeight: { value: 400 }, offsetHeight: { value: 400 } });
    vi.spyOn(graph, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 1000, height: 500 } as DOMRect);
    const stage = graph.querySelector<HTMLElement>('[data-tag-editor-stage]')!;
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 125, top: 75 } as DOMRect);
    const ordinary = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    fireEvent(graph, ordinary);
    expect(ordinary.defaultPrevented).toBe(false);
    expect(screen.getByRole('button', { name: '恢复 100%' }).textContent).toBe('100%');
    const modified = new WheelEvent('wheel', { ctrlKey: true, clientX: 375, clientY: 200, deltaY: -100, bubbles: true, cancelable: true });
    fireEvent(graph, modified);
    expect(modified.defaultPrevented).toBe(true);
    expect(screen.getByRole('button', { name: '恢复 100%' }).textContent).toBe('122%');
    const zoom = Number(stage.firstElementChild!.getAttribute('style')!.match(/scale\(([^)]+)\)/)![1]);
    const [x, y] = stage.style.transform.match(/-?[\d.]+px/g)!.map(parseFloat);
    // The same content point (200, 100) must remain under the pointer at 125% app zoom.
    expect(125 + (x + 200 * zoom) * 1.25).toBeCloseTo(375);
    expect(75 + (y + 100 * zoom) * 1.25).toBeCloseTo(200);
  });

  it('fits the scaled tree inside the available canvas and restores its original size', () => {
    showEditor();
    const graph = screen.getByRole('region', { name: '标签树图' });
    Object.defineProperties(graph, { clientWidth: { value: 560 }, clientHeight: { value: 180 } });
    fireEvent.click(screen.getByRole('button', { name: '适应画布' }));
    const stage = graph.querySelector<HTMLElement>('[data-tag-editor-stage]')!;
    expect(parseFloat(stage.style.width)).toBeLessThanOrEqual(528);
    expect(parseFloat(stage.style.height)).toBeLessThanOrEqual(148);
    expect(screen.getByRole('button', { name: '恢复 100%' }).textContent).not.toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: '恢复 100%' }));
    expect(screen.getByRole('button', { name: '恢复 100%' }).textContent).toBe('100%');
  });

  it('uses the correct node menu under the desktop context-menu guard and transfers focus into editing', async () => {
    const guard = (event: MouseEvent) => { if (!(event.target as Element).closest('[data-allow-context-menu="true"]')) event.preventDefault(); };
    document.addEventListener('contextmenu', guard, true);
    try {
      showEditor();
      const tag = screen.getByRole('button', { name: '选择标签 研究/视觉' });
      fireEvent.contextMenu(tag, { clientX: 80, clientY: 90 });
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      expect(screen.queryByRole('menuitem', { name: '新建标签' })).toBeNull();
      fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '重命名标签' })));
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
      fireEvent.contextMenu(tag, { clientX: 80, clientY: 90 });
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      await waitFor(() => expect(document.activeElement).toBe(tag));
    } finally { document.removeEventListener('contextmenu', guard, true); }
  });

  it('opens canvas view actions and focuses the create input without changing the selected tag', async () => {
    const { onCreateTagPath, onSelectTag } = showEditor();
    const graph = screen.getByRole('region', { name: '标签树图' });
    fireEvent.contextMenu(graph, { clientX: 300, clientY: 200 });
    expect(screen.getByRole('menuitem', { name: '适应画布' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '移入回收站' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: '新建标签' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '新标签路径' })));
    expect(onCreateTagPath).not.toHaveBeenCalled();
    expect(onSelectTag).not.toHaveBeenCalled();
  });

  it('keeps tag deletion behind confirmation when invoked from the node menu', () => {
    const onDeleteTag = vi.fn();
    showEditor({ onDeleteTag });
    fireEvent.contextMenu(screen.getByRole('button', { name: '选择标签 研究/视觉' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '移入回收站' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('研究/视觉');
    expect(onDeleteTag).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(onDeleteTag).not.toHaveBeenCalled();
  });

  it('disables empty view actions and blocks tag mutations while a save is pending', async () => {
    const emptyView = render(<TagEditorPage standalone activeTag={null} entries={[]} tags={[]} onCreateTagPath={vi.fn()} onDeleteTag={vi.fn()} onRenameTag={vi.fn()} onSelectTag={vi.fn()} />);
    expect(screen.getByRole('button', { name: '放大树图' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '适应画布' })).toHaveProperty('disabled', true);
    emptyView.unmount();
    let finish!: () => void;
    showEditor({ onRenameTag: () => new Promise<void>(resolve => { finish = resolve; }) });
    const graph = screen.getByRole('region', { name: '标签树图' });
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('textbox', { name: '重命名标签' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '放大树图' })).toHaveProperty('disabled', false);
    fireEvent.contextMenu(graph);
    expect(screen.getByRole('menuitem', { name: '新建标签' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: '收起全部' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await act(async () => finish());
  });
});
