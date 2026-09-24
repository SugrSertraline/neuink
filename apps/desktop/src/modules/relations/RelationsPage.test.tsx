// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { relationCatalog, relationEntries, relationTags } from '@/dev/relationsFixture';
import type { RelationGraph } from './relationGraph';
import type { NodeProjection } from './relationSceneData';
import type { RelationViewState } from './relationPresentation';
import { RelationsPage, type RelationsPageProps } from './RelationsPage';
import { RelationReturnFrame } from './RelationReturnFrame';

const model = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn(), update: vi.fn(), highlight: vi.fn(), active: vi.fn(), zoom: vi.fn(), rotate: vi.fn(), fit: vi.fn(), fail: false, lost: () => {} }));
vi.mock('./relationScene', () => ({
  createRelationScene: (_host: HTMLElement, _viewport: HTMLElement, callbacks: { project: (points: NodeProjection[]) => void; lost: () => void; view: (state: RelationViewState) => void }) => {
    model.create(); if (model.fail) throw new Error('WebGL unavailable'); model.lost = callbacks.lost;
    return {
      update: (graph: RelationGraph) => { model.update(graph); callbacks.project(graph.nodes.map((node, i) => ({ id: node.id, x: (i % 4) * 230 + 20, y: Math.floor(i / 4) * 80 + 30, visible: true, depth: 1 }))); },
      highlight: (selected: string | null, hovered: string | null) => { model.highlight(selected, hovered); callbacks.view({ mode: selected ? 'planar' : 'spatial', shown: 3, total: 3 }); }, dispose: model.dispose, setActive: model.active, resize: vi.fn(), refreshColors: vi.fn(),
      zoom: model.zoom, rotate: model.rotate, fit: model.fit,
    };
  },
}));
beforeEach(() => {
  vi.clearAllMocks(); model.fail = false;
  class Pointer extends MouseEvent { pointerId = 1; }
  vi.stubGlobal('PointerEvent', Pointer);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const props = (): RelationsPageProps => ({ entries: relationEntries, tags: relationTags, trashedEntries: [], catalog: relationCatalog,
  loading: false, error: null, onRefresh: vi.fn(), onBack: vi.fn(), onOpen: vi.fn(), onSource: vi.fn() });
const selectTag = () => fireEvent.click(screen.getByRole('button', { name: '标签：软件工程' }));
const details = () => within(screen.getByRole('region', { name: '关系详情' }));
const ready = () => waitFor(() => expect((screen.getByRole('button', { name: '放大关系图' }) as HTMLButtonElement).disabled).toBe(false));

describe('3D relations page', () => {
  it('uses anchored details and keeps the same scene through history, opening content and returning', async () => {
    const options = props(), view = render(<RelationsPage {...options} />); await ready();
    const search = screen.getByRole('textbox', { name: '搜索关系图' });
    fireEvent.change(search, { target: { value: '软件工程' } }); selectTag();
    expect(screen.getByRole('dialog', { name: '关系详情气泡' })).toBeTruthy();
    fireEvent.click(details().getByRole('button', { name: /跨论文比较.*拥有笔记/ }));
    fireEvent.click(details().getByRole('button', { name: '打开笔记' }));
    expect(options.onOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note', available: true }));
    view.rerender(<RelationsPage {...options} active={false} />);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(model.active).toHaveBeenLastCalledWith(false);
    view.rerender(<RelationsPage {...options} active />);
    expect(details().getByRole('button', { name: '打开笔记' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回上一个对象' }));
    expect(details().getByRole('button', { name: '打开标签' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '前进到下一个对象' }));
    expect(details().getByRole('button', { name: '打开笔记' })).toBeTruthy();
    expect((search as HTMLInputElement).value).toBe('软件工程'); expect(model.create).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '关闭详情，返回关系图' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: '返回三维' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(screen.getByRole('dialog', { name: '关系详情气泡' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回三维' }));
    expect(model.highlight).toHaveBeenLastCalledWith(null, null);
  });
  it('keeps unavailable citations and snapshots readable while disabling navigation', async () => {
    const options = props(); render(<RelationsPage {...options} />); await ready();
    fireEvent.click(screen.getByRole('button', { name: /标签笔记：跨论文比较/ }));
    const locate = details().getAllByRole('button', { name: '定位原文' }) as HTMLButtonElement[];
    expect(locate.map(button => button.disabled)).toEqual([false, false, true]);
    fireEvent.click(locate[0]); fireEvent.click(locate[2]); expect(options.onSource).toHaveBeenCalledOnce();
    expect(details().getByText(/这段引用在论文删除前已经保存/)).toBeTruthy();
    fireEvent.click(details().getByRole('button', { name: /原论文已删除.*引用来源/ }));
    expect((details().getByRole('button', { name: '打开条目' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('focuses relationships and clears filters without rebuilding the renderer', async () => {
    render(<RelationsPage {...props()} />); await ready(); selectTag();
    fireEvent.click(details().getByRole('button', { name: '只看关联' }));
    expect(screen.queryByRole('button', { name: /论文：待整理/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '全部关系' }));
    expect(screen.getByRole('button', { name: /论文：待整理/ })).toBeTruthy();
    expect(model.create).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('supports camera keyboard controls and ignores camera shortcuts typed in search', async () => {
    render(<RelationsPage {...props()} />); await ready();
    const viewport = screen.getByLabelText('三维关系图画布');
    fireEvent.keyDown(viewport, { key: '+' }); expect(model.zoom).toHaveBeenLastCalledWith(.85);
    fireEvent.keyDown(viewport, { key: 'ArrowRight' }); expect(model.rotate).toHaveBeenCalledWith(.12, 0);
    fireEvent.keyDown(viewport, { key: 'Home' }); expect(model.fit).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: '+' }); expect(model.zoom).toHaveBeenCalledOnce();
    fireEvent.wheel(screen.getByRole('button', { name: '标签：软件工程' }), { deltaY: 120 });
    expect(model.zoom).toHaveBeenLastCalledWith(Math.exp(.18));
  });
  it('offers searchable objects and retry after WebGL failure, then releases the recovered scene', async () => {
    model.fail = true; const view = render(<RelationsPage {...props()} />);
    await screen.findByRole('button', { name: '重试三维视图' });
    fireEvent.click(screen.getByRole('button', { name: '选择对象' }));
    fireEvent.click(screen.getByRole('button', { name: '软件工程' }));
    expect(details().getByRole('button', { name: '打开标签' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭详情，返回关系图' }));
    model.fail = false; fireEvent.click(screen.getByRole('button', { name: '重试三维视图' })); await ready();
    view.unmount(); expect(model.dispose).toHaveBeenCalledOnce();
  });
  it('distinguishes empty, loading and partial errors, retaining usable objects', async () => {
    const options = props(); const view = render(<RelationsPage {...options} entries={[]} tags={[]} catalog={{ notes: [], errors: [] }} />);
    expect(screen.getByText('还没有标签、论文或笔记')).toBeTruthy(); expect(model.create).not.toHaveBeenCalled();
    view.rerender(<RelationsPage {...options} loading />); await ready();
    expect((screen.getByRole('button', { name: '更新中' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<RelationsPage {...options} error="读取失败" />);
    expect(screen.getByRole('alert').textContent).toContain('读取失败'); selectTag();
    fireEvent.click(screen.getByRole('button', { name: '刷新关系' })); expect(options.onRefresh).toHaveBeenCalledOnce();
  });
  it('shows a shared hover preview without opening the detail bubble', async () => {
    render(<RelationsPage {...props()} />); await ready();
    fireEvent.pointerEnter(screen.getByRole('button', { name: '标签：软件工程' }));
    await screen.findByRole('tooltip');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.pointerLeave(screen.getByRole('button', { name: '标签：软件工程' }));
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });
  it('never remounts an editor when adding the return control', () => {
    const mounted = vi.fn(), onReturn = vi.fn();
    function Editor() { useEffect(mounted, []); return <textarea aria-label="草稿" defaultValue="未保存的笔记" />; }
    const view = render(<RelationReturnFrame visible={false} onReturn={onReturn}><Editor /></RelationReturnFrame>);
    const editor = screen.getByRole('textbox'); fireEvent.change(editor, { target: { value: '新草稿' } });
    view.rerender(<RelationReturnFrame visible onReturn={onReturn}><Editor /></RelationReturnFrame>);
    fireEvent.click(screen.getByRole('button', { name: '返回关系图' })); expect(onReturn).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox')).toBe(editor); expect((editor as HTMLTextAreaElement).value).toBe('新草稿'); expect(mounted).toHaveBeenCalledOnce();
  });
});
