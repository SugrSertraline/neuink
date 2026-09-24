// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadingNavigationScope, useReadingNavigation, type ReadingAdapter } from './ReadingNavigation';
afterEach(cleanup);
function Harness({ adapter, name = '' }: { adapter: ReadingAdapter; name?: string }) {
  const nav = useReadingNavigation()!;
  useEffect(() => nav.register(adapter), [adapter, nav.register]);
  return <div><button onClick={() => nav.navigate({pageIdx:3})}>{name}jump</button>
    <button disabled={!nav.canBack} onClick={nav.back}>{name}back</button><button disabled={!nav.canForward} onClick={nav.forward}>{name}forward</button><input aria-label="draft" /></div>;
}
function fixture() {
  let current = { pageIdx:0, offset:.25, left:24 };
  return { capture: () => ({...current}), navigate: vi.fn(() => { current = {pageIdx:3,offset:0,left:0}; return true; }),
    restore: vi.fn((p: typeof current) => {current = p;}) };
}
describe('reading navigation', () => {
  it('restores the actual position and supports forward after returning', () => {
    const adapter=fixture(); render(<ReadingNavigationScope><Harness adapter={adapter}/></ReadingNavigationScope>);
    fireEvent.click(screen.getByText('jump')); fireEvent.click(screen.getByText('back'));
    expect(adapter.restore).toHaveBeenLastCalledWith({pageIdx:0,offset:.25,left:24});
    fireEvent.click(screen.getByText('forward')); expect(adapter.restore).toHaveBeenLastCalledWith({pageIdx:3,offset:0,left:0});
  });
  it('does not record failed jumps and clears forward history after a new jump', () => {
    const adapter=fixture(); adapter.navigate.mockReturnValueOnce(false);
    render(<ReadingNavigationScope><Harness adapter={adapter}/></ReadingNavigationScope>);
    fireEvent.click(screen.getByText('jump')); expect((screen.getByText('back') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('jump')); fireEvent.click(screen.getByText('back')); fireEvent.click(screen.getByText('jump'));
    expect((screen.getByText('forward') as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps split panes independent and does not intercept editor shortcuts', () => {
    const left=fixture(), right=fixture(); render(<><ReadingNavigationScope><Harness adapter={left} name="L"/></ReadingNavigationScope><ReadingNavigationScope><Harness adapter={right} name="R"/></ReadingNavigationScope></>);
    fireEvent.click(screen.getByText('Ljump'));
    expect((screen.getByText('Rback') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getAllByLabelText('draft')[0], {key:'ArrowLeft',altKey:true}); expect(left.restore).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByText('Ljump'), {key:'ArrowLeft',altKey:true}); expect(left.restore).toHaveBeenCalledTimes(1);
  });
});
