// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { initialWorkspaceSurfaceLayout, surfaceKey, workspaceSurfaceReducer, type WorkspaceSurface } from '@/app/workspaceSurface';
import { WorkspaceSurfaceDeck } from './WorkspaceSurfaceDeck';

afterEach(cleanup);
it('retains the reader and library nodes when moving the last swapped tab merges the panes', () => {
  const pdf: WorkspaceSurface = { kind: 'pdf', entryId: 'swapped', viewId: 'reading-copy' };
  let layout = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', pane: 'right', surface: pdf });
  const view = () => <WorkspaceSurfaceDeck layout={layout} onFocus={() => {}}
    renderSurface={surface => <div data-testid={surfaceKey(surface)}><input defaultValue="未保存的阅读草稿" /></div>} />;
  const ui = render(view());
  const reader = ui.getByTestId(surfaceKey(pdf));
  const library = ui.getByTestId('library');
  reader.scrollTop = 1460;
  reader.scrollLeft = 25;
  const draft = reader.querySelector('input')!;
  fireEvent.change(draft, { target: { value: '继续保留这份草稿' } });
  for (const action of [{ type: 'swap' as const }, { type: 'move' as const, key: surfaceKey(pdf), pane: 'right' as const }]) {
    layout = workspaceSurfaceReducer(layout, action);
    ui.rerender(view());
    expect(ui.getAllByTestId('library')).toEqual([library]);
    expect(ui.getByTestId(surfaceKey(pdf))).toBe(reader);
    expect(reader.scrollTop).toBe(1460);
    expect(reader.scrollLeft).toBe(25);
    expect(reader.querySelector('input')).toBe(draft);
    expect(draft.value).toBe('继续保留这份草稿');
  }
  expect(layout.right).toBeNull();
  expect(ui.container.querySelectorAll('[data-workspace-drop-pane]')).toHaveLength(1);
});

it('retains the same reading and editing DOM through split, swap, cross-pane moves and merge', () => {
  const mounted = vi.fn(), unmounted = vi.fn(), focus = vi.fn();
  function Content({ surface }: { surface: WorkspaceSurface }) {
    useEffect(() => { mounted(surfaceKey(surface)); return () => unmounted(surfaceKey(surface)); }, []);
    return <div data-testid={surfaceKey(surface)}><input aria-label={`草稿 ${surfaceKey(surface)}`} defaultValue="" /></div>;
  }
  const pdf: WorkspaceSurface = { kind: 'pdf', entryId: 'paper' };
  const reflow: WorkspaceSurface = { kind: 'reflow', entryId: 'other' };
  let layout = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: pdf });
  const view = () => <WorkspaceSurfaceDeck layout={layout} onFocus={focus} renderSurface={surface => <Content surface={surface} />} />;
  const ui = render(view()), reader = ui.getByTestId(surfaceKey(pdf));
  reader.scrollTop = 5432; reader.scrollLeft = 37;
  fireEvent.change(ui.getByLabelText(`草稿 ${surfaceKey(pdf)}`), { target: { value: '未保存内容' } });
  layout = workspaceSurfaceReducer(layout, { type: 'open', pane: 'right', surface: reflow });
  ui.rerender(view());
  const second = ui.getByTestId(surfaceKey(reflow)); second.scrollTop = 2345;
  const order = () => [...ui.container.children].map(node => node.getAttribute('data-workspace-surface-kind'));
  const initialOrder = order();
  for (const action of [{ type: 'swap' as const }, { type: 'move' as const, key: surfaceKey(pdf), pane: 'left' as const },
    { type: 'move' as const, key: surfaceKey(reflow), pane: 'left' as const }, { type: 'open' as const, surface: pdf, pane: 'left' as const }]) {
    layout = workspaceSurfaceReducer(layout, action); ui.rerender(view());
    expect(order()).toEqual(initialOrder);
    expect(ui.getByTestId(surfaceKey(pdf))).toBe(reader);
    expect(reader.scrollTop).toBe(5432); expect(reader.scrollLeft).toBe(37);
    expect(second.scrollTop).toBe(2345);
    expect((ui.getByLabelText(`草稿 ${surfaceKey(pdf)}`) as HTMLInputElement).value).toBe('未保存内容');
  }
  expect(mounted.mock.calls.filter(([key]) => key === surfaceKey(pdf))).toHaveLength(1);
  expect(unmounted).not.toHaveBeenCalled();
  layout = workspaceSurfaceReducer(layout, { type: 'closeRight' }); ui.rerender(view());
  expect(ui.getByTestId(surfaceKey(pdf))).toBe(reader);
  expect(reader.scrollTop).toBe(5432);
  expect(ui.container.querySelectorAll('[data-workspace-drop-pane]')).toHaveLength(1);
  fireEvent.pointerDown(reader); expect(focus).toHaveBeenLastCalledWith('left');
  layout = workspaceSurfaceReducer(layout, { type: 'close', pane: 'left', key: surfaceKey(pdf) }); ui.rerender(view());
  expect(unmounted).toHaveBeenCalledWith(surfaceKey(pdf));
});
